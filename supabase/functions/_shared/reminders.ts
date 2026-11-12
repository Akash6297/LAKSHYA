// Pure reminder-planning logic. The dispatcher feeds it rows from the
// database; it returns idempotent job descriptors. No I/O here so it is unit-testable.
import { expandOccurrences, type RecurringSource } from './recurrence.ts'
import { addDaysKey, dowOfKey, localDateKey, zonedInstant } from './time.ts'

export type SourceType = 'event' | 'task' | 'meeting' | 'exam' | 'study' | 'project' | 'agenda' | 'weekly_summary' | 'overdue'

export interface PlannedJob {
  user_id: string
  source_type: SourceType
  source_id: string | null
  occurrence_at: string | null
  offset_minutes: number
  fire_at: string
  idempotency_key: string
  payload: { title: string; body: string; link: string }
}

export interface Window {
  now: Date
  /** how far ahead to plan (ms) */
  lookaheadMs: number
  /** jobs whose fire time passed less than this ago are still planned (ms) */
  graceMs: number
}

export const MAX_REMINDER_MINUTES = 7 * 24 * 60
export const DEFAULT_WINDOW_MS = MAX_REMINDER_MINUTES * 60_000 + 60 * 60_000

export function jobKey(type: SourceType, id: string | null, occurrence: Date | string | null, offset: number): string {
  const occ = occurrence == null ? '-' : typeof occurrence === 'string' ? occurrence : occurrence.toISOString()
  return `${type}:${id ?? '-'}:${occ}:${offset}`
}

export function formatOffset(min: number): string {
  if (min === 0) return 'now'
  if (min % 1440 === 0) return `in ${min / 1440} day${min === 1440 ? '' : 's'}`
  if (min % 60 === 0) return `in ${min / 60} hour${min === 60 ? '' : 's'}`
  return `in ${min} minutes`
}

/** Build jobs for one dated item with a list of minute offsets. */
export function jobsForOccurrence(
  w: Window,
  base: { user_id: string; type: SourceType; id: string; title: string; link: string; detail?: string },
  occurrence: Date,
  offsets: number[],
): PlannedJob[] {
  const out: PlannedJob[] = []
  if (occurrence.getTime() <= w.now.getTime()) return out
  for (const off of new Set(offsets)) {
    if (!Number.isFinite(off) || off < 0 || off > MAX_REMINDER_MINUTES) continue
    const fire = new Date(occurrence.getTime() - off * 60_000)
    if (fire.getTime() < w.now.getTime() - w.graceMs) continue
    if (fire.getTime() > w.now.getTime() + w.lookaheadMs) continue
    out.push({
      user_id: base.user_id,
      source_type: base.type,
      source_id: base.id,
      occurrence_at: occurrence.toISOString(),
      offset_minutes: off,
      fire_at: fire.toISOString(),
      idempotency_key: jobKey(base.type, base.id, occurrence, off),
      payload: {
        title: base.title,
        body: [base.detail, `Starts ${formatOffset(off)}`].filter(Boolean).join(' · '),
        link: base.link,
      },
    })
  }
  return out
}

export interface EventRow extends RecurringSource {
  user_id: string
  title: string
  location: string | null
  reminder_minutes: number[]
  recurring_event_id: string | null
  original_start: string | null
}

/** Plan event reminders, expanding recurring masters and honoring exceptions. */
export function planEventJobs(w: Window, events: EventRow[]): PlannedJob[] {
  const overriddenByMaster = new Map<string, Set<string>>()
  for (const e of events) {
    if (e.recurring_event_id && e.original_start) {
      const s = overriddenByMaster.get(e.recurring_event_id) ?? new Set<string>()
      s.add(new Date(e.original_start).toISOString())
      overriddenByMaster.set(e.recurring_event_id, s)
    }
  }
  const to = new Date(w.now.getTime() + w.lookaheadMs + MAX_REMINDER_MINUTES * 60_000)
  const jobs: PlannedJob[] = []
  for (const e of events) {
    const base = { user_id: e.user_id, type: 'event' as const, id: e.id, title: e.title, link: `/calendar?event=${e.id}`, detail: e.location ?? undefined }
    if (e.rrule) {
      for (const occ of expandOccurrences(e, w.now, to, overriddenByMaster.get(e.id))) {
        jobs.push(...jobsForOccurrence(w, base, occ.start, e.reminder_minutes))
      }
    } else {
      jobs.push(...jobsForOccurrence(w, base, new Date(e.start_at), e.reminder_minutes))
    }
  }
  return jobs
}

export interface UserSchedulePrefs {
  user_id: string
  timezone: string
  daily_agenda_enabled: boolean
  daily_agenda_time: string
  weekly_summary_enabled: boolean
  weekly_summary_dow: number
  weekly_summary_time: string
}

/** Daily agenda (today + tomorrow) and weekly summary jobs in the user's local time. */
export function planDigestJobs(w: Window, p: UserSchedulePrefs): PlannedJob[] {
  const jobs: PlannedJob[] = []
  const today = localDateKey(w.now, p.timezone)
  for (const day of [today, addDaysKey(today, 1)]) {
    if (p.daily_agenda_enabled) {
      const at = zonedInstant(day, p.daily_agenda_time.slice(0, 5), p.timezone)
      if (at.getTime() >= w.now.getTime() - w.graceMs && at.getTime() <= w.now.getTime() + w.lookaheadMs) {
        jobs.push({
          user_id: p.user_id, source_type: 'agenda', source_id: null, occurrence_at: at.toISOString(), offset_minutes: 0,
          fire_at: at.toISOString(), idempotency_key: `agenda:${p.user_id}:${day}`,
          payload: { title: 'Your agenda for today', body: '', link: '/my-day' },
        })
      }
    }
    if (p.weekly_summary_enabled && dowOfKey(day) === p.weekly_summary_dow) {
      const at = zonedInstant(day, p.weekly_summary_time.slice(0, 5), p.timezone)
      if (at.getTime() >= w.now.getTime() - w.graceMs && at.getTime() <= w.now.getTime() + w.lookaheadMs) {
        jobs.push({
          user_id: p.user_id, source_type: 'weekly_summary', source_id: null, occurrence_at: at.toISOString(), offset_minutes: 0,
          fire_at: at.toISOString(), idempotency_key: `weekly:${p.user_id}:${day}`,
          payload: { title: 'Your weekly productivity summary', body: '', link: '/analytics' },
        })
      }
    }
  }
  return jobs
}
