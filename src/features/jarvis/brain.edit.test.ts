// Editing, cancelling and completing existing items; phone calls; teaching by
// voice; autocorrect and speech alternatives.
import { describe, expect, it } from 'vitest'
import type { CalendarItem } from '@/services/calendar'
import type { EventRow, Meeting, Task } from '@/types/db'
import { respond, type BrainContext, type Effect, type Pending } from './brain'
import { DEFAULT_JARVIS } from './settings'

// Saturday 14 Nov 2026, 10:00 IST
const now = new Date('2026-11-14T04:30:00Z')
const tz = 'Asia/Kolkata'
const ist = (wall: string) => new Date(`${wall}:00+05:30`)

const meeting = (id: string, title: string, start: string, end: string): CalendarItem => ({
  key: `m:${id}`, kind: 'meeting', id, title, start: ist(start), end: ist(end), allDay: false, color: '#14B8A6',
  row: { id, user_id: 'u', created_at: '', updated_at: '', title, start_at: ist(start).toISOString(), end_at: ist(end).toISOString(), platform: 'zoom', meeting_url: null, agenda: null, description: null, notes: null, project_id: null, reminder_minutes: [10], attended: null, client_key: null } as Meeting,
})
const eventRow = (over: Partial<EventRow>): EventRow => ({
  id: 'e', user_id: 'u', created_at: '', updated_at: '', title: 'Event', description: null, location: null, all_day: false, start_at: '', end_at: '', timezone: tz,
  category_id: null, priority: 'medium', tags: [], reminder_minutes: [], rrule: null, exdates: [], recurring_event_id: null, original_start: null, client_key: null, ...over,
} as EventRow)
const event = (id: string, title: string, start: string, end: string): CalendarItem => {
  const row = eventRow({ id, title, start_at: ist(start).toISOString(), end_at: ist(end).toISOString() })
  return { key: `e:${id}`, kind: 'event', id, title, start: ist(start), end: ist(end), allDay: false, color: '#6366F1', row }
}
const gymMaster = eventRow({ id: 'g', title: 'Gym', start_at: ist('2026-11-10T07:00').toISOString(), end_at: ist('2026-11-10T08:00').toISOString(), rrule: 'FREQ=DAILY' })
const gym = (day: string): CalendarItem => ({
  key: `e:g:${day}`, kind: 'event', id: 'g', title: 'Gym', start: ist(`${day}T07:00`), end: ist(`${day}T08:00`), allDay: false, color: '#6366F1',
  row: gymMaster, master: gymMaster, originalStart: ist(`${day}T07:00`),
})
const task = (over: Partial<Task>): Task => ({
  id: 't1', user_id: 'u', created_at: '', updated_at: '', title: 'Ship the release', description: null, notes: null, category_id: null, project_id: null, milestone_id: null, meeting_id: null,
  priority: 'high', status: 'not_started', start_date: null, due_date: '2026-11-14', start_at: null, end_at: null, due_at: ist('2026-11-14T18:00').toISOString(), has_due_time: true,
  tags: [], reminder_minutes: [], recurrence: null, recurrence_parent_id: null, sort_order: 0, in_reschedule_queue: false, completed_at: null, client_key: null, ...over,
})

const items: CalendarItem[] = [
  meeting('m1', 'Client review', '2026-11-14T17:00', '2026-11-14T18:00'),
  meeting('m2', 'Meeting with Rahul', '2026-11-15T15:00', '2026-11-15T15:30'),
  event('e1', 'Dentist appointment', '2026-11-16T11:00', '2026-11-16T12:00'),
  gym('2026-11-15'), gym('2026-11-16'), gym('2026-11-17'),
]
const openTasks = [task({}), task({ id: 't2', title: 'Pay electricity bill', due_date: null, due_at: null, has_due_time: false })]

const ctx = (over: Partial<BrainContext> = {}): BrainContext => ({
  now, tz, h24: false, name: 'Divyam',
  data: { now, tz, h24: false, name: 'Divyam', items, openTasks, workingHours: {} },
  defaultEventMinutes: 60, taskDefaultReminders: [30], confirmBeforeSave: false, corrections: [], shortcuts: DEFAULT_JARVIS.shortcuts,
  confirmDeletes: true, autocorrect: true, ...over,
})

const effect = <T extends Effect['type']>(effects: Effect[], type: T) => effects.find((e) => e.type === type) as Extract<Effect, { type: T }>
/** run a conversation: each line answers the previous reply */
function talk(lines: string[], c = ctx()) {
  let pending: Pending | undefined
  let r!: ReturnType<typeof respond>
  for (const l of lines) {
    r = respond(l, pending, c)
    pending = r.pending
  }
  return r
}

describe('moving things', () => {
  it('moves a meeting to a new time on the same day, keeping its length', () => {
    const r = respond('move my meeting with Rahul to 6', undefined, ctx())
    const e = effect(r.effects, 'updateItem')
    expect(e.cand.id).toBe('m2')
    expect(e.values).toEqual({ start_at: ist('2026-11-15T18:00').toISOString(), end_at: ist('2026-11-15T18:30').toISOString() })
    expect(r.say).toBe('Done. I\'ve moved “Meeting with Rahul” to tomorrow at 6 PM.')
  })
  it('moves to another day at the same time', () => {
    const e = effect(respond('reschedule client review to tomorrow', undefined, ctx()).effects, 'updateItem')
    expect(e.values.start_at).toBe(ist('2026-11-15T17:00').toISOString())
    expect(e.values.end_at).toBe(ist('2026-11-15T18:00').toISOString())
  })
  it('pushes the next meeting back by 30 minutes', () => {
    const e = effect(respond('push my next meeting by 30 minutes', undefined, ctx()).effects, 'updateItem')
    expect(e.cand.id).toBe('m1')
    expect(e.values.start_at).toBe(ist('2026-11-14T17:30').toISOString())
  })
  it('brings a meeting forward', () => {
    const e = effect(respond('move client review 1 hour earlier', undefined, ctx()).effects, 'updateItem')
    expect(e.values.start_at).toBe(ist('2026-11-14T16:00').toISOString())
  })
  it('asks when, then moves', () => {
    const first = respond('postpone the dentist appointment', undefined, ctx())
    expect(first.say).toBe('When should I move “Dentist appointment” to?')
    const r = talk(['postpone the dentist appointment', 'wednesday'])
    expect(effect(r.effects, 'updateItem').values.start_at).toBe(ist('2026-11-18T11:00').toISOString())
  })
  it('a recurring event moves just this occurrence', () => {
    const r = respond('move tomorrow\'s gym to 8 am', undefined, ctx())
    const e = effect(r.effects, 'updateItem')
    expect(e.scope).toBe('this')
    expect(e.values.start_at).toBe(ist('2026-11-15T08:00').toISOString())
    expect(r.say).toContain('(just this one)')
  })
  it('warns about overlaps', () => {
    const r = respond('move the dentist appointment to today at 5 pm', undefined, ctx())
    expect(r.say).toContain('Heads up: it overlaps with “Client review”.')
  })
  it('extends and renames', () => {
    expect(effect(respond('extend client review by 30 minutes', undefined, ctx()).effects, 'updateItem').values.end_at).toBe(ist('2026-11-14T18:30').toISOString())
    const r = respond('rename the dentist appointment to Dental checkup', undefined, ctx())
    expect(effect(r.effects, 'updateItem').values).toEqual({ title: 'Dental checkup' })
  })
  it('"move it" means the thing just created or changed', () => {
    const e = effect(respond('move it to 7 pm', undefined, ctx({ recentId: 'm1' })).effects, 'updateItem')
    expect(e.cand.id).toBe('m1')
    expect(e.values.start_at).toBe(ist('2026-11-14T19:00').toISOString())
  })
  it('moves a task\'s due time', () => {
    const e = effect(respond('move ship the release to tomorrow', undefined, ctx()).effects, 'updateItem')
    expect(e.values).toMatchObject({ due_date: '2026-11-15', due_at: ist('2026-11-15T18:00').toISOString(), has_due_time: true })
  })
})

describe('cancelling and deleting', () => {
  it('asks before cancelling, then cancels', () => {
    const ask = respond('cancel my meeting with Rahul', undefined, ctx())
    expect(ask.effects).toEqual([])
    expect(ask.say).toBe('Cancel “Meeting with Rahul” tomorrow at 3 PM?')
    const r = talk(['cancel my meeting with Rahul', 'yes'])
    expect(effect(r.effects, 'deleteItem').cand.id).toBe('m2')
  })
  it('"no" keeps it', () => {
    expect(talk(['cancel my meeting with Rahul', 'no']).say).toBe("Okay, I'll keep it.")
  })
  it('asks which one when several match, then acts on the choice', () => {
    const ask = respond('delete my meeting', undefined, ctx())
    expect(ask.pending?.type).toBe('choose_item')
    expect(ask.display).toBe('I found 2 meetings. Which one should I cancel?')
    const r = talk(['delete my meeting', 'the second one', 'yes'])
    expect(effect(r.effects, 'deleteItem').cand.id).toBe('m2')
    expect(effect(talk(['delete my meeting', 'the one at 5', 'yes']).effects, 'deleteItem').cand.id).toBe('m1')
  })
  it('deletes one occurrence of a series', () => {
    const r = talk(['delete gym on monday', 'yes'])
    const e = effect(r.effects, 'deleteItem')
    expect(e.scope).toBe('this')
    expect(e.cand.item?.originalStart?.toISOString()).toBe(ist('2026-11-16T07:00').toISOString())
  })
  it('the whole series when asked', () => {
    expect(effect(talk(['delete the whole gym series', 'yes']).effects, 'deleteItem').scope).toBe('all')
  })
  it('clears a day after confirming', () => {
    const ask = respond('clear my schedule tomorrow', undefined, ctx())
    expect(ask.say).toMatch(/^Remove all 2:/)
    expect(talk(['clear my schedule tomorrow', 'yes']).effects.filter((e) => e.type === 'deleteItem')).toHaveLength(2)
  })
  it('without confirmation when turned off', () => {
    expect(effect(respond('cancel client review', undefined, ctx({ confirmDeletes: false })).effects, 'deleteItem').cand.id).toBe('m1')
  })
  it('says so when nothing matches', () => {
    expect(respond('cancel my meeting with Priya', undefined, ctx()).say).toBe('I couldn\'t find “priya” on your calendar. Try the name as it appears in the app.')
  })
  it('"undo" and "cancel that" still undo', () => {
    expect(respond('cancel that', undefined, ctx()).effects).toEqual([{ type: 'undo' }])
    expect(respond('undo', undefined, ctx()).effects).toEqual([{ type: 'undo' }])
  })
})

describe('completing tasks', () => {
  it('marks a task done', () => {
    const r = respond('mark ship the release as done', undefined, ctx())
    expect(effect(r.effects, 'updateItem').values).toMatchObject({ status: 'completed' })
    expect(r.say).toBe('Nice work! I\'ve marked “Ship the release” as done.')
  })
  it('understands other phrasings', () => {
    for (const s of ['I finished paying the electricity bill', 'electricity bill is done', 'bijli bill ho gaya', 'complete pay electricity bill']) {
      const r = respond(s, undefined, ctx({ corrections: [{ heard: 'bijli', meant: 'electricity' }] }))
      expect(effect(r.effects, 'updateItem')?.cand.id, s).toBe('t2')
    }
  })
})

describe('phone calls', () => {
  const who = (s: string) => effect(respond(s, undefined, ctx()).effects, 'call')
  it('calls a contact by name', () => {
    expect(who('call Mom')).toMatchObject({ who: 'Mom' })
    expect(who('Hey Jarvis, call Rahul Sharma')).toMatchObject({ who: 'Rahul Sharma' })
    expect(who('phone dad on his work number')).toMatchObject({ who: 'dad', label: 'work' })
    expect(who('i want to talk to priya')).toMatchObject({ who: 'priya' })
  })
  it('Hinglish', () => {
    expect(who('mummy ko call karo')).toMatchObject({ who: 'mummy' })
    expect(who('rahul sharma ko phone lagao')).toMatchObject({ who: 'rahul sharma' })
  })
  it('dials spoken numbers', () => {
    expect(who('call 98765 43210')).toMatchObject({ number: '9876543210' })
    expect(who('dial nine eight seven six five double four three two one')).toMatchObject({ number: '9876544321' })
  })
  it('"call X at 8" is a reminder, and a call with someone is still a meeting', () => {
    const r = respond('call mom at 8 pm', undefined, ctx())
    expect(effect(r.effects, 'createTask').values).toMatchObject({ title: 'Call mom', has_due_time: true })
    expect(effect(respond('schedule a call with Rahul tomorrow at 5', undefined, ctx()).effects, 'createMeeting')).toBeTruthy()
    expect(effect(respond('remind me to call mom tomorrow at 9', undefined, ctx()).effects, 'createTask').values.title).toBe('Call mom')
  })
  it('picks from several contacts', () => {
    const pending: Pending = { type: 'choose_contact', options: [{ name: 'Rahul Sharma', number: '1', label: 'mobile' }, { name: 'Rahul Verma', number: '2', label: 'mobile' }] }
    expect(effect(respond('Verma', pending, ctx()).effects, 'call')).toMatchObject({ number: '2', name: 'Rahul Verma' })
    expect(effect(respond('the first one', pending, ctx()).effects, 'call')).toMatchObject({ number: '1' })
    expect(effect(respond('number 2', pending, ctx()).effects, 'call')).toMatchObject({ number: '2' })
  })
})

describe('training and autocorrect', () => {
  it('learns a word by voice', () => {
    const r = respond('When I say "jim" I mean "gym"', undefined, ctx())
    expect(r.effects).toEqual([{ type: 'learn', heard: 'jim', meant: 'gym' }])
    expect(effect(respond('jim ka matlab gym', undefined, ctx()).effects, 'learn')).toEqual({ type: 'learn', heard: 'jim', meant: 'gym' })
  })
  it('fixes misspelled command words', () => {
    const e = effect(respond('add dentist apointment tomorow at 5 to my calender', undefined, ctx()).effects, 'createEvent')
    expect(e.values).toMatchObject({ title: 'Dentist appointment', start_at: ist('2026-11-15T17:00').toISOString() })
    expect(effect(respond('set a remainder to pay rent at 7', undefined, ctx()).effects, 'createTask').values.title).toBe('Pay rent')
    expect(talk(['cancle my meating with rahul', 'yes']).effects[0]).toMatchObject({ type: 'deleteItem' })
    expect(effect(respond('postphone client review by 1 hour', undefined, ctx()).effects, 'updateItem').values.start_at).toBe(ist('2026-11-14T18:00').toISOString())
  })
  it('can be turned off', () => {
    expect(respond('add dentist apointment tomorow at 5 to my calender', undefined, ctx({ autocorrect: false })).parsed.normalized).toContain('calender')
  })
  it('tries the recogniser\'s other guesses when the first makes no sense', () => {
    const r = respond('cool mom', undefined, ctx(), ['call mom', 'coal mom'])
    expect(r.heard).toBe('call mom')
    expect(effect(r.effects, 'call')).toMatchObject({ who: 'mom' })
  })
  it('Hinglish edits', () => {
    expect(effect(respond('client review ko 6 baje shift karo', undefined, ctx()).effects, 'updateItem').values.start_at).toBe(ist('2026-11-14T18:00').toISOString())
    expect(talk(['rahul wali meeting cancel kar do', 'haan']).effects[0]).toMatchObject({ type: 'deleteItem', cand: { id: 'm2' } })
  })
})
