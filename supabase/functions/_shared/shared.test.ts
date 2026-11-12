import { describe, expect, it } from 'vitest'
import { fromWallClock, isQuietTime, localDateKey, toWallClock, zonedDayBounds, zonedInstant } from './time.ts'
import { expandOccurrences, presetToRule, untilBefore, withUntil } from './recurrence.ts'
import { jobsForOccurrence, planDigestJobs, planEventJobs, type EventRow } from './reminders.ts'

describe('time', () => {
  it('converts Asia/Kolkata wall clock both ways', () => {
    const instant = new Date('2026-11-12T04:30:00Z') // 10:00 IST
    const wall = toWallClock(instant, 'Asia/Kolkata')
    expect(wall.toISOString()).toBe('2026-11-12T10:00:00.000Z')
    expect(fromWallClock(wall, 'Asia/Kolkata').toISOString()).toBe(instant.toISOString())
  })

  it('computes local day bounds across zones', () => {
    const [s, e] = zonedDayBounds('2026-11-12', 'Asia/Kolkata')
    expect(s.toISOString()).toBe('2026-11-11T18:30:00.000Z')
    expect(e.toISOString()).toBe('2026-11-12T18:30:00.000Z')
    expect(localDateKey(new Date('2026-11-11T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-12')
  })

  it('handles DST days (America/New_York 2026-03-08 is 23h long)', () => {
    const [s, e] = zonedDayBounds('2026-03-08', 'America/New_York')
    expect((e.getTime() - s.getTime()) / 3_600_000).toBe(23)
  })

  it('detects quiet hours spanning midnight', () => {
    const tz = 'Asia/Kolkata'
    expect(isQuietTime(zonedInstant('2026-11-12', '23:15', tz), tz, '22:30', '07:00')).toBe(true)
    expect(isQuietTime(zonedInstant('2026-11-12', '06:59', tz), tz, '22:30', '07:00')).toBe(true)
    expect(isQuietTime(zonedInstant('2026-11-12', '07:00', tz), tz, '22:30', '07:00')).toBe(false)
    expect(isQuietTime(zonedInstant('2026-11-12', '13:00', tz), tz, '12:00', '14:00')).toBe(true)
  })
})

describe('recurrence', () => {
  const base = {
    id: 'm1',
    start_at: '2026-03-02T14:00:00Z', // Mon 09:00 America/New_York (EST)
    end_at: '2026-03-02T15:00:00Z',
    timezone: 'America/New_York',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
  }

  it('keeps local wall-clock time across a DST change', () => {
    const occ = expandOccurrences(base, new Date('2026-03-01T00:00:00Z'), new Date('2026-03-20T00:00:00Z'))
    expect(occ.map((o) => o.start.toISOString())).toEqual([
      '2026-03-02T14:00:00.000Z', // EST
      '2026-03-09T13:00:00.000Z', // EDT – still 09:00 local
      '2026-03-16T13:00:00.000Z',
    ])
  })

  it('skips exdates and overridden instances', () => {
    const occ = expandOccurrences(
      { ...base, exdates: ['2026-03-09T13:00:00Z'] },
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-20T00:00:00Z'),
      new Set(['2026-03-16T13:00:00.000Z']),
    )
    expect(occ).toHaveLength(1)
  })

  it('includes an occurrence already in progress at window start', () => {
    const occ = expandOccurrences(base, new Date('2026-03-02T14:30:00Z'), new Date('2026-03-03T00:00:00Z'))
    expect(occ).toHaveLength(1)
  })

  it('splits a series with UNTIL', () => {
    const until = untilBefore(new Date('2026-03-16T13:00:00Z'), base.timezone)
    const rule = withUntil(base.rrule + ';COUNT=10', until)
    expect(rule).not.toContain('COUNT')
    const occ = expandOccurrences({ ...base, rrule: rule }, new Date('2026-03-01T00:00:00Z'), new Date('2026-04-30T00:00:00Z'))
    expect(occ).toHaveLength(2)
  })

  it('builds preset rules using the local weekday', () => {
    // 2026-11-12T20:00Z is Friday 01:30 in Kolkata
    expect(presetToRule('weekly', new Date('2026-11-12T20:00:00Z'), 'Asia/Kolkata')).toBe('FREQ=WEEKLY;BYDAY=FR')
  })
})

describe('reminder planning', () => {
  const now = new Date('2026-11-12T03:30:00Z')
  const w = { now, lookaheadMs: 2 * 86_400_000, graceMs: 15 * 60_000 }

  it('produces deterministic idempotency keys and skips past fire times', () => {
    const occ = new Date('2026-11-12T04:30:00Z') // 1h away
    const jobs = jobsForOccurrence(w, { user_id: 'u', type: 'task', id: 't1', title: 'T', link: '/tasks' }, occ, [1440, 60, 30, 30])
    expect(jobs.map((j) => j.offset_minutes)).toEqual([60, 30]) // 1 day before is in the past; duplicate 30 removed
    expect(jobs[0].idempotency_key).toBe('task:t1:2026-11-12T04:30:00.000Z:60')
    const again = jobsForOccurrence(w, { user_id: 'u', type: 'task', id: 't1', title: 'T', link: '/tasks' }, occ, [60])
    expect(again[0].idempotency_key).toBe(jobs[0].idempotency_key)
  })

  it('never plans reminders for things that already started', () => {
    const jobs = jobsForOccurrence(w, { user_id: 'u', type: 'event', id: 'e', title: 'E', link: '/' }, new Date(now.getTime() - 1000), [0])
    expect(jobs).toEqual([])
  })

  it('expands recurring events and respects exceptions', () => {
    const rows: EventRow[] = [
      { id: 'm', user_id: 'u', title: 'Standup', location: null, start_at: '2026-11-10T04:00:00Z', end_at: '2026-11-10T04:15:00Z',
        timezone: 'Asia/Kolkata', rrule: 'FREQ=DAILY', exdates: [], reminder_minutes: [10], recurring_event_id: null, original_start: null },
      { id: 'x', user_id: 'u', title: 'Standup (moved)', location: null, start_at: '2026-11-13T05:00:00Z', end_at: '2026-11-13T05:15:00Z',
        timezone: 'Asia/Kolkata', rrule: null, exdates: [], reminder_minutes: [10], recurring_event_id: 'm', original_start: '2026-11-13T04:00:00Z' },
    ]
    const keys = planEventJobs(w, rows).map((j) => j.idempotency_key)
    expect(keys).toContain('event:m:2026-11-12T04:00:00.000Z:10')
    expect(keys).not.toContain('event:m:2026-11-13T04:00:00.000Z:10') // replaced by the exception
    expect(keys).toContain('event:x:2026-11-13T05:00:00.000Z:10')
    expect(keys).not.toContain('event:m:2026-11-14T04:00:00.000Z:10') // fires after the lookahead window
  })

  it('plans the daily agenda at local time once per day', () => {
    const jobs = planDigestJobs(w, {
      user_id: 'u', timezone: 'Asia/Kolkata', daily_agenda_enabled: true, daily_agenda_time: '07:00:00',
      weekly_summary_enabled: true, weekly_summary_dow: 5, weekly_summary_time: '19:00',
    })
    const agenda = jobs.filter((j) => j.source_type === 'agenda')
    expect(agenda.map((j) => j.fire_at)).toEqual(['2026-11-13T01:30:00.000Z']) // today's 07:00 IST already passed > grace
    expect(jobs.find((j) => j.source_type === 'weekly_summary')?.fire_at).toBe('2026-11-13T13:30:00.000Z')
  })
})
