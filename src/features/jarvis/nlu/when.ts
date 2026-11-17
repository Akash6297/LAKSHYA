// Date/time understanding for voice commands, resolved in the user's timezone
// (not the device's). Works on text produced by normalize().
import { addDaysKey, dowOfKey, localDateKey, zonedInstant } from '@/lib/dates'

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night'
export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export type Purpose = 'event' | 'meeting' | 'task' | 'alarm' | 'agenda'

export interface HM { h: number; m: number; certain: boolean }

export interface When {
  dateKey?: string
  dateExplicit: boolean
  hm?: HM
  endHm?: HM
  partOfDay?: PartOfDay
  relativeMin?: number
  durationMin?: number
  recurrence?: Recurrence
  recurrenceDow?: number
  /** character ranges of the text that described the time (removed from titles) */
  spans: Array<[number, number]>
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WD_ABBR: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const NUM = '(\\d+(?:\\.\\d+)?|an?|one|half an?|a half|a couple of|couple of|a few|few)'
const UNIT = '(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)'

function amount(s: string): number {
  s = s.trim()
  if (/^\d/.test(s)) return parseFloat(s)
  if (/^half/.test(s) || s === 'a half') return 0.5
  if (/couple/.test(s)) return 2
  if (/few/.test(s)) return 3
  return 1 // a / an / one
}
function toMinutes(n: number, unit: string): number {
  if (/^sec/.test(unit)) return n / 60
  if (/^min/.test(unit)) return n
  if (/^(hour|hr)/.test(unit)) return n * 60
  if (/^day/.test(unit)) return n * 1440
  return n * 10080 // weeks
}
const monthIndex = (s: string) => MONTHS.indexOf(s.slice(0, 3))

export function parseWhen(text: string, now: Date, tz: string): When {
  const w: When = { dateExplicit: false, spans: [] }
  const today = localDateKey(now, tz)
  const overlaps = (a: number, b: number) => w.spans.some(([s, e]) => a < e && b > s)
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const g = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = g.exec(text))) {
      const a = m.index, b = a + m[0].length
      // rejected or overlapping: retry from the next character so a shorter match can still be found
      if (m[0].trim().length === 0 || overlaps(a, b) || fn(m) === false) { g.lastIndex = a + 1; continue }
      // trim leading whitespace some patterns allow, so spans stay tight
      const lead = m[0].length - m[0].trimStart().length
      w.spans.push([a + lead, b])
    }
  }
  const setDate = (key: string) => { if (!w.dateKey) { w.dateKey = key; w.dateExplicit = true } }
  const nextDow = (dow: number, mode: 'this' | 'next' | 'on') => {
    const diff = (dow - dowOfKey(today) + 7) % 7
    return addDaysKey(today, mode === 'this' ? diff : diff === 0 ? 7 : diff)
  }

  // --- recurrence -----------------------------------------------------------
  take(/\b(?:every\s?day|each day|daily)\b/, () => { w.recurrence ??= 'daily' })
  take(/\b(?:every\s+weekday|on\s+weekdays|weekdays|every\s+working\s+day)\b/, () => { w.recurrence ??= 'weekdays' })
  take(new RegExp(`\\b(?:every|on)\\s+(${WEEKDAYS.join('|')})s?\\b`), (m) => {
    // "on monday" (no plural) is a single date, handled below
    if (/^on\s/.test(m[0]) && !/s$/.test(m[0])) return false
    w.recurrence ??= 'weekly'; w.recurrenceDow = WEEKDAYS.indexOf(m[1])
    if (!w.dateKey) { w.dateKey = nextDow(w.recurrenceDow, 'this'); w.dateExplicit = false }
  })
  take(/\b(?:every\s+week|weekly)\b/, () => { w.recurrence ??= 'weekly' })
  take(/\b(?:every\s+month|monthly)\b/, () => { w.recurrence ??= 'monthly' })
  take(/\b(?:every\s+year|yearly|annually)\b/, () => { w.recurrence ??= 'yearly' })

  // --- relative ("in 20 minutes", "in 3 days") -------------------------------
  take(new RegExp(`\\b(?:in|after)\\s+${NUM}\\s*${UNIT}(\\s+and\\s+a\\s+half)?\\b`), (m) => {
    const n = amount(m[1]) + (m[3] ? 0.5 : 0)
    const mins = toMinutes(n, m[2])
    if (mins >= 1440 && Number.isInteger(mins / 1440)) setDate(addDaysKey(today, mins / 1440))
    else w.relativeMin ??= mins
  })

  take(/\b(?:right\s+)?now\b/, () => { w.relativeMin ??= 0 })

  // --- duration ("for 2 hours", "30 minute meeting") --------------------------
  take(new RegExp(`\\bfor\\s+${NUM}\\s*(minutes?|mins?|hours?|hrs?)(\\s+and\\s+(?:a\\s+half|(\\d+)\\s*(?:minutes?|mins?)))?\\b`), (m) => {
    let mins = toMinutes(amount(m[1]), m[2])
    if (m[3]) mins += m[4] ? Number(m[4]) : /^(hour|hr)/.test(m[2]) ? 30 : 0
    w.durationMin ??= Math.round(mins)
  })
  take(/\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)(?:\s+long)?(?=\s+(?:meeting|session|call|event|slot|block|break|focus)|\s+long\b|$)/, (m) => {
    w.durationMin ??= Math.round(toMinutes(parseFloat(m[1]), m[2]))
  })
  // "block 2 hours …", "reserve 30 minutes …"
  take(/(?<=\b(?:block|reserve|book|keep)(?:\s+out)?\s+)(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)\b/, (m) => {
    w.durationMin ??= Math.round(toMinutes(parseFloat(m[1]), m[2]))
  })

  // --- dates -----------------------------------------------------------------
  take(/\b(?:the\s+)?(?:day after tomorrow|overmorrow)\b/, () => setDate(addDaysKey(today, 2)))
  take(/\btonight\b/, () => { setDate(today); w.partOfDay ??= 'night' })
  take(/\b(?:today|this day)\b/, () => setDate(today))
  take(/\b(?:tomorrow|tmrw|tomorow|tommorow|tommorrow|tmr)\b/, () => setDate(addDaysKey(today, 1)))
  take(new RegExp(`\\b(?:on\\s+)?(?:(this|next|coming)\\s+)?(${WEEKDAYS.join('|')})\\b`), (m) => {
    setDate(nextDow(WEEKDAYS.indexOf(m[2]), m[1] === 'this' ? 'this' : m[1] ? 'next' : 'on'))
  })
  take(/\b(?:on|this|next|coming)\s+(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/, (m) => {
    setDate(nextDow(WD_ABBR[m[1]], /^this/.test(m[0]) ? 'this' : /^on/.test(m[0]) ? 'on' : 'next'))
  })
  take(/\b(?:next|coming)\s+week\b/, () => {
    const diff = (1 - dowOfKey(today) + 7) % 7 || 7
    setDate(addDaysKey(today, diff))
  })
  take(/\b(?:this\s+)?weekend\b/, () => setDate(nextDow(6, 'this')))
  const fromParts = (day: number, month: number, year?: number) => {
    const ty = Number(today.slice(0, 4))
    let y = year ?? ty
    if (y < 100) y += 2000
    const key = (yy: number) => `${yy}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!year && key(y) < today) y += 1
    const k = key(y)
    // reject impossible dates like 31 feb
    const d = new Date(`${k}T00:00:00Z`)
    return d.getUTCDate() === day ? k : null
  }
  take(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`), (m) => {
    const k = fromParts(Number(m[1]), monthIndex(m[2]), m[3] ? Number(m[3]) : undefined)
    if (!k) return false
    setDate(k)
  })
  take(new RegExp(`\\b(?:on\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`), (m) => {
    const k = fromParts(Number(m[2]), monthIndex(m[1]), m[3] ? Number(m[3]) : undefined)
    if (!k) return false
    setDate(k)
  })
  take(/\b(?:on\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m) => {
    // Indian format: day/month
    const day = Number(m[1]), mon = Number(m[2])
    if (mon < 1 || mon > 12) return false
    const k = fromParts(day, mon - 1, m[3] ? Number(m[3]) : undefined)
    if (!k) return false
    setDate(k)
  })
  take(/\b(?:on\s+the|on|the)\s+(\d{1,2})(?:st|nd|rd|th)\b/, (m) => {
    const day = Number(m[1])
    const [y, mo] = today.split('-').map(Number)
    let k = fromParts(day, mo - 1, y)
    if (k && k < today) k = null
    if (!k) k = fromParts(day, mo % 12, mo === 12 ? y + 1 : y)
    if (!k) return false
    setDate(k)
  })

  // --- times -----------------------------------------------------------------
  const mkHM = (h: number, m: number, mer?: string): HM | null => {
    if (h > 24 || m > 59) return null
    if (mer === 'am') return h > 12 ? null : { h: h === 12 ? 0 : h, m, certain: true }
    if (mer === 'pm') return h > 12 ? null : { h: h === 12 ? 12 : h + 12, m, certain: true }
    if (h === 24) return { h: 0, m, certain: true }
    return { h, m, certain: h > 12 || h === 0 }
  }
  const TIME = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)?'
  take(new RegExp(`\\b(?:from\\s+)?${TIME}\\s*(?:to|till|until|-|–)\\s*${TIME}(?=\\s|$)`), (m) => {
    const hasFrom = /^from/.test(m[0])
    if (!hasFrom && !m[3] && !m[6] && !m[2] && !m[5]) return false // "2 to 3 people"
    const end = mkHM(Number(m[4]), Number(m[5] ?? 0), m[6])
    let start = mkHM(Number(m[1]), Number(m[2] ?? 0), m[3] ?? (m[6] && Number(m[1]) <= Number(m[4]) ? m[6] : undefined))
    if (!start || !end) return false
    if (!start.certain && end.certain && start.h + 12 <= end.h) start = { ...start, h: start.h + 12, certain: true }
    w.hm ??= start; w.endHm ??= end
  })
  take(/\b(half past|quarter past|quarter to)\s+(\d{1,2})\b/, (m) => {
    const h = Number(m[2])
    w.hm ??= m[1] === 'half past' ? { h, m: 30, certain: false } : m[1] === 'quarter past' ? { h, m: 15, certain: false } : { h: h === 1 ? 12 : h - 1, m: 45, certain: false }
  })
  take(/\b(?:at|by|around|before|@)?\s*(?:12\s*)?(noon|midday|midnight)\b/, (m) => {
    w.hm ??= m[1] === 'midnight' ? { h: 0, m: 0, certain: true } : { h: 12, m: 0, certain: true }
  })
  // "alarm for 4", "wake me up for 6:30"
  take(new RegExp(`(?<=\\b(?:alarm|wake me(?: up)?|wake up call)\\s+)(?:for|at)\\s+${TIME}(?=\\s|$)`), (m) => {
    const hm = mkHM(Number(m[1]), Number(m[2] ?? 0), m[3])
    if (!hm) return false
    w.hm ??= hm
  })
  take(new RegExp(`\\b(?:at|by|around|before|@)\\s+${TIME}(?:\\s*o'?\\s?clock)?(?=\\s|$)`), (m) => {
    const hm = mkHM(Number(m[1]), Number(m[2] ?? 0), m[3])
    if (!hm) return false
    w.hm ??= hm
  })
  take(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?(?=\s|$)/, (m) => {
    const hm = mkHM(Number(m[1]), Number(m[2]), m[3])
    if (!hm) return false
    // "08:00"-style leading zero is 24h
    if (/^0\d/.test(m[1])) hm.certain = true
    w.hm ??= hm
  })
  take(/\b(\d{1,2})\s*(am|pm)\b/, (m) => {
    const hm = mkHM(Number(m[1]), 0, m[2])
    if (!hm) return false
    w.hm ??= hm
  })
  take(/\b(\d{1,2})\s*o'?\s?clock\b/, (m) => {
    const hm = mkHM(Number(m[1]), 0)
    if (!hm) return false
    w.hm ??= hm
  })

  // --- part of day -------------------------------------------------------------
  take(/(?:\b(?:in\s+the|this|at)\s+)?\b(morning|afternoon|evening|night)\b/, (m) => {
    w.partOfDay ??= m[1] as PartOfDay
  })

  return w
}

export interface Resolved {
  start?: Date
  end?: Date
  dateKey?: string
  /** a time of day was given (not just a date) */
  hasTime: boolean
}

const DEFAULT_HOUR: Record<PartOfDay, number> = { morning: 9, afternoon: 14, evening: 18, night: 21 }

/** Turn a parsed When into concrete instants. Pure: everything comes from args. */
export function resolveWhen(w: When, ctx: { now: Date; tz: string; purpose: Purpose; defaultMinutes?: number }): Resolved {
  const { now, tz, purpose } = ctx
  const today = localDateKey(now, tz)
  if (w.relativeMin !== undefined && !w.hm) {
    const start = new Date(now.getTime() + Math.round(w.relativeMin * 60_000))
    const end = w.durationMin ? new Date(start.getTime() + w.durationMin * 60_000) : undefined
    return { start, end, dateKey: localDateKey(start, tz), hasTime: true }
  }
  let dateKey = w.dateKey
  if (!w.hm && !w.partOfDay) return { dateKey, hasTime: false }
  dateKey ??= today

  let h: number, m: number
  if (w.hm) {
    ;({ h, m } = w.hm)
    if (!w.hm.certain) {
      const pod = w.partOfDay
      if (pod === 'morning') { if (h === 12) h = 0 }
      else if (pod) { if (h < 12) h += 12; if (pod === 'night' && h === 24) h = 0 }
      else if (purpose === 'alarm') {
        if (!w.dateExplicit) {
          // the next time the clock shows h:mm
          const am = zonedInstant(dateKey, hmStr(h % 12, m), tz)
          const pm = zonedInstant(dateKey, hmStr((h % 12) + 12, m), tz)
          h = am > now ? h % 12 : pm > now ? (h % 12) + 12 : h % 12
        }
      } else if (h >= 1 && h <= 7) h += 12 // "meeting at 5" means 5 PM
    }
  } else {
    h = DEFAULT_HOUR[w.partOfDay!]
    m = 0
  }

  let start = zonedInstant(dateKey, hmStr(h, m), tz)
  if (!w.dateExplicit && start <= now) {
    dateKey = addDaysKey(dateKey, 1)
    start = zonedInstant(dateKey, hmStr(h, m), tz)
  }

  let end: Date | undefined
  if (w.endHm) {
    let eh = w.endHm.h
    if (!w.endHm.certain && eh < h && eh + 12 <= 23) eh += 12
    end = zonedInstant(dateKey, hmStr(eh, w.endHm.m), tz)
    if (end <= start) end = new Date(end.getTime() + 86_400_000)
  } else if (w.durationMin) {
    end = new Date(start.getTime() + w.durationMin * 60_000)
  } else if (ctx.defaultMinutes) {
    end = new Date(start.getTime() + ctx.defaultMinutes * 60_000)
  }
  return { start, end, dateKey, hasTime: true }
}

const hmStr = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/** True when the text mentioned any date or time at all. */
export const hasWhen = (w: When) => !!(w.dateKey || w.hm || w.partOfDay || w.relativeMin !== undefined)

/** Remove the time phrases from a text (used for titles). */
export function stripSpans(text: string, spans: Array<[number, number]>): string {
  const sorted = [...spans].sort((a, b) => b[0] - a[0])
  let out = text
  for (const [a, b] of sorted) out = `${out.slice(0, a)} ${out.slice(b)}`
  return out.replace(/\s+/g, ' ').trim()
}
