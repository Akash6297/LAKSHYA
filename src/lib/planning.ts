// Rule-based planning helpers (no AI): focus ranking, overdue detection,
// conflicts and free-slot suggestions. Pure functions → unit tested.
import type { Priority, Task } from '@/types/db'

const PRIORITY_WEIGHT: Record<Priority, number> = { critical: 40, high: 28, medium: 16, low: 6 }

export function isOverdue(t: Pick<Task, 'due_at' | 'status'>, now = new Date()): boolean {
  return !!t.due_at && t.status !== 'completed' && t.status !== 'cancelled' && new Date(t.due_at) < now
}

export function isOpen(t: Pick<Task, 'status'>): boolean {
  return t.status !== 'completed' && t.status !== 'cancelled'
}

/**
 * Focus score – transparent and documented in the UI:
 *   priority weight (critical 40 · high 28 · medium 16 · low 6)
 * + urgency: overdue 45; due within 24h 30; within 3 days 18; within 7 days 8
 * + 10 if already in progress, + 6 if scheduled for today
 * − 25 if blocked by an unfinished dependency
 */
export function focusScore(t: Task, now: Date, opts: { blocked?: boolean; scheduledToday?: boolean } = {}): number {
  let s = PRIORITY_WEIGHT[t.priority]
  if (t.due_at) {
    const h = (new Date(t.due_at).getTime() - now.getTime()) / 3_600_000
    if (h < 0) s += 45
    else if (h <= 24) s += 30
    else if (h <= 72) s += 18
    else if (h <= 168) s += 8
  }
  if (t.status === 'in_progress') s += 10
  if (opts.scheduledToday) s += 6
  if (opts.blocked) s -= 25
  return s
}

export function topFocusTasks(tasks: Task[], now: Date, blockedIds: Set<string> = new Set(), todayKey?: string, n = 3): Task[] {
  return tasks
    .filter(isOpen)
    .map((t) => ({
      t,
      s: focusScore(t, now, { blocked: blockedIds.has(t.id), scheduledToday: !!todayKey && (t.start_date === todayKey || t.due_date === todayKey) }),
    }))
    .sort((a, b) => b.s - a.s || (a.t.due_at ?? '9').localeCompare(b.t.due_at ?? '9'))
    .slice(0, n)
    .map((x) => x.t)
}

export interface Interval {
  id: string
  title: string
  start: Date
  end: Date
}

/** Pairs of overlapping intervals (touching end==start is not a conflict). */
export function findConflicts(items: Interval[]): [Interval, Interval][] {
  const sorted = [...items].filter((i) => i.end > i.start).sort((a, b) => a.start.getTime() - b.start.getTime())
  const out: [Interval, Interval][] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      out.push([sorted[i], sorted[j]])
    }
  }
  return out
}

export function conflictsWith(candidate: { start: Date; end: Date; id?: string }, items: Interval[]): Interval[] {
  return items.filter((i) => i.id !== candidate.id && i.start < candidate.end && candidate.start < i.end)
}

/** Free gaps of at least `minMinutes` inside [from, to) given busy intervals. */
export function freeSlots(busy: Interval[], from: Date, to: Date, minMinutes = 30): { start: Date; end: Date }[] {
  const merged: { start: Date; end: Date }[] = []
  for (const b of [...busy].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const s = new Date(Math.max(b.start.getTime(), from.getTime()))
    const e = new Date(Math.min(b.end.getTime(), to.getTime()))
    if (e <= s) continue
    const last = merged[merged.length - 1]
    if (last && s <= last.end) last.end = new Date(Math.max(last.end.getTime(), e.getTime()))
    else merged.push({ start: s, end: e })
  }
  const gaps: { start: Date; end: Date }[] = []
  let cursor = from
  for (const m of merged) {
    if (m.start.getTime() - cursor.getTime() >= minMinutes * 60_000) gaps.push({ start: cursor, end: m.start })
    if (m.end > cursor) cursor = m.end
  }
  if (to.getTime() - cursor.getTime() >= minMinutes * 60_000) gaps.push({ start: cursor, end: to })
  return gaps
}

export function busyMinutes(busy: Interval[], from: Date, to: Date): number {
  const total = (to.getTime() - from.getTime()) / 60_000
  const free = freeSlots(busy, from, to, 0).reduce((a, g) => a + (g.end.getTime() - g.start.getTime()) / 60_000, 0)
  return Math.max(0, Math.round(total - free))
}

/** Current and longest streak of consecutive scheduled days a habit was done. */
export function habitStreak(doneDates: Set<string>, scheduledDow: number[], todayKey: string): { current: number; longest: number } {
  const days: string[] = []
  const d = new Date(todayKey + 'T00:00:00Z')
  for (let i = 0; i < 400; i++) {
    days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  const scheduled = (k: string) => scheduledDow.includes(new Date(k + 'T00:00:00Z').getUTCDay())
  let current = 0
  let started = false
  for (const k of days) {
    if (!scheduled(k)) continue
    if (doneDates.has(k)) { current++; started = true }
    else if (k === todayKey && !started) continue // today not done yet does not break the streak
    else break
  }
  let longest = 0
  let run = 0
  for (const k of [...days].reverse()) {
    if (!scheduled(k)) continue
    run = doneDates.has(k) ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  return { current, longest }
}
