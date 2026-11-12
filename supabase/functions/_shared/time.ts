// Timezone helpers shared by the web app and Edge Functions.
// "Wall clock" dates are plain Dates whose UTC fields hold local time in a zone;
// they let us do calendar arithmetic (recurrence, day boundaries) without DST bugs.
import { TZDate } from '@date-fns/tz'

export function toWallClock(instant: Date, tz: string): Date {
  const z = new TZDate(instant.getTime(), tz)
  return new Date(Date.UTC(z.getFullYear(), z.getMonth(), z.getDate(), z.getHours(), z.getMinutes(), z.getSeconds()))
}

export function fromWallClock(wall: Date, tz: string): Date {
  const z = new TZDate(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    tz,
  )
  return new Date(z.getTime())
}

/** Local calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDateKey(instant: Date, tz: string): string {
  return toWallClock(instant, tz).toISOString().slice(0, 10)
}

/** Local "HH:MM" of an instant in a zone. */
export function localTimeHM(instant: Date, tz: string): string {
  return toWallClock(instant, tz).toISOString().slice(11, 16)
}

/** Instant for a local date + time ("YYYY-MM-DD", "HH:MM") in a zone. */
export function zonedInstant(dateKey: string, timeHM: string, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  const [hh, mm] = timeHM.split(':').map(Number)
  return fromWallClock(new Date(Date.UTC(y, m - 1, d, hh, mm, 0)), tz)
}

/** [start, end) instants of a local calendar day. */
export function zonedDayBounds(dateKey: string, tz: string): [Date, Date] {
  const start = zonedInstant(dateKey, '00:00', tz)
  const [y, m, d] = dateKey.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return [start, zonedInstant(next, '00:00', tz)]
}

export function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Day of week (0 = Sunday) of a local date key. */
export function dowOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** True when `instant` falls inside quiet hours (handles windows spanning midnight). */
export function isQuietTime(instant: Date, tz: string, start: string, end: string): boolean {
  const now = hmToMinutes(localTimeHM(instant, tz))
  const s = hmToMinutes(start.slice(0, 5))
  const e = hmToMinutes(end.slice(0, 5))
  if (s === e) return false
  return s < e ? now >= s && now < e : now >= s || now < e
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
