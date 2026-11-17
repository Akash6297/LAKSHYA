import { describe, expect, it } from 'vitest'
import type { CalendarItem } from '@/services/calendar'
import type { Meeting, Task } from '@/types/db'
import { respond, type BrainContext, type Effect, type Pending } from './brain'
import { buildAlarms } from './alarms'
import { DEFAULT_JARVIS } from './settings'

// Saturday 14 Nov 2026, 10:00 IST
const now = new Date('2026-11-14T04:30:00Z')
const tz = 'Asia/Kolkata'
const ist = (wall: string) => new Date(`${wall}:00+05:30`)

const meetingRow = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'm1', user_id: 'u', created_at: '', updated_at: '', title: 'Client review', start_at: ist('2026-11-14T17:00').toISOString(), end_at: ist('2026-11-14T18:00').toISOString(),
  platform: 'google_meet', meeting_url: 'https://meet.google.com/abc', agenda: null, description: null, notes: null, project_id: null, reminder_minutes: [10], attended: null, client_key: null, ...over,
})
const items: CalendarItem[] = [
  { key: 'm:m1', kind: 'meeting', id: 'm1', title: 'Client review', start: ist('2026-11-14T17:00'), end: ist('2026-11-14T18:00'), allDay: false, color: '#14B8A6', row: meetingRow() },
]
const task = (over: Partial<Task>): Task => ({
  id: 't', user_id: 'u', created_at: '', updated_at: '', title: 'Ship the release', description: null, notes: null, category_id: null, project_id: null, milestone_id: null, meeting_id: null,
  priority: 'high', status: 'not_started', start_date: null, due_date: '2026-11-13', start_at: null, end_at: null, due_at: ist('2026-11-13T18:00').toISOString(), has_due_time: true,
  tags: [], reminder_minutes: [], recurrence: null, recurrence_parent_id: null, sort_order: 0, in_reschedule_queue: false, completed_at: null, client_key: null, ...over,
})

const ctx = (over: Partial<BrainContext> = {}): BrainContext => ({
  now, tz, h24: false, name: 'Divyam',
  data: { now, tz, h24: false, name: 'Divyam', items, openTasks: [task({})], workingHours: { 6: { enabled: false, start: '09:30', end: '18:00', mode: 'office' } } },
  defaultEventMinutes: 60, taskDefaultReminders: [30], confirmBeforeSave: false, corrections: [], shortcuts: DEFAULT_JARVIS.shortcuts, ...over,
})

const effect = <T extends Effect['type']>(effects: Effect[], type: T) => effects.find((e) => e.type === type) as Extract<Effect, { type: T }>

describe('creating things', () => {
  it('meeting is saved with real times and participants', () => {
    const r = respond('Hey Jarvis schedule a meeting with Rahul tomorrow at 5 pm on zoom', undefined, ctx())
    const e = effect(r.effects, 'createMeeting')
    expect(e.values).toMatchObject({ title: 'Meeting with Rahul', platform: 'zoom', start_at: ist('2026-11-15T17:00').toISOString(), end_at: ist('2026-11-15T17:30').toISOString() })
    expect(e.participants).toEqual(['Rahul'])
    expect(r.say).toBe('Done. “Meeting with Rahul” is scheduled tomorrow at 5 PM on Zoom.')
  })
  it('reminder task rings at its time', () => {
    const r = respond('remind me to call mom at 7', undefined, ctx())
    const e = effect(r.effects, 'createTask')
    expect(e.values).toMatchObject({ title: 'Call mom', due_date: '2026-11-14', has_due_time: true, reminder_minutes: [0], tags: ['jarvis'] })
    expect(e.values.due_at).toBe(ist('2026-11-14T19:00').toISOString())
    expect(r.say).toBe("Okay, I'll remind you to call mom today at 7 PM.")
  })
  it('all-day event and weekly recurrence', () => {
    const allDay = effect(respond('add Diwali party on 20th November to my calendar', undefined, ctx()).effects, 'createEvent')
    expect(allDay.values).toMatchObject({ all_day: true, start_at: ist('2026-11-20T00:00').toISOString(), end_at: ist('2026-11-21T00:00').toISOString() })
    const weekly = effect(respond('add yoga every monday at 7 am to my calendar', undefined, ctx()).effects, 'createEvent')
    expect(weekly.values.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(weekly.values.start_at).toBe(ist('2026-11-16T07:00').toISOString())
  })
  it('note keeps the spoken text', () => {
    const e = effect(respond('Take a note: Rahul prefers Thursday demos', undefined, ctx()).effects, 'createNote')
    expect(e.values).toMatchObject({ title: 'Rahul prefers Thursday demos', content_text: 'Rahul prefers Thursday demos', content_html: '<p>Rahul prefers Thursday demos</p>' })
  })
})

describe('conversation', () => {
  it('asks for a missing time, then saves', () => {
    const first = respond('schedule a meeting with Priya', undefined, ctx())
    expect(first.effects).toEqual([])
    expect(first.say).toBe('When is the meeting with Priya?')
    const second = respond('tomorrow at 11 am', first.pending, ctx())
    expect(effect(second.effects, 'createMeeting').values.start_at).toBe(ist('2026-11-15T11:00').toISOString())
  })
  it('"put it on the calendar" after an unclear sentence', () => {
    const first = respond('dentist friday at 4', undefined, ctx())
    expect(first.pending?.type).toBe('choose_target')
    const second = respond('put it on the calendar', first.pending, ctx())
    const e = effect(second.effects, 'createEvent')
    expect(e.values).toMatchObject({ title: 'Dentist', start_at: ist('2026-11-20T16:00').toISOString() })
  })
  it('confirm mode waits for yes', () => {
    const c = ctx({ confirmBeforeSave: true })
    const first = respond('add gym tomorrow at 6 pm to my calendar', undefined, c)
    expect(first.effects).toEqual([])
    expect(first.listen).toBe(true)
    const yes = respond('haan', first.pending as Pending, c)
    expect(effect(yes.effects, 'createEvent').values.title).toBe('Gym')
    const no = respond('no', first.pending as Pending, c)
    expect(no.effects).toEqual([])
  })
  it('a new command abandons the old question', () => {
    const first = respond('schedule a meeting with Priya', undefined, ctx())
    expect(respond('open calendar', first.pending, ctx()).effects).toEqual([{ type: 'navigate', to: '/calendar' }, { type: 'close' }])
  })
  it('undo and shortcuts', () => {
    expect(respond('undo', undefined, ctx()).effects).toEqual([{ type: 'undo' }])
    // default shortcut "start my day" runs the morning briefing
    expect(respond('start my day', undefined, ctx()).say).toMatch(/^Good morning, Divyam!/)
  })
})

describe('your day', () => {
  it('agenda and what is next', () => {
    expect(respond("what's my schedule today", undefined, ctx()).say).toContain('Today you have 1 meeting. At 5 PM, Client review.')
    expect(respond("what's next", undefined, ctx()).say).toBe('Next up: Client review at 5 PM, in 7 hours.')
  })
  it('briefing, balance and motivation use real data', () => {
    const b = respond('good morning', undefined, ctx()).say
    expect(b).toContain('Good morning, Divyam!')
    expect(b).toContain('Your most important task: Ship the release.')
    expect(b).toContain("It's your day off") // Saturday is off in this profile
    expect(respond('motivate me', undefined, ctx()).say).toContain('Ship the release')
    expect(respond('Radhe Radhe Jarvis', undefined, ctx()).say).toBe('Radhe Radhe, Divyam! How can I help?')
  })
  it('alarm effect', () => {
    const r = respond('wake me up at 6', undefined, ctx())
    expect(effect(r.effects, 'alarm').at).toBe(ist('2026-11-15T06:00').toISOString())
    expect(r.say).toBe('Alarm set for 6 AM tomorrow.')
  })
})

describe('phone alerts', () => {
  it('rings before meetings and schedules the daily briefing', () => {
    const list = buildAlarms(items, DEFAULT_JARVIS, now, tz, false)
    expect(list[0]).toMatchObject({ id: 'm:m1:10', at: ist('2026-11-14T16:50').getTime(), ring: true, url: 'https://meet.google.com/abc' })
    expect(list.find((a) => a.id === 'briefing')).toMatchObject({ at: ist('2026-11-15T07:30').getTime(), repeatDaily: true, ring: false })
  })
  it('respects the ring switches and skips past alerts', () => {
    const quiet = { ...DEFAULT_JARVIS, alarms: { ...DEFAULT_JARVIS.alarms, ring: { ...DEFAULT_JARVIS.alarms.ring, meetings: false } } }
    expect(buildAlarms(items, quiet, now, tz, false)[0].ring).toBe(false)
    expect(buildAlarms(items, DEFAULT_JARVIS, ist('2026-11-14T16:55'), tz, false).some((a) => a.id === 'm:m1:10')).toBe(false)
  })
})
