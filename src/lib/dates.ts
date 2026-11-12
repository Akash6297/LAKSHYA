// All display formatting happens in the user's configured timezone, not the
// browser's, so a user travelling or using a VPN still sees their own day.
import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, format, formatDistanceToNowStrict } from 'date-fns'
import { localDateKey, zonedInstant } from '@shared/time.ts'

export { addDaysKey, localDateKey, zonedDayBounds, zonedInstant, dowOfKey } from '@shared/time.ts'

export const tzDate = (d: string | number | Date, tz: string) => new TZDate(new Date(d).getTime(), tz)

export function fmt(d: string | Date | number, tz: string, pattern: string): string {
  return format(tzDate(d, tz), pattern)
}

export function fmtTime(d: string | Date, tz: string, h24 = false): string {
  return fmt(d, tz, h24 ? 'HH:mm' : 'h:mm a')
}

export function fmtRange(start: string | Date, end: string | Date, tz: string, h24 = false): string {
  return `${fmtTime(start, tz, h24)} – ${fmtTime(end, tz, h24)}`
}

export function todayKey(tz: string): string {
  return localDateKey(new Date(), tz)
}

/** "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> in the user zone. */
export function toInputDateTime(iso: string | Date | null | undefined, tz: string): string {
  if (!iso) return ''
  return fmt(iso, tz, "yyyy-MM-dd'T'HH:mm")
}

export function fromInputDateTime(v: string, tz: string): string | null {
  if (!v) return null
  const [d, t] = v.split('T')
  return zonedInstant(d, (t || '00:00').slice(0, 5), tz).toISOString()
}

/** Readable relation of a date key to today: Today / Tomorrow / Yesterday / Mon, 12 Nov */
export function dayLabel(dateKey: string, tz: string): string {
  const diff = differenceInCalendarDays(new Date(dateKey + 'T00:00:00'), new Date(todayKey(tz) + 'T00:00:00'))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return format(new Date(dateKey + 'T00:00:00'), diff > -7 && diff < 7 ? 'EEEE' : 'EEE, d MMM')
}

export function daysUntil(dateKey: string, tz: string): number {
  return differenceInCalendarDays(new Date(dateKey + 'T00:00:00'), new Date(todayKey(tz) + 'T00:00:00'))
}

export function fromNow(d: string | Date): string {
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true })
}

export function greeting(tz: string): string {
  const h = tzDate(new Date(), tz).getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Deadline instant for a task: due date at time (or end of day) in the user zone. */
export function taskDueAt(dueDate: string | null, dueTime: string | null, tz: string): string | null {
  if (!dueDate) return null
  return zonedInstant(dueDate, dueTime || '23:59', tz).toISOString()
}
