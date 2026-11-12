import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/db'
import { busyMinutes, findConflicts, focusScore, freeSlots, habitStreak, isOverdue, topFocusTasks } from './planning'

const now = new Date('2026-11-12T06:00:00Z')
const task = (p: Partial<Task>): Task => ({
  id: crypto.randomUUID(), user_id: 'u', created_at: '', updated_at: '', title: 't', description: null, notes: null, category_id: null,
  project_id: null, milestone_id: null, meeting_id: null, priority: 'medium', status: 'not_started', start_date: null, due_date: null,
  start_at: null, end_at: null, due_at: null, has_due_time: false, tags: [], reminder_minutes: [], recurrence: null,
  recurrence_parent_id: null, sort_order: 0, in_reschedule_queue: false, completed_at: null, client_key: null, ...p,
})
const iv = (id: string, s: string, e: string) => ({ id, title: id, start: new Date(`2026-11-12T${s}:00Z`), end: new Date(`2026-11-12T${e}:00Z`) })

describe('focus ranking', () => {
  it('ranks overdue critical above far-off high', () => {
    const a = task({ priority: 'critical', due_at: '2026-11-11T00:00:00Z' })
    const b = task({ priority: 'high', due_at: '2026-11-30T00:00:00Z' })
    expect(focusScore(a, now)).toBeGreaterThan(focusScore(b, now))
    expect(topFocusTasks([b, a], now)[0]).toBe(a)
  })

  it('excludes completed and penalises blocked tasks', () => {
    const done = task({ priority: 'critical', status: 'completed' })
    const blocked = task({ priority: 'high', due_at: '2026-11-12T10:00:00Z' })
    const free = task({ priority: 'medium', due_at: '2026-11-12T10:00:00Z' })
    const top = topFocusTasks([done, blocked, free], now, new Set([blocked.id]))
    expect(top).not.toContain(done)
    expect(top[0]).toBe(free)
  })

  it('detects overdue only for open tasks', () => {
    expect(isOverdue(task({ due_at: '2026-11-12T05:00:00Z' }), now)).toBe(true)
    expect(isOverdue(task({ due_at: '2026-11-12T05:00:00Z', status: 'completed' }), now)).toBe(false)
  })
})

describe('scheduling', () => {
  it('finds overlapping pairs but not back-to-back items', () => {
    const c = findConflicts([iv('a', '09:00', '10:00'), iv('b', '09:30', '11:00'), iv('c', '11:00', '12:00')])
    expect(c.map(([x, y]) => x.id + y.id)).toEqual(['ab'])
  })

  it('computes free slots and busy minutes', () => {
    const busy = [iv('a', '09:00', '10:00'), iv('b', '09:30', '11:00'), iv('c', '13:00', '13:20')]
    const slots = freeSlots(busy, new Date('2026-11-12T08:00:00Z'), new Date('2026-11-12T14:00:00Z'), 30)
    expect(slots.map((s) => s.start.toISOString().slice(11, 16) + '-' + s.end.toISOString().slice(11, 16))).toEqual(['08:00-09:00', '11:00-13:00', '13:20-14:00'])
    expect(busyMinutes(busy, new Date('2026-11-12T08:00:00Z'), new Date('2026-11-12T14:00:00Z'))).toBe(140)
  })
})

describe('habit streaks', () => {
  it('counts consecutive scheduled days and ignores unscheduled ones', () => {
    // weekdays only; 2026-11-12 is Thursday
    const done = new Set(['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-06', '2026-11-04'])
    const r = habitStreak(done, [1, 2, 3, 4, 5], '2026-11-12')
    expect(r.current).toBe(5) // Thu Wed Tue Mon (weekend skipped) Fri
    expect(r.longest).toBe(5)
  })

  it('does not break the streak just because today is not done yet', () => {
    const r = habitStreak(new Set(['2026-11-11', '2026-11-10']), [0, 1, 2, 3, 4, 5, 6], '2026-11-12')
    expect(r.current).toBe(2)
  })
})
