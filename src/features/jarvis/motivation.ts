// Motivation, briefings and work–life balance nudges. Pure functions over the
// user's real calendar and tasks, so what Jarvis says changes with the day.
import { addDaysKey, dowOfKey, fmt, localDateKey, zonedDayBounds, zonedInstant } from '@/lib/dates'
import { busyMinutes, freeSlots, isOverdue, topFocusTasks } from '@/lib/planning'
import type { CalendarItem } from '@/services/calendar'
import type { Task, WorkDay } from '@/types/db'
import type { AgendaFocus, Mood } from './nlu/parse'

export interface Quote { text: string; by?: string }

// Attributed quotes are limited to well-documented sources; the rest are Jarvis's own lines.
export const QUOTES: Quote[] = [
  { text: 'You have a right to your actions, but never to the fruits of your actions.', by: 'Bhagavad Gita 2.47' },
  { text: 'Lift yourself by your own self; do not let yourself down. The mind can be your friend or your enemy.', by: 'Bhagavad Gita 6.5' },
  { text: 'Perform your duty with an even mind, letting go of attachment to success or failure.', by: 'Bhagavad Gita 2.48' },
  { text: "Better is one's own duty, though imperfectly done, than the duty of another well performed.", by: 'Bhagavad Gita 3.35' },
  { text: 'Arise, awake, and stop not till the goal is reached.', by: 'Swami Vivekananda' },
  { text: 'Take up one idea. Make that one idea your life.', by: 'Swami Vivekananda' },
  { text: 'If you want to shine like a sun, first burn like a sun.', by: 'A. P. J. Abdul Kalam' },
  { text: 'Strength does not come from physical capacity. It comes from an indomitable will.', by: 'Mahatma Gandhi' },
  { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', by: 'James Clear' },
  { text: 'Waste no more time arguing about what a good man should be. Be one.', by: 'Marcus Aurelius' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', by: 'Seneca' },
  { text: 'Almost everything will work again if you unplug it for a few minutes, including you.', by: 'Anne Lamott' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', by: 'Will Durant' },
  { text: 'One focused hour beats a distracted day.' },
  { text: 'Small steps every day add up to big results.' },
  { text: 'Start with the hardest task. The rest of the day gets lighter.' },
  { text: "You don't need more time. You need fewer distractions." },
  { text: 'Progress, not perfection.' },
  { text: 'Discipline is choosing what you want most over what you want now.' },
  { text: 'Your future self is watching. Make them proud.' },
  { text: "Do it now. Sometimes 'later' becomes 'never'." },
  { text: 'Rest is part of the work, not a reward for finishing it.' },
  { text: 'A calm mind makes better decisions than a busy one.' },
  { text: "Family time is not a break from your goals. It's one of them." },
]

export interface DayData {
  now: Date
  tz: string
  h24: boolean
  /** first name or what the user asked to be called */
  name: string
  /** calendar feed items covering at least the asked-about day */
  items: CalendarItem[]
  openTasks: Task[]
  workingHours: Record<string, WorkDay>
}

/** Deterministic per day + seed, so a quote doesn't change on every tap but does day to day. */
export function pickQuote(now: Date, tz: string, seed = 0): Quote {
  const k = localDateKey(now, tz)
  let h = seed
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return QUOTES[h % QUOTES.length]
}

export function quoteText(q: Quote): string {
  return q.by ? `“${q.text}” — ${q.by}.` : q.text
}

const t12 = (d: Date, tz: string, h24: boolean) => {
  if (h24) return fmt(d, tz, 'HH:mm')
  return fmt(d, tz, 'mm') === '00' ? fmt(d, tz, 'h a') : fmt(d, tz, 'h:mm a')
}

/** "today" / "tomorrow" / "on Monday" / "on 25 December" relative to `now` in tz */
export function spokenDay(dateKey: string, now: Date, tz: string): string {
  const today = localDateKey(now, tz)
  if (dateKey === today) return 'today'
  if (dateKey === addDaysKey(today, 1)) return 'tomorrow'
  if (dateKey === addDaysKey(today, -1)) return 'yesterday'
  const d = new Date(`${dateKey}T12:00:00Z`)
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000)
  return diff > 0 && diff < 7 ? `on ${fmt(d, 'UTC', 'EEEE')}` : `on ${fmt(d, 'UTC', 'd MMMM')}`
}

export function spokenTime(d: Date, tz: string, h24 = false): string {
  return t12(d, tz, h24)
}

export function spokenDuration(min: number): string {
  min = Math.max(0, Math.round(min))
  const h = Math.floor(min / 60), m = min % 60
  const hs = h ? `${h} hour${h === 1 ? '' : 's'}` : ''
  const ms = m ? `${m} minute${m === 1 ? '' : 's'}` : ''
  return [hs, ms].filter(Boolean).join(' and ') || 'less than a minute'
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const cleanTitle = (t: string) => t.replace(/^[☐⚑🌴]\s*/u, '')

export function greetingText(now: Date, tz: string, name: string, radhe = false): string {
  const h = Number(fmt(now, tz, 'H'))
  const who = name ? `, ${name}` : ''
  if (radhe) return `Radhe Radhe${who}!`
  if (h < 5) return `You're up late${who}.`
  if (h < 12) return `Good morning${who}!`
  if (h < 17) return `Good afternoon${who}!`
  return `Good evening${who}!`
}

interface DayView {
  dateKey: string
  timed: CalendarItem[]
  meetings: CalendarItem[]
  dueTasks: CalendarItem[]
  allDay: CalendarItem[]
  timeOff: boolean
}

function dayView(d: DayData, dateKey: string): DayView {
  const [from, to] = zonedDayBounds(dateKey, d.tz)
  const inDay = d.items.filter((i) => i.start < to && i.end > from)
  const timed = inDay.filter((i) => !i.allDay && !i.done).sort((a, b) => a.start.getTime() - b.start.getTime())
  return {
    dateKey,
    timed,
    meetings: timed.filter((i) => i.kind === 'meeting'),
    dueTasks: inDay.filter((i) => i.kind === 'task' && i.allDay && !i.done),
    allDay: inDay.filter((i) => i.allDay && i.kind !== 'task' && i.kind !== 'timeoff'),
    timeOff: inDay.some((i) => i.kind === 'timeoff'),
  }
}

export function agendaText(d: DayData, dateKey: string, focus: AgendaFocus): { say: string; rows: CalendarItem[] } {
  const v = dayView(d, dateKey)
  const day = spokenDay(dateKey, d.now, d.tz)
  const time = (i: CalendarItem) => t12(i.start, d.tz, d.h24)

  if (focus === 'next') {
    const next = d.items.filter((i) => !i.allDay && !i.done && i.start > d.now).sort((a, b) => a.start.getTime() - b.start.getTime())[0]
    if (!next) return { say: 'Nothing else is scheduled. Your time is yours.', rows: [] }
    const mins = (next.start.getTime() - d.now.getTime()) / 60_000
    const when = localDateKey(next.start, d.tz) === localDateKey(d.now, d.tz) ? `at ${time(next)}` : `${spokenDay(localDateKey(next.start, d.tz), d.now, d.tz)} at ${time(next)}`
    const soon = mins <= 24 * 60 ? `, in ${spokenDuration(mins)}` : ''
    return { say: `Next up: ${cleanTitle(next.title)} ${when}${soon}.`, rows: [next] }
  }

  if (focus === 'meetings') {
    if (!v.meetings.length) return { say: `You have no meetings ${day}.`, rows: [] }
    const list = v.meetings.slice(0, 4).map((m) => `${cleanTitle(m.title)} at ${time(m)}`)
    return { say: `You have ${plural(v.meetings.length, 'meeting')} ${day}: ${listJoin(list)}.`, rows: v.meetings }
  }

  const overdue = d.openTasks.filter((t) => isOverdue(t, d.now))
  if (focus === 'tasks') {
    const due = v.dueTasks.map((t) => cleanTitle(t.title))
    const parts: string[] = []
    parts.push(due.length ? `${plural(due.length, 'task')} due ${day}: ${listJoin(due.slice(0, 4))}${due.length > 4 ? ' and more' : ''}.` : `No tasks are due ${day}.`)
    if (overdue.length && day === 'today') parts.push(`${plural(overdue.length, 'task')} ${overdue.length === 1 ? 'is' : 'are'} overdue.`)
    return { say: parts.join(' '), rows: v.dueTasks }
  }

  const parts: string[] = []
  if (v.timeOff) parts.push(`You're on leave ${day}.`)
  const counts: string[] = []
  const taskBlocks = v.timed.filter((i) => i.kind === 'task').length
  const events = v.timed.length - v.meetings.length - taskBlocks
  if (v.meetings.length) counts.push(plural(v.meetings.length, 'meeting'))
  if (events) counts.push(plural(events, 'event'))
  if (taskBlocks + v.dueTasks.length) counts.push(plural(taskBlocks + v.dueTasks.length, 'task'))
  if (!counts.length && !v.allDay.length) {
    const top = topFocusTasks(d.openTasks, d.now, new Set(), localDateKey(d.now, d.tz), 1)[0]
    parts.push(`Your calendar is clear ${day}.${top && day === 'today' ? ` A good day to finish ${top.title}.` : ''}`)
  } else {
    if (counts.length) parts.push(`${capitalize(day)} you have ${listJoin(counts)}.`)
    const upcoming = (day === 'today' ? v.timed.filter((i) => i.end > d.now) : v.timed).slice(0, 3)
    if (upcoming.length) parts.push(upcoming.map((i) => `At ${time(i)}, ${cleanTitle(i.title)}.`).join(' '))
    if (v.allDay.length) parts.push(`Also: ${listJoin(v.allDay.slice(0, 3).map((i) => cleanTitle(i.title)))}.`)
  }
  if (overdue.length && day === 'today') parts.push(`${plural(overdue.length, 'task')} ${overdue.length === 1 ? 'is' : 'are'} overdue.`)
  return { say: parts.join(' '), rows: [...v.allDay, ...v.timed, ...v.dueTasks] }
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Work–life balance check for today, based on working hours and what's booked. */
export function balanceText(d: DayData): string {
  const today = localDateKey(d.now, d.tz)
  const wh = d.workingHours?.[String(dowOfKey(today))]
  const v = dayView(d, today)
  if (v.timeOff || (wh && !wh.enabled)) {
    return "It's your day off. Rest, recharge and spend time with the people you love. Your work will be better for it."
  }
  const from = zonedInstant(today, wh?.start ?? '09:00', d.tz)
  const to = zonedInstant(today, wh?.end ?? '18:00', d.tz)
  const busy = v.timed.map((i) => ({ id: i.key, title: i.title, start: i.start, end: i.end }))
  const windowMin = Math.max(1, (to.getTime() - from.getTime()) / 60_000)
  const booked = busyMinutes(busy, from, to)
  const ratio = booked / windowMin
  const parts: string[] = []

  if (d.now.getTime() > to.getTime() + 30 * 60_000) {
    parts.push(`Your working hours ended at ${t12(to, d.tz, d.h24)}. Wrap up, note tomorrow's first task, and switch off. Family and rest matter as much as work.`)
  } else if (d.now < from && Number(fmt(d.now, d.tz, 'H')) >= 5) {
    parts.push(`Work starts at ${t12(from, d.tz, d.h24)}. Use the morning for yourself: a walk, some movement, a proper breakfast.`)
  }

  // back-to-back blocks (3+ items with gaps under 10 minutes)
  let run = 1, best = 1, runStart = v.timed[0], bestStart = v.timed[0], bestEnd = v.timed[0]
  for (let i = 1; i < v.timed.length; i++) {
    if (v.timed[i].start.getTime() - v.timed[i - 1].end.getTime() < 10 * 60_000) {
      run++
      if (run > best) { best = run; bestStart = runStart; bestEnd = v.timed[i] }
    } else { run = 1; runStart = v.timed[i] }
  }
  if (best >= 3 && bestStart && bestEnd) {
    parts.push(`You have ${best} things back to back from ${t12(bestStart.start, d.tz, d.h24)} to ${t12(bestEnd.end, d.tz, d.h24)}. Stand up, stretch and drink water between them.`)
  }

  if (ratio >= 0.8) {
    const gap = freeSlots(busy, new Date(Math.max(d.now.getTime(), from.getTime())), to, 15)[0]
    parts.push(`Today is ${Math.round(ratio * 100)}% booked.${gap ? ` Protect a 15-minute break at ${t12(gap.start, d.tz, d.h24)}.` : ' Say no to anything new today.'}`)
  } else if (!parts.length) {
    parts.push(`Your day looks balanced: about ${spokenDuration(booked)} scheduled out of ${spokenDuration(windowMin)}. Take a real lunch break and finish on time.`)
  }

  const overdue = d.openTasks.filter((t) => isOverdue(t, d.now)).length
  if (overdue > 5) parts.push(`You have ${overdue} overdue tasks. Don't try to clear them all. Finish one, then reschedule the rest.`)
  return parts.join(' ')
}

const MOOD_LINES: Record<Mood, (d: DayData, next: string) => string> = {
  tired: (d) => Number(fmt(d.now, d.tz, 'H')) >= 22 || Number(fmt(d.now, d.tz, 'H')) < 5
    ? "It's late and you're tired. Sleep is the best productivity tool there is. Let's call it a day."
    : "You've been working hard. Drink some water, stretch for two minutes, then do just the next small step.",
  stressed: (_d, next) => `Let's slow down. Breathe in for four seconds, hold for four, and breathe out for six. Now just one thing: ${next || 'pick the smallest task and finish it'}. Everything else can wait.`,
  lazy: (_d, next) => `Let's make it tiny. Work on ${next || 'your first task'} for just five minutes. Starting is the hardest part, and you're about to do it.`,
  sad: () => "I'm sorry it's a rough day. Be kind to yourself. Maybe step outside for a few minutes, or call someone you love. Today doesn't define you.",
  general: (_d, next) => (next ? `You've got this. Start with ${next} and build momentum.` : "You've got this. Pick one meaningful thing and give it your full attention."),
}

export function motivationText(d: DayData, mood: Mood, seed = 0): { say: string; line: string; quote: Quote } {
  const top = topFocusTasks(d.openTasks, d.now, new Set(), localDateKey(d.now, d.tz), 1)[0]
  const quote = pickQuote(d.now, d.tz, seed)
  const line = MOOD_LINES[mood](d, top?.title ?? '')
  return { say: `${line} ${quoteText(quote)}`, line, quote }
}

/** Morning / any-time briefing: greeting, the day, a balance tip and a quote. */
export function briefingText(d: DayData, radhe = false): { say: string; quote: Quote; rows: CalendarItem[] } {
  const today = localDateKey(d.now, d.tz)
  const agenda = agendaText(d, today, 'all')
  const quote = pickQuote(d.now, d.tz)
  const top = topFocusTasks(d.openTasks, d.now, new Set(), today, 1)[0]
  const parts = [greetingText(d.now, d.tz, d.name, radhe), agenda.say]
  if (top) parts.push(`Your most important task: ${top.title}.`)
  parts.push(balanceText(d))
  parts.push(quoteText(quote))
  return { say: parts.join(' '), quote, rows: agenda.rows }
}
