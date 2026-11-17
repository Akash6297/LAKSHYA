import { describe, expect, it } from 'vitest'
import { parseCommand, type Command, type CreateCommand } from './parse'
import { resolveWhen, type Purpose } from './when'

// Saturday 14 Nov 2026, 10:00 in India
const now = new Date('2026-11-14T04:30:00Z')
const tz = 'Asia/Kolkata'
const parse = (s: string, extra: Partial<Parameters<typeof parseCommand>[1]> = {}) => parseCommand(s, { now, tz, ...extra })
const cmd = (s: string) => parse(s).command
const create = (s: string) => {
  const c = cmd(s)
  expect(c.kind, `"${s}" → ${JSON.stringify(c)}`).toBe('create')
  return c as CreateCommand
}
const startOf = (c: Command & { when: CreateCommand['when'] }, purpose: Purpose = 'event', defaultMinutes = 60) =>
  resolveWhen(c.when, { now, tz, purpose, defaultMinutes })
// IST wall clock → ISO
const ist = (wall: string) => new Date(`${wall}:00+05:30`).toISOString()

describe('meetings', () => {
  it('english with explicit pm', () => {
    const c = create('Hey Jarvis, schedule a meeting with Rahul tomorrow at 5 pm')
    expect(c.target).toBe('meeting')
    expect(c.title).toBe('Meeting with Rahul')
    expect(c.participants).toEqual(['Rahul'])
    expect(startOf(c).start?.toISOString()).toBe(ist('2026-11-15T17:00'))
  })
  it('"at 5" means 5 PM for meetings', () => {
    expect(startOf(create('meeting with Rahul tomorrow at 5')).start?.toISOString()).toBe(ist('2026-11-15T17:00'))
  })
  it('hinglish word order', () => {
    const c = create('kal shaam 5 baje Rahul ke saath meeting set karo')
    expect(c.target).toBe('meeting')
    expect(c.participants).toEqual(['Rahul'])
    expect(startOf(c).start?.toISOString()).toBe(ist('2026-11-15T17:00'))
  })
  it('devanagari', () => {
    const c = create('कल सुबह 9 बजे मीटिंग')
    expect(c.target).toBe('meeting')
    expect(startOf(c).start?.toISOString()).toBe(ist('2026-11-15T09:00'))
  })
  it('participants, platform, range and topic', () => {
    const c = create('schedule a team sync with Priya and Amit next Monday from 3 to 4 pm on zoom about the launch')
    expect(c.participants).toEqual(['Priya', 'Amit'])
    expect(c.platform).toBe('zoom')
    expect(c.title).toBe('Team sync with Priya, Amit – Launch')
    const r = startOf(c)
    expect(r.start?.toISOString()).toBe(ist('2026-11-16T15:00'))
    expect(r.end?.toISOString()).toBe(ist('2026-11-16T16:00'))
  })
  it('duration', () => {
    const r = startOf(create('set up a call with Neha on Friday at 11 am for 30 minutes'))
    expect(r.start?.toISOString()).toBe(ist('2026-11-20T11:00'))
    expect(r.end?.toISOString()).toBe(ist('2026-11-20T11:30'))
  })
})

describe('events', () => {
  it('"put it on the calendar" at the end', () => {
    const c = create('Dentist appointment on Friday at 4, please put it on the calendar')
    expect(c.target).toBe('event')
    expect(c.title).toBe('Dentist appointment')
    expect(startOf(c).start?.toISOString()).toBe(ist('2026-11-20T16:00'))
  })
  it('daily recurrence; past time today moves to tomorrow', () => {
    const c = create('add gym every day at 6 am to my calendar')
    expect(c.title).toBe('Gym')
    expect(c.when.recurrence).toBe('daily')
    expect(startOf(c).start?.toISOString()).toBe(ist('2026-11-15T06:00'))
  })
  it('date-only becomes all-day', () => {
    const c = create('add Diwali party on 20th November to the calendar')
    expect(c.title).toBe('Diwali party')
    const r = startOf(c)
    expect(r.hasTime).toBe(false)
    expect(r.dateKey).toBe('2026-11-20')
  })
  it('block time with duration and part of day', () => {
    const c = create('block 2 hours tomorrow morning for deep work')
    expect(c.target).toBe('event')
    expect(c.title).toBe('Deep work')
    const r = startOf(c)
    expect(r.start?.toISOString()).toBe(ist('2026-11-15T09:00'))
    expect(r.end?.toISOString()).toBe(ist('2026-11-15T11:00'))
  })
  it('location', () => {
    const c = create('add lunch with Neha on Sunday at 1 pm at Taj')
    expect(c.title).toBe('Lunch with Neha')
    expect(c.location).toBe('Taj')
    expect(startOf(c).start?.toISOString()).toBe(ist('2026-11-15T13:00'))
  })
  it('past date without year rolls to next year', () => {
    expect(startOf(create('add Republic day parade on 26 January at 9 am')).start?.toISOString()).toBe(ist('2027-01-26T09:00'))
  })
  it('indian dd/mm format', () => {
    expect(startOf(create('schedule an event on 5/12 at 10 am')).start?.toISOString()).toBe(ist('2026-12-05T10:00'))
  })
})

describe('tasks & reminders', () => {
  it('remind me with evening hour', () => {
    const c = create('remind me to call mom at 7')
    expect(c.target).toBe('task')
    expect(c.title).toBe('Call mom')
    expect(c.remind).toBe(true)
    expect(startOf(c, 'task').start?.toISOString()).toBe(ist('2026-11-14T19:00'))
  })
  it('morning hour already passed → tomorrow', () => {
    expect(startOf(create('remind me to call mom at 9'), 'task').start?.toISOString()).toBe(ist('2026-11-15T09:00'))
  })
  it('relative time', () => {
    const c = create('remind me in 20 minutes to check the oven')
    expect(c.title).toBe('Check the oven')
    expect(startOf(c, 'task').start?.toISOString()).toBe(new Date(now.getTime() + 20 * 60_000).toISOString())
  })
  it('spelled-out numbers', () => {
    expect(startOf(create('remind me in five minutes to stretch'), 'task').start?.toISOString()).toBe(new Date(now.getTime() + 5 * 60_000).toISOString())
  })
  it('task with due date and priority', () => {
    const c = create('add task submit report by friday urgent')
    expect(c.title).toBe('Submit report')
    expect(c.priority).toBe('high')
    expect(startOf(c, 'task').dateKey).toBe('2026-11-20')
  })
  it('hinglish reminder', () => {
    const c = create('mujhe kal subah 8 baje yaad dilana dawai lene ka')
    expect(c.target).toBe('task')
    expect(startOf(c, 'task').start?.toISOString()).toBe(ist('2026-11-15T08:00'))
  })
})

describe('notes', () => {
  it('take a note', () => {
    const c = create('take a note buy milk and eggs')
    expect(c.target).toBe('note')
    expect(c.text).toBe('buy milk and eggs')
    expect(c.title).toBe('Buy milk and eggs')
  })
  it('keeps the dates inside the note text', () => {
    const c = create('Note down that the server password changes on Monday')
    expect(c.text).toBe('the server password changes on Monday')
  })
  it('trigger at the end', () => {
    const c = create('Ideas for the launch video, put it in my notes')
    expect(c.text).toBe('Ideas for the launch video')
  })
})

describe('alarms, timers, focus', () => {
  it('alarm with explicit am', () => {
    const c = cmd('set an alarm for 6 am to go to the gym')
    expect(c.kind).toBe('alarm')
    if (c.kind !== 'alarm') return
    expect(c.label).toBe('Go to the gym')
    expect(resolveWhen(c.when, { now, tz, purpose: 'alarm' }).start?.toISOString()).toBe(ist('2026-11-15T06:00'))
  })
  it('"wake me up at 6" is a morning alarm', () => {
    const c = cmd('wake me up at 6')
    if (c.kind !== 'alarm') throw new Error(c.kind)
    expect(resolveWhen(c.when, { now, tz, purpose: 'alarm' }).start?.toISOString()).toBe(ist('2026-11-15T06:00'))
  })
  it('alarm picks the next matching clock time', () => {
    const c = cmd('set an alarm for 4')
    if (c.kind !== 'alarm') throw new Error(c.kind)
    expect(resolveWhen(c.when, { now, tz, purpose: 'alarm' }).start?.toISOString()).toBe(ist('2026-11-14T16:00'))
  })
  it('hinglish alarm', () => {
    const c = cmd('Radhe Radhe Jarvis kal subah 6 baje ka alarm laga do')
    if (c.kind !== 'alarm') throw new Error(c.kind)
    expect(resolveWhen(c.when, { now, tz, purpose: 'alarm' }).start?.toISOString()).toBe(ist('2026-11-15T06:00'))
  })
  it('timer', () => {
    expect(cmd('set a timer for 10 minutes')).toMatchObject({ kind: 'timer', minutes: 10 })
  })
  it('focus', () => {
    expect(cmd('start a focus session for 50 minutes')).toMatchObject({ kind: 'focus', minutes: 50 })
  })
})

describe('questions & conversation', () => {
  it('agenda for tomorrow', () => {
    const c = cmd("what's my schedule tomorrow")
    expect(c.kind).toBe('agenda')
    if (c.kind === 'agenda') expect(c.when.dateKey).toBe('2026-11-15')
  })
  it('hinglish agenda', () => {
    expect(cmd('mera schedule batao').kind).toBe('agenda')
  })
  it('next and meetings focus', () => {
    expect(cmd("what's next")).toMatchObject({ kind: 'agenda', focus: 'next' })
    expect(cmd('any meetings today')).toMatchObject({ kind: 'agenda', focus: 'meetings' })
    expect(cmd('do I have any tasks due tomorrow')).toMatchObject({ kind: 'agenda', focus: 'tasks' })
  })
  it('motivation moods', () => {
    expect(cmd('motivate me')).toMatchObject({ kind: 'motivate', mood: 'general' })
    expect(cmd("I'm so tired")).toMatchObject({ kind: 'motivate', mood: 'tired' })
    expect(cmd('thak gaya hu')).toMatchObject({ kind: 'motivate', mood: 'tired' })
    expect(cmd('I am feeling lazy today')).toMatchObject({ kind: 'motivate', mood: 'lazy' })
    expect(cmd('am I working too much')).toMatchObject({ kind: 'balance' })
  })
  it('"write it down" is a note, not sadness', () => {
    expect(create('call the bank about the card, write it down').target).toBe('note')
  })
  it('briefing, greetings and small talk', () => {
    expect(cmd('good morning').kind).toBe('briefing')
    const r = parse('Radhe Radhe Jarvis')
    expect(r.command.kind).toBe('greet')
    expect(r.radhe).toBe(true)
    expect(cmd('hey lakshya').kind).toBe('greet')
    expect(cmd('thank you').kind).toBe('thanks')
    expect(cmd('what time is it').kind).toBe('time')
    expect(cmd('haan').kind).toBe('yes')
    expect(cmd('nahi').kind).toBe('no')
    expect(cmd('never mind').kind).toBe('cancel')
    expect(cmd('undo that').kind).toBe('undo')
  })
  it('navigation', () => {
    expect(cmd('open calendar')).toMatchObject({ kind: 'navigate', route: '/calendar' })
    expect(cmd('go to my notes')).toMatchObject({ kind: 'navigate', route: '/notes' })
    expect(cmd('open jarvis settings')).toMatchObject({ kind: 'navigate', route: '/settings#jarvis' })
  })
  it('statement with a time but no target is unknown (Jarvis asks)', () => {
    const c = cmd('dentist friday at 4')
    expect(c.kind).toBe('unknown')
    if (c.kind === 'unknown') expect(c.title).toBe('Dentist')
  })
})

describe('training', () => {
  it('corrections fix words the recogniser keeps mishearing', () => {
    const c = parseCommand('meeting with rahul tomorrow at 5 about lucky shah', { now, tz, corrections: [{ heard: 'lucky shah', meant: 'Lakshya' }] }).command
    expect((c as CreateCommand).title).toBe('Meeting with Rahul – Lakshya')
  })
  it('shortcuts match their phrase', () => {
    expect(parseCommand('gym time', { now, tz, shortcuts: [{ phrase: 'start my day' }, { phrase: 'Gym time' }] }).command).toEqual({ kind: 'shortcut', index: 1 })
  })
})

describe('timezone independence', () => {
  it('resolves in the account timezone, not the device', () => {
    const c = parseCommand('meeting tomorrow at 9 am', { now, tz: 'America/New_York' }).command as CreateCommand
    // 14 Nov 04:30Z is still 13 Nov in New York → "tomorrow" is 14 Nov, 9 AM EST
    expect(resolveWhen(c.when, { now, tz: 'America/New_York', purpose: 'meeting' }).start?.toISOString()).toBe('2026-11-14T14:00:00.000Z')
  })
})
