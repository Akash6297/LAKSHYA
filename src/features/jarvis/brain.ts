// Jarvis's dialogue manager: (what you said, the conversation so far, your
// data) → what to say and which effects to run. Pure, so it is unit tested;
// the provider performs the effects (database writes, alarms, navigation).
import { presetToRule } from '@shared/recurrence.ts'
import { addDaysKey, fmt, localDateKey, taskDueAt, zonedInstant } from '@/lib/dates'
import type { EventRow, MeetingPlatform, Note, Priority, Task, TaskRecurrence } from '@/types/db'
import { agendaText, balanceText, briefingText, motivationText, spokenDay, spokenDuration, spokenTime, type DayData, type Quote } from './motivation'
import { bareTime, cleanTitle, parseCommand, type Command, type CreateCommand, type ItemAction, type Parsed, type Target } from './nlu/parse'
import { hasWhen, parseWhen, resolveWhen, type When } from './nlu/when'
import { caseMap } from './nlu/normalize'
import { candidates, findItems, pickOption, type CallChoice, type Candidate, type ItemRef, type PhoneLabel } from './nlu/match'
import type { Shortcut } from './settings'
import type { CalendarItem, EditScope } from '@/services/calendar'

export type EventValues = Pick<EventRow, 'title' | 'all_day' | 'start_at' | 'end_at' | 'timezone' | 'location' | 'priority' | 'tags' | 'reminder_minutes' | 'rrule'>
export type TaskValues = Pick<Task, 'title' | 'priority' | 'status' | 'due_date' | 'due_at' | 'has_due_time' | 'reminder_minutes' | 'recurrence' | 'tags'>
export type NoteValues = Pick<Note, 'title' | 'content_html' | 'content_text' | 'kind' | 'tags'>
export interface MeetingValues { title: string; start_at: string; end_at: string; platform: MeetingPlatform; reminder_minutes: number[] }

export type Effect =
  | { type: 'createEvent'; values: EventValues }
  | { type: 'createMeeting'; values: MeetingValues; participants: string[] }
  | { type: 'createTask'; values: TaskValues }
  | { type: 'createNote'; values: NoteValues }
  | { type: 'updateItem'; cand: Candidate; values: Record<string, unknown>; scope: EditScope }
  | { type: 'deleteItem'; cand: Candidate; scope: EditScope }
  /** call a number, or look `who` up in the phone's contacts first */
  | { type: 'call'; who?: string; number?: string; name?: string; label?: PhoneLabel }
  | { type: 'learn'; heard: string; meant: string }
  | { type: 'undo' }
  | { type: 'navigate'; to: string }
  | { type: 'alarm'; at: string; label: string }
  | { type: 'timer'; seconds: number; label: string }
  | { type: 'focus'; minutes: number | null }
  | { type: 'close' }

export type Card =
  | { type: 'item'; target: Target | 'alarm' | 'timer' | 'call'; title: string; when?: string; detail?: string }
  | { type: 'list'; title: string; rows: CalendarItem[] }
  /** a short list; `selectable` rows can be tapped to answer "which one?" */
  | { type: 'choices'; title: string; rows: { label: string; detail?: string }[]; selectable?: boolean }
  | { type: 'quote'; quote: Quote }
  | { type: 'help' }

export type Pending =
  | { type: 'need_time'; command: CreateCommand }
  | { type: 'need_title'; command: CreateCommand }
  | { type: 'choose_target'; title: string; when: When }
  | { type: 'confirm'; effects: Effect[]; card?: Card; done: string }
  | { type: 'need_alarm_time'; label: string }
  | { type: 'need_timer_length' }
  | { type: 'choose_item'; action: ItemAction; options: Candidate[]; series: boolean }
  | { type: 'need_new_time'; cand: Candidate; series: boolean }
  | { type: 'choose_contact'; options: CallChoice[] }

export interface Reply {
  say: string
  /** shown instead of `say` when a card already shows part of it */
  display?: string
  effects: Effect[]
  card?: Card
  /** Jarvis asked something: listen again right after speaking */
  listen?: boolean
  pending?: Pending
}

export interface BrainContext {
  now: Date
  tz: string
  h24: boolean
  name: string
  data: DayData
  defaultEventMinutes: number
  taskDefaultReminders: number[]
  confirmBeforeSave: boolean
  corrections: { heard: string; meant: string }[]
  shortcuts: Shortcut[]
  /** the item Jarvis last created or changed ("move it to 6") */
  recentId?: string
  /** ask before deleting (default on) */
  confirmDeletes?: boolean
  /** fix misspelled / misheard command words (default on) */
  autocorrect?: boolean
}

const TAG = 'jarvis'
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const HELP_EXAMPLES = [
  'Schedule a meeting with Rahul tomorrow at 5',
  'Move my meeting with Rahul to 6 PM',
  'Cancel tomorrow’s gym',
  'Push my next meeting by 30 minutes',
  'Call Mom',
  'Kal shaam 6 baje gym calendar mein daal do',
  'Remind me to call mom at 8 PM',
  'Mark “Ship the release” as done',
  "What's my schedule today?",
  'Set an alarm for 6 AM',
  'When I say jim I mean gym',
  'Motivate me',
]

/**
 * `alternatives`: other transcripts the speech recogniser offered. When the
 * first one makes no sense, Jarvis tries them before giving up (voice autocorrect).
 */
export function respond(raw: string, pending: Pending | undefined, ctx: BrainContext, alternatives: string[] = []): Reply & { parsed: Parsed; heard: string } {
  const opts = { now: ctx.now, tz: ctx.tz, corrections: ctx.corrections, shortcuts: ctx.shortcuts, autocorrect: ctx.autocorrect }
  let parsed = parseCommand(raw, opts)
  let heard = raw
  if (!pending && parsed.command.kind === 'unknown') {
    for (const alt of alternatives) {
      if (!alt.trim() || alt === raw) continue
      const p = parseCommand(alt, opts)
      if (p.command.kind !== 'unknown') { parsed = p; heard = alt; break }
    }
  }
  return { ...handle(parsed, pending, ctx), parsed, heard }
}

function handle(parsed: Parsed, pending: Pending | undefined, ctx: BrainContext): Reply {
  const c = parsed.command
  if (pending) {
    const r = continuePending(parsed, pending, ctx)
    if (r) return r
  }
  return run(c, parsed, ctx)
}

function continuePending(parsed: Parsed, p: Pending, ctx: BrainContext): Reply | null {
  const c = parsed.command
  if (c.kind === 'cancel' || (c.kind === 'no' && p.type !== 'confirm')) return { say: 'Okay, cancelled.', effects: [] }
  switch (p.type) {
    case 'confirm':
      if (c.kind === 'yes') return { say: p.done, effects: p.effects, card: p.card }
      if (c.kind === 'no' || c.kind === 'undo') {
        const removing = p.effects.some((e) => e.type === 'deleteItem')
        return { say: removing ? "Okay, I'll keep it." : p.effects.some((e) => e.type === 'call') ? "Okay, I won't call." : "Okay, I won't save it.", effects: [] }
      }
      return null
    case 'need_time': {
      const w = parseWhen(parsed.normalized, ctx.now, ctx.tz)
      if (!hasWhen(w)) {
        if (c.kind !== 'unknown') return null // a brand-new command: drop the question
        return { say: 'I still need a time, for example "tomorrow at 5 PM".', effects: [], listen: true, pending: p }
      }
      return create({ ...p.command, when: mergeWhen(p.command.when, w) }, ctx)
    }
    case 'need_title': {
      if (c.kind !== 'unknown' && c.kind !== 'yes') return null
      const title = cleanTitle(parsed.normalized, caseMap(parsed.cased))
      if (!title) return { say: "Sorry, I didn't get the name. What should I call it?", effects: [], listen: true, pending: p }
      const cmd = p.command.target === 'note' ? { ...p.command, text: parsed.cased, title: title.split(' ').slice(0, 7).join(' ') } : { ...p.command, title }
      return create(cmd, ctx)
    }
    case 'choose_target': {
      const t = parsed.normalized
      const target: Target | null = /\bmeeting\b/.test(t) ? 'meeting'
        : /\b(?:calendar|event|schedule)\b/.test(t) ? 'event'
          : /\b(?:task|to ?do|remind|reminder)\b/.test(t) ? 'task'
            : /\bnotes?\b/.test(t) ? 'note' : null
      if (!target) return null
      const fresh = c.kind === 'create' && c.title ? c : null
      const title = fresh?.title || p.title
      const when = fresh && hasWhen(fresh.when) ? fresh.when : p.when
      return create({ kind: 'create', target, title, when, participants: fresh?.participants ?? [], remind: target === 'task' && hasWhen(when), text: target === 'note' ? title : undefined }, ctx)
    }
    case 'need_alarm_time': {
      const w = parseWhen(parsed.normalized, ctx.now, ctx.tz)
      if (!hasWhen(w)) return c.kind === 'unknown' ? { say: 'What time? For example "6:30 AM".', effects: [], listen: true, pending: p } : null
      return alarm(w, p.label, ctx)
    }
    case 'need_timer_length': {
      const w = parseWhen(`for ${parsed.normalized}`, ctx.now, ctx.tz)
      const min = w.durationMin ?? w.relativeMin
      if (!min) return c.kind === 'unknown' ? { say: 'For how long? For example "10 minutes".', effects: [], listen: true, pending: p } : null
      return timer(min, ctx)
    }
    case 'choose_item': {
      const pick = pickOption(parsed.normalized, p.options.map((o) => o.title), p.options.map((o) => (o.allDay ? undefined : o.start)), ctx.now, ctx.tz)
      if (pick === 'all' && (p.action.op === 'delete' || p.action.op === 'complete')) return bulk(p.action, p.options, ctx)
      if (pick === 'all' || pick === -1) {
        if (c.kind !== 'unknown' && c.kind !== 'yes' && c.kind !== 'item') return null
        return { say: 'Sorry, which one? Say “the first one”, “the second one”, or its name.', effects: [], listen: true, pending: p }
      }
      return applyToItem(p.action, p.options[pick], p.series, ctx)
    }
    case 'need_new_time': {
      const txt = parsed.normalized
      const by = txt.match(/^(?:by\s+)?(.+?)\s+(later|earlier|ahead|back)$/) ?? txt.match(/^by\s+(.+)$/)
      if (by) {
        const d = parseWhen(`for ${by[1]}`, ctx.now, ctx.tz).durationMin
        if (d) return applyToItem({ op: 'move', shiftMin: by[2] === 'earlier' ? -d : d }, p.cand, p.series, ctx)
      }
      const w = parseWhen(bareTime(txt.replace(/^(?:to|for|on|till)\s+/, '')), ctx.now, ctx.tz)
      if (!hasWhen(w)) {
        if (c.kind !== 'unknown') return null
        return { say: 'To when? For example “tomorrow at 5 PM” or “30 minutes later”.', effects: [], listen: true, pending: p }
      }
      return applyToItem({ op: 'move', when: w }, p.cand, p.series, ctx)
    }
    case 'choose_contact': {
      const pick = pickOption(parsed.normalized, p.options.map((o) => `${o.name} ${o.label}`))
      if (pick === 'all' || pick === -1) {
        if (c.kind !== 'unknown' && c.kind !== 'yes') return null
        return { say: 'Which one? Say “the first one”, or the name.', effects: [], listen: true, pending: p }
      }
      const o = p.options[pick]
      return { say: '', effects: [{ type: 'call', number: o.number, name: o.name, label: o.label }] }
    }
  }
}

function mergeWhen(old: When, next: When): When {
  return {
    ...old,
    dateKey: next.dateKey ?? old.dateKey,
    dateExplicit: next.dateKey ? next.dateExplicit : old.dateExplicit,
    hm: next.hm ?? old.hm,
    endHm: next.endHm ?? old.endHm,
    partOfDay: next.partOfDay ?? (next.hm ? undefined : old.partOfDay),
    relativeMin: next.relativeMin,
    durationMin: next.durationMin ?? old.durationMin,
    recurrence: next.recurrence ?? old.recurrence,
    spans: [],
  }
}

function run(c: Command, parsed: Parsed, ctx: BrainContext): Reply {
  const name = ctx.name
  switch (c.kind) {
    case 'greet':
      return { say: parsed.radhe ? `Radhe Radhe${name ? `, ${name}` : ''}! How can I help?` : `Yes${name ? `, ${name}` : ''}? How can I help?`, effects: [], listen: true }
    case 'thanks':
      return { say: parsed.radhe ? 'Radhe Radhe! Happy to help.' : "You're welcome!", effects: [{ type: 'close' }] }
    case 'cancel':
      return { say: 'Okay.', effects: [{ type: 'close' }] }
    case 'yes':
    case 'no':
      return { say: 'Okay. What would you like to do?', effects: [], listen: true }
    case 'help':
      return { say: 'I can add, move, rename and cancel meetings, events and tasks, call your contacts, set alarms and timers, take notes, read your schedule, and learn your words. Here are some examples.', effects: [], card: { type: 'help' } }
    case 'item':
      return changeItem(c.action, c.ref, ctx)
    case 'call':
      return { say: '', effects: [{ type: 'call', who: c.who, number: c.number, label: c.label }] }
    case 'learn':
      return { say: `Got it. When you say “${c.heard}”, I'll take it as “${c.meant}”.`, effects: [{ type: 'learn', heard: c.heard, meant: c.meant }] }
    case 'info':
      return { say: c.say, effects: [] }
    case 'time':
      return { say: `It's ${spokenTime(ctx.now, ctx.tz, ctx.h24)}.`, effects: [] }
    case 'date':
      return { say: `Today is ${new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ctx.tz }).format(ctx.now)}.`, effects: [] }
    case 'motivate': {
      const m = motivationText(ctx.data, c.mood, ctx.now.getMinutes())
      return { say: m.say, display: m.line, effects: [], card: { type: 'quote', quote: m.quote } }
    }
    case 'balance':
      return { say: balanceText(ctx.data), effects: [] }
    case 'briefing': {
      const b = briefingText(ctx.data, parsed.radhe)
      return { say: b.say, effects: [], card: b.rows.length ? { type: 'list', title: 'Today', rows: b.rows } : { type: 'quote', quote: b.quote } }
    }
    case 'agenda': {
      const r = resolveWhen(c.when, { now: ctx.now, tz: ctx.tz, purpose: 'agenda' })
      const dateKey = c.when.dateKey ?? r.dateKey ?? localDateKey(ctx.now, ctx.tz)
      const a = agendaText(ctx.data, dateKey, c.focus)
      const title = c.focus === 'next' ? 'Next up' : capitalize(spokenDay(dateKey, ctx.now, ctx.tz).replace(/^on /, ''))
      return { say: a.say, effects: [], card: a.rows.length ? { type: 'list', title, rows: a.rows } : undefined }
    }
    case 'navigate':
      return { say: `Opening ${c.label}.`, effects: [{ type: 'navigate', to: c.route }, { type: 'close' }] }
    case 'focus':
      return { say: `Starting a focus session${c.minutes ? ` for ${spokenDuration(c.minutes)}` : ''}. You've got this!`, effects: [{ type: 'focus', minutes: c.minutes }, { type: 'close' }] }
    case 'undo':
      return { say: '', effects: [{ type: 'undo' }] }
    case 'alarm':
      if (!hasWhen(c.when)) return { say: 'What time should I set the alarm for?', effects: [], listen: true, pending: { type: 'need_alarm_time', label: c.label } }
      return alarm(c.when, c.label, ctx)
    case 'timer':
      if (!c.minutes) return { say: 'For how long?', effects: [], listen: true, pending: { type: 'need_timer_length' } }
      return timer(c.minutes, ctx)
    case 'shortcut': {
      const s = ctx.shortcuts[c.index]
      if (!s) return { say: "I couldn't find that shortcut.", effects: [] }
      if (s.action === 'say') return { say: s.value, effects: [] }
      if (s.action === 'open') return { say: 'Opening it.', effects: [{ type: 'navigate', to: s.value }, { type: 'close' }] }
      // a shortcut that runs another command; never recurse into another shortcut
      const inner = parseCommand(s.value, { now: ctx.now, tz: ctx.tz, corrections: ctx.corrections })
      return run(inner.command.kind === 'shortcut' ? { kind: 'help' } : inner.command, inner, ctx)
    }
    case 'unknown': {
      if (c.title && hasWhen(c.when)) {
        const r = resolveWhen(c.when, { now: ctx.now, tz: ctx.tz, purpose: 'event' })
        return {
          say: `Should I put “${c.title}” ${whenPhrase(r, ctx)} on your calendar, or save it as a task or a note?`,
          effects: [], listen: true, pending: { type: 'choose_target', title: c.title, when: c.when },
        }
      }
      if (c.title && c.title.split(' ').length >= 2) {
        return { say: `Do you want me to save “${c.title}” as a note, a task, or a calendar event?`, effects: [], listen: true, pending: { type: 'choose_target', title: c.title, when: c.when } }
      }
      return { say: "Sorry, I didn't get that. Try something like “meeting with Rahul tomorrow at 5”, or say “help”.", effects: [] }
    }
    case 'create':
      return create(c, ctx)
  }
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function whenPhrase(r: { start?: Date; end?: Date; dateKey?: string; hasTime: boolean }, ctx: BrainContext): string {
  if (!r.dateKey) return ''
  const day = spokenDay(r.dateKey, ctx.now, ctx.tz)
  if (!r.hasTime || !r.start) return day
  return `${day} at ${spokenTime(r.start, ctx.tz, ctx.h24)}`
}

function displayWhen(r: { start?: Date; end?: Date; dateKey?: string; hasTime: boolean }, ctx: BrainContext): string | undefined {
  if (!r.dateKey) return undefined
  const day = capitalize(spokenDay(r.dateKey, ctx.now, ctx.tz).replace(/^on /, ''))
  if (!r.hasTime || !r.start) return `${day} · all day`
  return `${day} · ${spokenTime(r.start, ctx.tz, ctx.h24)}${r.end ? ` – ${spokenTime(r.end, ctx.tz, ctx.h24)}` : ''}`
}

function finish(effects: Effect[], card: Card, done: string, ask: string, ctx: BrainContext): Reply {
  if (ctx.confirmBeforeSave) return { say: ask, effects: [], card, listen: true, pending: { type: 'confirm', effects, card, done } }
  return { say: done, effects, card }
}

function create(c: CreateCommand, ctx: BrainContext): Reply {
  if (c.target === 'note') {
    const text = (c.text ?? '').trim()
    if (!text) return { say: 'What should the note say?', effects: [], listen: true, pending: { type: 'need_title', command: c } }
    const values: NoteValues = { title: c.title || 'Voice note', content_html: `<p>${escapeHtml(text)}</p>`, content_text: text, kind: 'quick', tags: [TAG] }
    return finish([{ type: 'createNote', values }], { type: 'item', target: 'note', title: values.title, detail: text }, `Saved your note “${values.title}”.`, `Save a note saying “${text}”?`, ctx)
  }

  if (!c.title) {
    const what = c.target === 'task' ? (c.remind ? 'What should I remind you about?' : "What's the task?") : c.target === 'meeting' ? 'Who or what is the meeting about?' : "What's the event called?"
    return { say: what, effects: [], listen: true, pending: { type: 'need_title', command: c } }
  }

  const purpose = c.target === 'meeting' ? 'meeting' : c.target === 'task' ? 'task' : 'event'
  const r = resolveWhen(c.when, { now: ctx.now, tz: ctx.tz, purpose, defaultMinutes: c.target === 'meeting' ? 30 : c.target === 'event' ? ctx.defaultEventMinutes : undefined })
  const when = displayWhen(r, ctx)

  if (c.target === 'task') {
    if (c.remind && !r.hasTime) {
      return { say: `When should I remind you to ${lowerFirst(c.title)}?`, effects: [], listen: true, pending: { type: 'need_time', command: c } }
    }
    const dueTime = r.hasTime && r.start ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ctx.tz }).format(r.start) : null
    const recurrence = (c.when.recurrence ?? null) as TaskRecurrence | null
    const due = r.dateKey ?? (recurrence ? localDateKey(ctx.now, ctx.tz) : null)
    const values: TaskValues = {
      title: c.title,
      priority: c.priority ?? 'medium',
      status: 'not_started',
      due_date: due,
      due_at: taskDueAt(due, dueTime, ctx.tz),
      has_due_time: !!dueTime,
      reminder_minutes: dueTime ? (c.remind ? [0] : ctx.taskDefaultReminders) : [],
      recurrence: due ? recurrence : null,
      tags: [TAG],
    }
    const whenSay = due ? whenPhrase({ ...r, dateKey: due }, ctx) : ''
    const done = c.remind ? `Okay, I'll remind you to ${lowerFirst(c.title)} ${whenSay}.` : `Added the task “${c.title}”${whenSay ? `, due ${whenSay}` : ''}.`
    const ask = c.remind ? `Remind you to ${lowerFirst(c.title)} ${whenSay}?` : `Add the task “${c.title}”${whenSay ? ` due ${whenSay}` : ''}?`
    return finish([{ type: 'createTask', values }], { type: 'item', target: 'task', title: c.title, when: due ? displayWhen({ ...r, dateKey: due }, ctx) : undefined, detail: recurrenceLabel(recurrence) }, done, ask, ctx)
  }

  if (!r.dateKey) {
    return { say: c.target === 'meeting' ? `When is the meeting${c.participants.length ? ` with ${c.participants.join(' and ')}` : ''}?` : `When is “${c.title}”?`, effects: [], listen: true, pending: { type: 'need_time', command: c } }
  }

  if (c.target === 'meeting') {
    if (!r.hasTime || !r.start || !r.end) {
      return { say: `What time ${spokenDay(r.dateKey, ctx.now, ctx.tz)}?`, effects: [], listen: true, pending: { type: 'need_time', command: c } }
    }
    const values: MeetingValues = { title: c.title, start_at: r.start.toISOString(), end_at: r.end.toISOString(), platform: c.platform ?? 'other', reminder_minutes: [10] }
    const on = c.platform && c.platform !== 'other' ? ` on ${platformName(c.platform)}` : ''
    return finish(
      [{ type: 'createMeeting', values, participants: c.participants }],
      { type: 'item', target: 'meeting', title: c.title, when, detail: c.participants.length ? `With ${c.participants.join(', ')}` : undefined },
      `Done. “${c.title}” is scheduled ${whenPhrase(r, ctx)}${on}.`,
      `Schedule “${c.title}” ${whenPhrase(r, ctx)}${on}?`,
      ctx,
    )
  }

  // event
  const allDay = !r.hasTime
  const start = allDay ? zonedInstant(r.dateKey, '00:00', ctx.tz) : r.start!
  const end = allDay ? zonedInstant(addDaysKey(r.dateKey, 1), '00:00', ctx.tz) : r.end ?? new Date(start.getTime() + ctx.defaultEventMinutes * 60_000)
  const values: EventValues = {
    title: c.title,
    all_day: allDay,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    timezone: ctx.tz,
    location: c.location ?? null,
    priority: (c.priority ?? 'medium') as Priority,
    tags: [TAG],
    reminder_minutes: allDay ? [] : [10],
    rrule: c.when.recurrence ? presetToRule(c.when.recurrence, start, ctx.tz) : null,
  }
  return finish(
    [{ type: 'createEvent', values }],
    { type: 'item', target: 'event', title: c.title, when, detail: [c.location, recurrenceLabel(c.when.recurrence ?? null)].filter(Boolean).join(' · ') || undefined },
    `Done. I've added “${c.title}” ${whenPhrase(r, ctx)}${c.when.recurrence ? `, ${recurrenceLabel(c.when.recurrence)?.toLowerCase()}` : ''}.`,
    `Add “${c.title}” ${whenPhrase(r, ctx)} to your calendar?`,
    ctx,
  )
}

function recurrenceLabel(r: string | null | undefined): string | undefined {
  return r ? ({ daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' } as Record<string, string>)[r] : undefined
}

function platformName(p: MeetingPlatform): string {
  return ({ google_meet: 'Google Meet', zoom: 'Zoom', teams: 'Teams', in_person: 'in person', phone: 'a phone call', other: '' } as Record<MeetingPlatform, string>)[p]
}

function alarm(w: When, label: string, ctx: BrainContext): Reply {
  const r = resolveWhen(w, { now: ctx.now, tz: ctx.tz, purpose: 'alarm' })
  if (!r.start) return { say: 'What time should I set the alarm for?', effects: [], listen: true, pending: { type: 'need_alarm_time', label } }
  return {
    say: `Alarm set for ${spokenTime(r.start, ctx.tz, ctx.h24)} ${spokenDay(r.dateKey ?? localDateKey(r.start, ctx.tz), ctx.now, ctx.tz)}${label ? `: ${label}` : ''}.`,
    effects: [{ type: 'alarm', at: r.start.toISOString(), label }],
    card: { type: 'item', target: 'alarm', title: label || 'Alarm', when: displayWhen(r, ctx) },
  }
}

function timer(minutes: number, _ctx: BrainContext): Reply {
  return {
    say: `Timer set for ${spokenDuration(minutes)}.`,
    effects: [{ type: 'timer', seconds: Math.round(minutes * 60), label: '' }],
    card: { type: 'item', target: 'timer', title: `${spokenDuration(minutes)} timer` },
  }
}

// ---------------------------------------------------------------------------
// Changing what's already on the calendar: move, extend, rename, cancel, done
// ---------------------------------------------------------------------------

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth']
const POD_HOUR = { morning: 9, afternoon: 14, evening: 18, night: 21 } as const
const hmStr = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

function changeItem(action: ItemAction, ref: ItemRef, ctx: BrainContext): Reply {
  let pool = candidates(ctx.data.items, ctx.data.openTasks, ctx.tz)
  if (ref.it) {
    if (!ctx.recentId) return { say: 'Which one do you mean? Say its name, for example “move my meeting with Rahul to 6”.', effects: [] }
    pool = pool.filter((x) => x.id === ctx.recentId)
  }
  const found = findItems(ref, pool, ctx.now, ctx.tz, { includeDone: action.op !== 'complete' })
  if (!found.matches.length) return { say: notFound(ref, action, ctx), effects: [] }
  if (ref.all && found.matches.length > 1) {
    if (action.op === 'delete' || action.op === 'complete') return bulk(action, found.matches, ctx)
    return askWhich(action, found.matches.slice(0, 5), !!ref.series, ctx, 'I can change one at a time.')
  }
  if (!found.confident) return askWhich(action, found.matches, !!ref.series, ctx)
  return applyToItem(action, found.matches[0], !!ref.series, ctx)
}

function notFound(ref: ItemRef, action: ItemAction, ctx: BrainContext): string {
  const what = ref.words.length ? `“${ref.words.join(' ')}”` : ref.kind === 'meeting' ? 'a meeting' : ref.kind === 'task' ? 'a task' : 'anything'
  const day = ref.when.dateKey ? ` ${spokenDay(ref.when.dateKey, ctx.now, ctx.tz)}` : ''
  const at = ref.when.hm ? ` at ${ref.when.hm.h % 12 || 12}${ref.when.hm.m ? `:${String(ref.when.hm.m).padStart(2, '0')}` : ''}` : ''
  const where = action.op === 'complete' ? 'in your open tasks' : 'on your calendar'
  return `I couldn't find ${what}${day}${at} ${where}. Try the name as it appears in the app.`
}

/** "today at 5 PM", "tomorrow", "" for an undated task */
function candWhen(c: Candidate, ctx: BrainContext): string {
  if (!c.dateKey) return ''
  const day = spokenDay(c.dateKey, ctx.now, ctx.tz)
  return c.allDay || !c.start ? day : `${day} at ${spokenTime(c.start, ctx.tz, ctx.h24)}`
}

function verbFor(a: ItemAction): string {
  return a.op === 'delete' ? 'cancel' : a.op === 'complete' ? 'mark as done' : a.op === 'rename' ? 'rename' : a.op === 'extend' ? 'change' : 'move'
}

function askWhich(action: ItemAction, options: Candidate[], series: boolean, ctx: BrainContext, lead = ''): Reply {
  const noun = options.every((o) => o.kind === 'meeting') ? 'meetings' : options.every((o) => o.kind === 'task') ? 'tasks' : 'matches'
  const spoken = options.slice(0, 3).map((o, i) => `${ORDINAL[i]}, “${o.title}” ${candWhen(o, ctx)}`.trim()).join('. ')
  const q = `Which one should I ${verbFor(action)}?`
  return {
    say: `${lead ? `${lead} ` : ''}I found ${options.length} ${noun}. ${spoken}${options.length > 3 ? '. And more' : ''}. ${q}`,
    display: `${lead ? `${lead} ` : ''}I found ${options.length} ${noun}. ${q}`,
    effects: [],
    listen: true,
    card: { type: 'choices', title: 'Which one?', selectable: true, rows: options.map((o, i) => ({ label: `${i + 1}. ${o.title}`, detail: capitalize(candWhen(o, ctx)) || undefined })) },
    pending: { type: 'choose_item', action, options, series },
  }
}

function itemCard(c: Candidate, when: string | undefined, detail?: string): Extract<Card, { type: 'item' }> {
  return { type: 'item', target: c.kind, title: c.title, when, detail }
}

function applyToItem(action: ItemAction, c: Candidate, series: boolean, ctx: BrainContext): Reply {
  const seriesItem = c.recurring && c.kind === 'event'
  const scope: EditScope = seriesItem && !series ? 'this' : 'all'
  const occ = seriesItem && !series ? ' (just this one)' : seriesItem ? ' (the whole series)' : ''
  const cw = candWhen(c, ctx)
  const shownWhen = cw ? capitalize(cw) : undefined

  switch (action.op) {
    case 'complete': {
      if (c.kind !== 'task') return { say: `“${c.title}” is a ${c.kind === 'meeting' ? 'meeting' : 'calendar event'}, not a task. I can move it or cancel it.`, effects: [] }
      if (c.done) return { say: `“${c.title}” is already done.`, effects: [] }
      return finish(
        [{ type: 'updateItem', cand: c, values: { status: 'completed', completed_at: ctx.now.toISOString() }, scope: 'all' }],
        itemCard(c, shownWhen, c.recurring ? 'Done · next one scheduled' : 'Done'),
        `Nice work! I've marked “${c.title}” as done.`, `Mark “${c.title}” as done?`, ctx,
      )
    }
    case 'delete': {
      const effects: Effect[] = [{ type: 'deleteItem', cand: c, scope }]
      const what = `“${c.title}”${cw ? ` ${cw}` : ''}${occ}`
      const card = itemCard(c, shownWhen, 'Will be removed')
      const done = `Done. I've ${c.kind === 'meeting' ? 'cancelled' : c.kind === 'task' ? 'removed' : 'deleted'} ${what}. Say “undo” if that was a mistake.`
      if (ctx.confirmDeletes === false) return { say: done, effects, card: { ...card, detail: 'Removed' } }
      return { say: `${c.kind === 'meeting' ? 'Cancel' : 'Delete'} ${what}?`, effects: [], card, listen: true, pending: { type: 'confirm', effects, card: { ...card, detail: 'Removed' }, done } }
    }
    case 'rename':
      return finish(
        [{ type: 'updateItem', cand: c, values: { title: action.title }, scope }],
        { type: 'item', target: c.kind, title: action.title, when: shownWhen, detail: `Was “${c.title}”` },
        `Done. “${c.title}” is now called “${action.title}”.`, `Rename “${c.title}” to “${action.title}”?`, ctx,
      )
    case 'extend': {
      const timeboxed = c.kind !== 'task' || !!(c.task?.start_at && c.task?.end_at)
      if (!c.start || !c.end || c.allDay || !timeboxed) return { say: `“${c.title}” doesn't have a start and end time I can change.`, effects: [] }
      const end = new Date(c.end.getTime() + action.minutes * 60_000)
      if (end.getTime() - c.start.getTime() < 5 * 60_000) return { say: 'That would make it shorter than five minutes. How much shorter should it be?', effects: [] }
      const values = c.kind === 'task' ? { end_at: end.toISOString() } : { start_at: c.start.toISOString(), end_at: end.toISOString() }
      const span = `${spokenTime(c.start, ctx.tz, ctx.h24)} – ${spokenTime(end, ctx.tz, ctx.h24)}`
      const clash = conflict(c, c.start, end, ctx)
      const warn = clash ? ` Heads up: it now overlaps with “${clash.title}”.` : ''
      return finish(
        [{ type: 'updateItem', cand: c, values, scope }],
        itemCard(c, `${capitalize(spokenDay(c.dateKey!, ctx.now, ctx.tz))} · ${span}`, action.minutes > 0 ? `${spokenDuration(action.minutes)} longer` : `${spokenDuration(-action.minutes)} shorter`),
        `Done. “${c.title}” now ends at ${spokenTime(end, ctx.tz, ctx.h24)}.${warn}`, `Make “${c.title}” end at ${spokenTime(end, ctx.tz, ctx.h24)}?${warn}`, ctx,
      )
    }
    case 'move': {
      if (action.when === undefined && action.shiftMin === undefined) {
        return { say: `When should I move “${c.title}”${occ} to?`, effects: [], listen: true, pending: { type: 'need_new_time', cand: c, series } }
      }
      const nt = newTimes(c, action, ctx)
      if (!nt) return { say: `“${c.title}” has no time set, so I can only move it to another day. Which day?`, effects: [], listen: true, pending: { type: 'need_new_time', cand: c, series } }
      const values = timesValues(c, nt, ctx)
      const where = nt.hasTime && nt.start ? `${spokenDay(nt.dateKey, ctx.now, ctx.tz)} at ${spokenTime(nt.start, ctx.tz, ctx.h24)}` : spokenDay(nt.dateKey, ctx.now, ctx.tz)
      const clash = nt.hasTime && nt.start && nt.end && c.kind !== 'task' ? conflict(c, nt.start, nt.end, ctx) : undefined
      const warn = clash ? ` Heads up: it overlaps with “${clash.title}”.` : ''
      const newShown = displayWhen({ start: nt.start, end: c.kind === 'task' ? undefined : nt.end, dateKey: nt.dateKey, hasTime: nt.hasTime }, ctx)
      return finish(
        [{ type: 'updateItem', cand: c, values, scope }],
        itemCard(c, newShown, cw ? `Was ${cw}` : undefined),
        `Done. I've moved “${c.title}”${occ} to ${where}.${warn}`, `Move “${c.title}”${occ} to ${where}?${warn}`, ctx,
      )
    }
  }
}

function bulk(action: ItemAction, list: Candidate[], ctx: BrainContext): Reply {
  const rows = list.map((o, i) => ({ label: `${i + 1}. ${o.title}`, detail: capitalize(candWhen(o, ctx)) || undefined }))
  const names = list.slice(0, 3).map((o) => `“${o.title}”`).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '')
  if (action.op === 'complete') {
    const todo = list.filter((o) => o.kind === 'task' && !o.done)
    if (!todo.length) return { say: 'Those are already done, or they are not tasks.', effects: [] }
    return finish(
      todo.map((o) => ({ type: 'updateItem' as const, cand: o, values: { status: 'completed', completed_at: ctx.now.toISOString() }, scope: 'all' as EditScope })),
      { type: 'choices', title: 'Marked done', rows }, `Great work! I've marked ${todo.length} tasks as done.`, `Mark ${todo.length} tasks as done: ${names}?`, ctx,
    )
  }
  const effects: Effect[] = list.map((o) => ({ type: 'deleteItem', cand: o, scope: o.recurring && o.kind === 'event' ? 'this' : 'all' }))
  // removing several things at once always asks first
  return {
    say: `Remove all ${list.length}: ${names}?`,
    effects: [], listen: true,
    card: { type: 'choices', title: `Remove ${list.length} items`, rows },
    pending: { type: 'confirm', effects, card: { type: 'choices', title: 'Removed', rows }, done: `Done. I've removed ${list.length} items.` },
  }
}

interface NewTimes { start?: Date; end?: Date; allDay: boolean; dateKey: string; hasTime: boolean }

/** Where an item lands after "move it to …" / "push it by …", keeping its length. */
export function newTimes(c: Candidate, a: { when?: When; shiftMin?: number }, ctx: Pick<BrainContext, 'now' | 'tz' | 'defaultEventMinutes'>): NewTimes | null {
  const { tz, now } = ctx
  const today = localDateKey(now, tz)
  const timed = !!c.start && !c.allDay
  const dur = timed && c.end ? c.end.getTime() - c.start!.getTime() : (c.kind === 'meeting' ? 30 : c.kind === 'event' ? ctx.defaultEventMinutes : 0) * 60_000
  const at = (start: Date, end?: Date): NewTimes => ({ start, end: end ?? new Date(start.getTime() + dur), allDay: false, dateKey: localDateKey(start, tz), hasTime: true })
  const allDayOn = (dateKey: string): NewTimes => {
    const days = c.kind === 'event' && c.allDay && c.start && c.end ? Math.max(1, Math.round((c.end.getTime() - c.start.getTime()) / 86_400_000)) : 1
    return { start: zonedInstant(dateKey, '00:00', tz), end: zonedInstant(addDaysKey(dateKey, days), '00:00', tz), allDay: true, dateKey, hasTime: false }
  }

  if (a.shiftMin !== undefined) {
    if (timed) return at(new Date(c.start!.getTime() + a.shiftMin * 60_000))
    if (Math.abs(a.shiftMin) >= 1440 && c.dateKey) return allDayOn(addDaysKey(c.dateKey, Math.round(a.shiftMin / 1440)))
    return null
  }
  const w = a.when
  if (!w) return null
  if (w.relativeMin !== undefined && !w.hm) return at(new Date(now.getTime() + w.relativeMin * 60_000))

  let dateKey = w.dateKey ?? (c.dateKey && c.dateKey >= today ? c.dateKey : today)
  if (w.hm || w.partOfDay) {
    let h: number, m: number
    if (w.hm) {
      ;({ h, m } = w.hm)
      if (!w.hm.certain) {
        if (w.partOfDay === 'morning') { if (h === 12) h = 0 }
        else if (w.partOfDay) { if (h < 12) h += 12 }
        else {
          // "move it to 6": pick AM/PM — working hours first, then closest to where it was
          const am = h % 12, pm = am + 12
          const inHours = (x: number) => x >= 8 && x <= 20
          if (inHours(am) !== inHours(pm)) h = inHours(am) ? am : pm
          else if (timed) { const old = Number(fmt(c.start!, tz, 'H')); h = Math.abs(am - old) <= Math.abs(pm - old) ? am : pm }
          else h = am >= 1 && am <= 7 ? pm : am
        }
      }
    } else {
      h = POD_HOUR[w.partOfDay!]
      m = 0
    }
    let start = zonedInstant(dateKey, hmStr(h, m), tz)
    if (!w.dateKey && start <= now) { dateKey = addDaysKey(dateKey, 1); start = zonedInstant(dateKey, hmStr(h, m), tz) }
    let end: Date | undefined
    if (w.endHm) {
      let eh = w.endHm.h
      if (!w.endHm.certain && eh < h && eh + 12 <= 23) eh += 12
      end = zonedInstant(dateKey, hmStr(eh, w.endHm.m), tz)
      if (end <= start) end = new Date(end.getTime() + 86_400_000)
    } else if (w.durationMin) end = new Date(start.getTime() + w.durationMin * 60_000)
    return at(start, end)
  }
  if (!w.dateKey) return null
  if (timed) return at(zonedInstant(dateKey, fmt(c.start!, tz, 'HH:mm'), tz))
  return allDayOn(dateKey)
}

/** Database columns for the new times, per kind of item. */
function timesValues(c: Candidate, nt: NewTimes, ctx: BrainContext): Record<string, unknown> {
  if (c.kind === 'event') return { start_at: nt.start!.toISOString(), end_at: nt.end!.toISOString(), all_day: nt.allDay }
  if (c.kind === 'meeting') return { start_at: nt.start!.toISOString(), end_at: nt.end!.toISOString() }
  const t = c.task!
  const v: Record<string, unknown> = { due_date: nt.dateKey }
  if (t.start_at && t.end_at && nt.start && nt.end && !nt.allDay) {
    const len = new Date(t.end_at).getTime() - new Date(t.start_at).getTime()
    v.start_at = nt.start.toISOString()
    v.end_at = new Date(nt.start.getTime() + len).toISOString()
  }
  if (nt.hasTime && nt.start) {
    v.due_at = nt.start.toISOString()
    v.has_due_time = true
  } else {
    v.due_at = taskDueAt(nt.dateKey, t.has_due_time && t.due_at ? fmt(new Date(t.due_at), ctx.tz, 'HH:mm') : null, ctx.tz)
  }
  return v
}

function conflict(c: Candidate, start: Date, end: Date, ctx: BrainContext): CalendarItem | undefined {
  return ctx.data.items.find((i) => i.id !== c.id && !i.allDay && !i.done && i.kind !== 'task' && i.start < end && i.end > start)
}

