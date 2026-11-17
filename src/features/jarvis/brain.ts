// Jarvis's dialogue manager: (what you said, the conversation so far, your
// data) → what to say and which effects to run. Pure, so it is unit tested;
// the provider performs the effects (database writes, alarms, navigation).
import { presetToRule } from '@shared/recurrence.ts'
import { addDaysKey, localDateKey, taskDueAt, zonedInstant } from '@/lib/dates'
import type { EventRow, MeetingPlatform, Note, Priority, Task, TaskRecurrence } from '@/types/db'
import { agendaText, balanceText, briefingText, motivationText, spokenDay, spokenDuration, spokenTime, type DayData, type Quote } from './motivation'
import { cleanTitle, parseCommand, type Command, type CreateCommand, type Parsed, type Target } from './nlu/parse'
import { hasWhen, parseWhen, resolveWhen, type When } from './nlu/when'
import { caseMap } from './nlu/normalize'
import type { Shortcut } from './settings'
import type { CalendarItem } from '@/services/calendar'

export type EventValues = Pick<EventRow, 'title' | 'all_day' | 'start_at' | 'end_at' | 'timezone' | 'location' | 'priority' | 'tags' | 'reminder_minutes' | 'rrule'>
export type TaskValues = Pick<Task, 'title' | 'priority' | 'status' | 'due_date' | 'due_at' | 'has_due_time' | 'reminder_minutes' | 'recurrence' | 'tags'>
export type NoteValues = Pick<Note, 'title' | 'content_html' | 'content_text' | 'kind' | 'tags'>
export interface MeetingValues { title: string; start_at: string; end_at: string; platform: MeetingPlatform; reminder_minutes: number[] }

export type Effect =
  | { type: 'createEvent'; values: EventValues }
  | { type: 'createMeeting'; values: MeetingValues; participants: string[] }
  | { type: 'createTask'; values: TaskValues }
  | { type: 'createNote'; values: NoteValues }
  | { type: 'undo' }
  | { type: 'navigate'; to: string }
  | { type: 'alarm'; at: string; label: string }
  | { type: 'timer'; seconds: number; label: string }
  | { type: 'focus'; minutes: number | null }
  | { type: 'close' }

export type Card =
  | { type: 'item'; target: Target | 'alarm' | 'timer'; title: string; when?: string; detail?: string }
  | { type: 'list'; title: string; rows: CalendarItem[] }
  | { type: 'quote'; quote: Quote }
  | { type: 'help' }

export type Pending =
  | { type: 'need_time'; command: CreateCommand }
  | { type: 'need_title'; command: CreateCommand }
  | { type: 'choose_target'; title: string; when: When }
  | { type: 'confirm'; effects: Effect[]; card?: Card; done: string }
  | { type: 'need_alarm_time'; label: string }
  | { type: 'need_timer_length' }

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
}

const TAG = 'jarvis'
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const HELP_EXAMPLES = [
  'Schedule a meeting with Rahul tomorrow at 5',
  'Kal shaam 6 baje gym calendar mein daal do',
  'Remind me to call mom at 8 PM',
  'Take a note: ideas for the launch video',
  "What's my schedule today?",
  "What's next?",
  'Set an alarm for 6 AM',
  'Motivate me',
  'Am I working too much?',
  'Open my tasks',
]

export function respond(raw: string, pending: Pending | undefined, ctx: BrainContext): Reply & { parsed: Parsed } {
  const parsed = parseCommand(raw, { now: ctx.now, tz: ctx.tz, corrections: ctx.corrections, shortcuts: ctx.shortcuts })
  return { ...handle(parsed, pending, ctx), parsed }
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
      if (c.kind === 'no') return { say: "Okay, I won't save it.", effects: [] }
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
      return { say: 'You can ask me to add meetings, events, tasks, reminders and notes, set alarms and timers, read your schedule, or motivate you. Here are some examples.', effects: [], card: { type: 'help' } }
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

