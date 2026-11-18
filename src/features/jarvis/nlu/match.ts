// Finding things by voice: "my meeting with Rahul", "tomorrow's gym",
// "the 5 PM call", "mummy". Pure and offline, so it is unit tested.
//
// Matching is forgiving on purpose: speech recognisers spell Indian names in
// many ways (Rahul / Raahul, Shreya / Shriya), so words are compared with a
// phonetic key and a small edit distance, not just exact text.
import { fmt, localDateKey, zonedInstant } from '@/lib/dates'
import type { CalendarItem } from '@/services/calendar'
import type { EventRow, Task } from '@/types/db'
import { editDistance } from './autocorrect'
import { parseWhen, stripSpans, type HM, type When } from './when'

// --- word similarity -------------------------------------------------------------

/** Rough sound-alike key: "Raahul" = "Rahul", "Shreya" ≈ "Sreya", "Vikas" = "Wikas". */
export function phonetic(w: string): string {
  return w
    .toLowerCase()
    .replace(/ph/g, 'f').replace(/w/g, 'v').replace(/(?<=[sbdgkt])h/g, '').replace(/ck|q/g, 'k').replace(/z/g, 'j')
    .replace(/ee|ie$|y$/g, 'i').replace(/oo|ou/g, 'u')
    .replace(/(.)\1+/g, '$1')
}

/** How well one spoken word matches the best word of a name/title: 0 … 1. */
export function wordScore(word: string, against: string[]): number {
  let best = 0
  const pw = phonetic(word)
  for (const t of against) {
    let s = 0
    if (t === word) s = 1
    else if (phonetic(t) === pw) s = 0.92
    else if ((word.length >= 3 && t.startsWith(word)) || (t.length >= 4 && word.startsWith(t))) s = 0.8
    else {
      const d = editDistance(word, t, 2)
      if (word.length >= 4 && d <= 1) s = 0.75
      else if (word.length >= 7 && d <= 2) s = 0.65
    }
    if (s > best) best = s
    if (best === 1) break
  }
  return best
}

export const tokens = (s: string) => s.toLowerCase().replace(/^[☐⚑🌴]\s*/u, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const TITLE_FILLER = new Set(['with', 'the', 'a', 'an', 'and', 'of', 'for', 'to', 'on', 'at', 'in', 'my'])

/** Average word score of the spoken words against a title. */
export function titleScore(words: string[], title: string): number {
  if (!words.length) return 1
  const t = tokens(title).filter((w) => !TITLE_FILLER.has(w))
  return words.reduce((sum, w) => sum + wordScore(w, t), 0) / words.length
}

// --- references to calendar items ----------------------------------------------------

export type RefKind = 'meeting' | 'event' | 'task'

export interface ItemRef {
  /** the identifying words left after removing time words and filler, e.g. "rahul" */
  words: string[]
  kind?: RefKind
  when: When
  /** "next meeting", "upcoming call" */
  next?: boolean
  /** "all my meetings tomorrow" */
  all?: boolean
  /** a recurring item: change the whole series, not just one occurrence */
  series?: boolean
  /** "move it to 6": the thing Jarvis just created or changed */
  it?: boolean
}

const REF_STOP = new Set([
  'my', 'the', 'a', 'an', 'our', 'this', 'that', 'these', 'those', 'with', 'for', 'of', 'about', 'on', 'at', 'in', 'to', 'i', 'have', 'had',
  'has', 'is', 'was', 'scheduled', 'planned', 'booked', 'set', 'up', 'one', 'ones', 'please', 'calendar', 'schedule', 'diary', 'agenda',
  'from', 'it', 'its', 'ka', 'ki', 'ke', 'wala', 'wali', 'wale', 'se', 'mera', 'meri', 'mere', 'and', 'entry', 'item', 'thing', 's',
  'only', 'just', 'which', 'called', 'named', 'titled', 'list', 'today', 'there', 'whole', 'series', 'occurrence', 'again',
  'meeting', 'meetings', 'task', 'tasks', 'todo', 'todos', 'reminder', 'reminders', 'event', 'events', 'appointment', 'appointments',
])

const MEETING_WORDS = /\b(?:meetings?|calls?|syncs?|stand ?ups?|interviews?|catch ?ups?|one on ones?|1:1)\b/

export function parseRef(text: string, now: Date, tz: string): ItemRef {
  let s = ` ${text} `.replace(/\bfrom\s+(?=\d)/g, 'at ').replace(/'s\b/g, ' ')
  const series = /\b(?:series|every (?:one|occurrence|time)|all (?:future )?(?:occurrences|instances)|recurring|(?:all|every) of them)\b/.test(s)
  const all = !series && /\b(?:all|everything)\b/.test(s)
  const when = parseWhen(s, now, tz)
  // "every monday" in a reference means the series, not a new recurrence
  if (when.recurrence) delete when.recurrence
  s = stripSpans(s, when.spans)
  const next = /\b(?:next|upcoming|coming)\b/.test(s)
  const kind: RefKind | undefined = /\b(?:tasks?|to ?dos?|todos?|reminders?)\b/.test(s) ? 'task'
    : MEETING_WORDS.test(s) ? 'meeting'
      : /\b(?:events?|appointments?)\b/.test(s) ? 'event' : undefined
  const words = tokens(s.replace(/\b(?:next|upcoming|coming|all|everything|every)\b/g, ' ')).filter((w) => !REF_STOP.has(w))
  const it = !words.length && !kind && !hasDateOrTime(when) && /^\s*(?:it|that|this|that one|this one|the same)\s*$/.test(text)
  return { words, kind, when, next: next || undefined, all: all || undefined, series: series || undefined, it: it || undefined }
}

const hasDateOrTime = (w: When) => !!(w.dateKey || w.hm || w.partOfDay)

// --- candidates ------------------------------------------------------------------------

export interface Candidate {
  key: string
  kind: RefKind
  id: string
  title: string
  start?: Date
  end?: Date
  allDay: boolean
  /** local date of the item (due date for tasks) */
  dateKey?: string
  recurring: boolean
  done: boolean
  /** calendar feed item (events, meetings, dated tasks) */
  item?: CalendarItem
  /** task row (tasks) */
  task?: Task
}

/** Things Jarvis may change or remove: events, meetings and tasks. */
export function candidates(items: CalendarItem[], openTasks: Task[], tz: string): Candidate[] {
  const out: Candidate[] = []
  const seenTasks = new Set<string>()
  for (const i of items) {
    if (i.kind !== 'event' && i.kind !== 'meeting' && i.kind !== 'task') continue
    const title = i.title.replace(/^[☐⚑🌴]\s*/u, '')
    if (i.kind === 'task') {
      const t = i.row as Task
      seenTasks.add(t.id)
      out.push(taskCandidate(t, tz, i))
      continue
    }
    out.push({
      key: i.key, kind: i.kind, id: i.id, title, start: i.start, end: i.end, allDay: i.allDay,
      // an edited occurrence (recurring_event_id) still belongs to its series
      dateKey: localDateKey(i.start, tz), recurring: !!i.master || !!(i.kind === 'event' && (i.row as EventRow).recurring_event_id), done: !!i.done, item: i,
    })
  }
  for (const t of openTasks) if (!seenTasks.has(t.id)) out.push(taskCandidate(t, tz))
  return out
}

function taskCandidate(t: Task, tz: string, item?: CalendarItem): Candidate {
  const base = { key: `t:${t.id}`, kind: 'task' as const, id: t.id, title: t.title, recurring: !!t.recurrence, done: t.status === 'completed', item, task: t }
  if (t.start_at && t.end_at) return { ...base, start: new Date(t.start_at), end: new Date(t.end_at), allDay: false, dateKey: t.due_date ?? localDateKey(new Date(t.start_at), tz) }
  if (t.has_due_time && t.due_at) return { ...base, start: new Date(t.due_at), end: new Date(t.due_at), allDay: false, dateKey: t.due_date ?? localDateKey(new Date(t.due_at), tz) }
  if (t.due_date) return { ...base, start: zonedInstant(t.due_date, '00:00', tz), end: zonedInstant(t.due_date, '23:59', tz), allDay: true, dateKey: t.due_date }
  return { ...base, allDay: true }
}

function timeMatches(start: Date, hm: HM, tz: string): boolean {
  const [h, m] = fmt(start, tz, 'H:m').split(':').map(Number)
  if (m !== hm.m) return false
  return hm.certain ? h === hm.h : h % 12 === hm.h % 12
}

const POD: Record<string, [number, number]> = { morning: [4, 12], afternoon: [12, 17], evening: [17, 21], night: [19, 24] }

export interface Found {
  matches: Candidate[]
  /** true: act on matches[0] (or all of them for "all …"); false: ask which one */
  confident: boolean
}

export function findItems(ref: ItemRef, cands: Candidate[], now: Date, tz: string, opts: { includeDone?: boolean } = {}): Found {
  const todayStart = zonedInstant(localDateKey(now, tz), '00:00', tz)
  let pool = cands.filter((c) => opts.includeDone !== false || !c.done)
  if (ref.kind === 'task') pool = pool.filter((c) => c.kind === 'task')
  else if (ref.kind === 'meeting') pool = pool.filter((c) => c.kind === 'meeting' || MEETING_WORDS.test(c.title.toLowerCase()))

  const w = ref.when
  if (w.dateKey) pool = pool.filter((c) => c.dateKey === w.dateKey)
  else pool = pool.filter((c) => !c.end || c.end >= todayStart) // nothing from the past unless a date was said
  if (w.hm) pool = pool.filter((c) => c.start && !c.allDay && timeMatches(c.start, w.hm!, tz))
  else if (w.partOfDay) {
    const [a, b] = POD[w.partOfDay]
    pool = pool.filter((c) => { if (!c.start || c.allDay) return false; const h = Number(fmt(c.start, tz, 'H')); return h >= a && h < b })
  }
  if (ref.next) pool = pool.filter((c) => c.start && c.start > now)

  const scored = pool
    .map((c) => ({ c, s: titleScore(ref.words, c.title) + (ref.kind === 'event' && c.kind === 'event' ? 0.05 : 0) }))
    .filter((x) => !ref.words.length || x.s >= 0.6)
    .sort((a, b) => b.s - a.s || order(a.c, now) - order(b.c, now))

  // one entry per item: a daily series shows up once, as its next occurrence
  const byId = new Map<string, { c: Candidate; s: number }>()
  for (const x of scored) {
    const k = ref.all ? x.c.key : x.c.id
    if (!byId.has(k)) byId.set(k, x)
  }
  const list = [...byId.values()]
  const matches = list.map((x) => x.c)
  if (!list.length) return { matches, confident: false }
  if (ref.all || list.length === 1) return { matches, confident: true }
  if (ref.next) {
    const first = [...matches].sort((a, b) => order(a, now) - order(b, now))[0]
    return { matches: [first], confident: true }
  }
  const [top, second] = list
  if (top.s - second.s >= 0.2) return { matches: [top.c], confident: true }
  return { matches: list.filter((x) => x.s >= top.s - 0.2).slice(0, 5).map((x) => x.c), confident: false }
}

/** Upcoming first (soonest), then past ones, then undated tasks. */
function order(c: Candidate, now: Date): number {
  if (!c.start) return 4e15
  const d = c.start.getTime() - now.getTime()
  const ongoing = c.end && c.end.getTime() > now.getTime() && d < 0
  return d >= 0 || ongoing ? Math.max(d, 0) : 2e15 - d
}

// --- choosing from a list: "the second one", "the one at 5", "Rahul Sharma", "both" ----------------

export function pickOption(text: string, labels: string[], starts: (Date | undefined)[] = [], now = new Date(), tz = 'UTC'): number | 'all' | -1 {
  const t = ` ${text.toLowerCase()} `
  if (/\b(?:both|all|all of them|each|dono|sab|sabhi|everything)\b/.test(t)) return 'all'
  const w = parseWhen(t, now, tz)
  if (w.hm && starts.length) {
    const hits = starts.map((s, i) => (s && timeMatches(s, w.hm!, tz) ? i : -1)).filter((i) => i >= 0)
    if (hits.length === 1) return hits[0]
  }
  const ORD: [RegExp, number][] = [
    [/\b(?:first|1st|pehla|pehli|pahla|pahli)\b|^\s*(?:one|1|number one|number 1)\s*$/, 0],
    [/\b(?:second|2nd|doosra|dusra|doosri|dusri)\b|^\s*(?:two|2|number two|number 2)\s*$/, 1],
    [/\b(?:third|3rd|teesra|tisra|teesri)\b|^\s*(?:three|3|number three|number 3)\s*$/, 2],
    [/\b(?:fourth|4th)\b|^\s*(?:four|4|number four|number 4)\s*$/, 3],
    [/\b(?:fifth|5th)\b|^\s*(?:five|5|number five|number 5)\s*$/, 4],
  ]
  for (const [re, i] of ORD) if (re.test(t) && i < labels.length) return i
  if (/\b(?:last|last one|aakhri|akhri)\b/.test(t)) return labels.length - 1
  const words = tokens(t).filter((x) => !REF_STOP.has(x) && !['call', 'number', 'wala', 'wali', 'the', 'one', 'mobile', 'work', 'home'].includes(x))
  // number labels: "mobile", "work", "home"
  const label = t.match(/\b(mobile|cell|work|office|home|landline)\b/)?.[1]
  if (label) {
    const want = label === 'cell' ? 'mobile' : label === 'office' ? 'work' : label === 'landline' ? 'home' : label
    const hits = labels.map((l, i) => (l.toLowerCase().includes(want) ? i : -1)).filter((i) => i >= 0)
    if (hits.length === 1) return hits[0]
  }
  if (!words.length) return -1
  const scores = labels.map((l) => titleScore(words, l))
  const best = Math.max(...scores)
  if (best < 0.6) return -1
  const top = scores.map((s, i) => (s >= best - 0.05 ? i : -1)).filter((i) => i >= 0)
  return top.length === 1 ? top[0] : -1
}

// --- contacts ----------------------------------------------------------------------------

export type PhoneLabel = 'mobile' | 'work' | 'home' | 'other'

export interface Contact {
  name: string
  numbers: { number: string; label: PhoneLabel; primary?: boolean }[]
  starred?: boolean
}

export interface CallChoice { name: string; number: string; label: PhoneLabel }

export type CallPlan =
  | { type: 'call'; choice: CallChoice; sure: boolean }
  | { type: 'choose'; options: CallChoice[]; reason: 'people' | 'numbers' }
  | { type: 'none' }

// relations people save contacts under (English + Hindi)
const RELATIONS: string[][] = [
  ['mom', 'mommy', 'mummy', 'mumma', 'mummi', 'maa', 'mother', 'mum', 'ammi', 'amma', 'aai', 'mata', 'mamma', 'mamaji'],
  ['dad', 'daddy', 'papa', 'pappa', 'father', 'pitaji', 'baba', 'abbu', 'appa', 'dady', 'pops'],
  ['brother', 'bro', 'bhai', 'bhaiya', 'bhaiyya', 'bhaia', 'bhaii'],
  ['sister', 'sis', 'didi', 'behen', 'behan', 'dii'],
  ['wife', 'biwi', 'wifey', 'patni'],
  ['husband', 'hubby', 'pati'],
  ['grandma', 'granny', 'grandmother', 'dadi', 'nani'],
  ['grandpa', 'grandfather', 'dada', 'nana'],
]
const relationOf = (w: string) => RELATIONS.find((g) => g.includes(w))

const CONTACT_FILLER = new Set(['my', 'the', 'ji', 'sir', 'madam', 'mam', 'maam', 'contact', 'number', 'phone', 'mobile', 's'])

function contactScore(q: string[], c: Contact): number {
  const name = tokens(c.name)
  if (!name.length) return 0
  if (q.join(' ') === name.join(' ')) return 1.1
  let sum = 0
  for (const w of q) {
    const rel = relationOf(w)
    const relHit = rel && name.some((n) => rel.includes(n)) ? (name.includes(w) ? 1 : 0.95) : 0
    sum += Math.max(relHit, wordScore(w, name))
  }
  let s = sum / q.length
  if (s >= 0.6 && name.every((n) => q.some((w) => wordScore(w, [n]) >= 0.75 || relationOf(w)?.includes(n)))) s += 0.05 // whole name said
  if (c.starred) s += 0.03
  return s
}

const last10 = (n: string) => n.replace(/\D/g, '').slice(-10)

export function planCall(query: string, label: PhoneLabel | undefined, contacts: Contact[]): CallPlan {
  const q = tokens(query).filter((w) => !CONTACT_FILLER.has(w))
  if (!q.length) return { type: 'none' }
  const scored = contacts
    .filter((c) => c.numbers.length)
    .map((c) => ({ c, s: contactScore(q, c) }))
    .filter((x) => x.s >= 0.7)
    .sort((a, b) => b.s - a.s)
  if (!scored.length) return { type: 'none' }

  // the same person saved twice (SIM + Google) counts once
  const people: { c: Contact; s: number }[] = []
  for (const x of scored) {
    const dup = people.find((p) => p.c.name.toLowerCase() === x.c.name.toLowerCase())
    if (dup) dup.c = { ...dup.c, numbers: [...dup.c.numbers, ...x.c.numbers] }
    else people.push({ ...x })
  }
  const top = people[0]
  const tied = people.filter((p) => p.s >= top.s - 0.04)
  if (tied.length > 1) {
    return { type: 'choose', reason: 'people', options: tied.slice(0, 5).map((p) => ({ name: p.c.name, ...bestNumber(p.c, label) })) }
  }

  const unique = top.c.numbers.filter((n, i, all) => all.findIndex((m) => last10(m.number) === last10(n.number)) === i)
  let nums = label ? unique.filter((n) => n.label === label) : unique
  if (!nums.length) nums = unique
  const sure = top.s >= 0.85
  if (nums.length === 1) return { type: 'call', choice: { name: top.c.name, ...nums[0] }, sure }
  const primary = nums.filter((n) => n.primary)
  if (primary.length === 1) return { type: 'call', choice: { name: top.c.name, ...primary[0] }, sure }
  const mobiles = nums.filter((n) => n.label === 'mobile')
  if (!label && mobiles.length === 1) return { type: 'call', choice: { name: top.c.name, ...mobiles[0] }, sure }
  return { type: 'choose', reason: 'numbers', options: nums.slice(0, 5).map((n) => ({ name: top.c.name, number: n.number, label: n.label })) }
}

function bestNumber(c: Contact, label?: PhoneLabel): { number: string; label: PhoneLabel } {
  const n = (label && c.numbers.find((x) => x.label === label)) || c.numbers.find((x) => x.primary) || c.numbers.find((x) => x.label === 'mobile') || c.numbers[0]
  return { number: n.number, label: n.label }
}
