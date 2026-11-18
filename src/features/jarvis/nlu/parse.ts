// Rule-based intent parser for Jarvis. Deterministic and offline: the same
// words always do the same thing, which makes it easy to "train" with
// corrections and shortcuts (see JarvisSettings).
import type { MeetingPlatform, Priority } from '@/types/db'
import { capitalize, caseMap, normalize, restoreCase, type Correction } from './normalize'
import { hasWhen, parseWhen, stripSpans, type When } from './when'
import { parseRef, type ItemRef, type PhoneLabel } from './match'
import { spokenNumber } from './autocorrect'

export type Target = 'event' | 'meeting' | 'task' | 'note'
export type Mood = 'tired' | 'stressed' | 'lazy' | 'sad' | 'general'
export type AgendaFocus = 'all' | 'next' | 'meetings' | 'tasks'

export interface CreateCommand {
  kind: 'create'
  target: Target
  title: string
  when: When
  participants: string[]
  platform?: MeetingPlatform
  location?: string
  text?: string
  remind: boolean
  priority?: Priority
}

/** What to do with an existing calendar item or task. */
export type ItemAction =
  | { op: 'delete' }
  | { op: 'move'; when?: When; shiftMin?: number }
  | { op: 'extend'; minutes: number }
  | { op: 'rename'; title: string }
  | { op: 'complete' }

export type Command =
  | CreateCommand
  | { kind: 'item'; action: ItemAction; ref: ItemRef }
  | { kind: 'call'; who: string; number?: string; label?: PhoneLabel }
  | { kind: 'learn'; heard: string; meant: string }
  | { kind: 'info'; say: string }
  | { kind: 'alarm'; when: When; label: string }
  | { kind: 'timer'; minutes: number | null; label: string }
  | { kind: 'agenda'; when: When; focus: AgendaFocus }
  | { kind: 'briefing' }
  | { kind: 'motivate'; mood: Mood }
  | { kind: 'balance' }
  | { kind: 'navigate'; route: string; label: string }
  | { kind: 'focus'; minutes: number | null }
  | { kind: 'shortcut'; index: number }
  | { kind: 'undo' } | { kind: 'cancel' } | { kind: 'thanks' } | { kind: 'help' } | { kind: 'greet' }
  | { kind: 'time' } | { kind: 'date' } | { kind: 'yes' } | { kind: 'no' }
  | { kind: 'unknown'; title: string; when: When }

export interface ParseContext {
  now: Date
  tz: string
  corrections?: Correction[]
  shortcuts?: { phrase: string }[]
  /** fix misspelled / misheard command words (default on) */
  autocorrect?: boolean
}

export interface Parsed {
  command: Command
  /** normalized text the parser worked on (shown in the debug line of the UI) */
  normalized: string
  /** the user's words with corrections applied and the wake phrase removed, original casing */
  cased: string
  /** utterance started with "Radhe Radhe" */
  radhe: boolean
}

export const emptyWhen = (): When => ({ dateExplicit: false, spans: [] })

const ROUTES: [RegExp, string, string][] = [
  [/^(?:overview|home|dashboard|main screen|home screen)$/, '/', 'Overview'],
  [/^(?:my day|day planner|daily planner|planner)$/, '/my-day', 'My Day'],
  [/^(?:calendar|my calendar)$/, '/calendar', 'Calendar'],
  [/^(?:tasks?|to ?dos?|todo list|to do list|task list)$/, '/tasks', 'Tasks'],
  [/^projects?$/, '/projects', 'Projects'],
  [/^(?:work|office|work page)$/, '/work', 'Work'],
  [/^(?:study|studies|study planner)$/, '/study', 'Study Planner'],
  [/^meetings?$/, '/meetings', 'Meetings'],
  [/^notes?$/, '/notes', 'Notes'],
  [/^(?:goals?|habits?|goals and habits)$/, '/goals', 'Goals & Habits'],
  [/^(?:focus|focus mode|focus timer|pomodoro)$/, '/focus', 'Focus'],
  [/^(?:analytics|stats|statistics|reports?|insights)$/, '/analytics', 'Analytics'],
  [/^(?:notifications?|alerts)$/, '/notifications', 'Notifications'],
  [/^(?:jarvis settings|assistant settings|voice settings|jarvis)$/, '/settings#jarvis', 'Jarvis settings'],
  [/^(?:settings|preferences)$/, '/settings', 'Settings'],
]

function routeFor(name: string): { route: string; label: string } | null {
  const n = name.trim()
  for (const [re, route, label] of ROUTES) if (re.test(n)) return { route, label }
  return null
}

const PLATFORMS: [RegExp, MeetingPlatform][] = [
  [/^(?:zoom)$/, 'zoom'],
  [/^(?:google meet|g ?meet|meet|hangouts?)$/, 'google_meet'],
  [/^(?:teams|microsoft teams|ms teams)$/, 'teams'],
  [/^(?:phone|call|phone call|whatsapp|whatsapp call|mobile)$/, 'phone'],
  [/^(?:in person|office|person)$/, 'in_person'],
]

// words that never start/end a title
const EDGE = new Set([
  'to', 'about', 'for', 'a', 'an', 'the', 'my', 'me', 'that', 'this', 'it', 'on', 'at', 'in', 'of', 'with', 'and',
  'by', 'from', 'some', 'ka', 'ki', 'ke', 'ko', 'hai', 'se', 'mein', 'par', 'pe', 'called', 'named', 'titled',
  'saying', 'also', 'then', 'is', 'are', 'be', 'reminder', 'event', 'new', 'up', 'set', 'add',
])

export function cleanTitle(s: string, cm: Map<string, string>): string {
  const words = s.replace(/[:]/g, ' ').split(/\s+/).filter(Boolean)
  while (words.length && EDGE.has(words[0])) words.shift()
  while (words.length && EDGE.has(words[words.length - 1])) words.pop()
  return capitalize(restoreCase(words.join(' '), cm)).slice(0, 200)
}

function moodOf(t: string): Mood | null {
  if (/\b(?:i(?:'m| am)\s+(?:so\s+|very\s+|really\s+)?(?:tired|exhausted|sleepy|drained|worn out)|feeling\s+(?:tired|exhausted|sleepy|drained)|no energy)\b/.test(t)) return 'tired'
  if (/\b(?:stressed|stress(?:ed)? out|anxious|anxiety|overwhelmed|so much pressure|too much pressure|tension|worried|panicking)\b/.test(t)) return 'stressed'
  if (/\b(?:(?:i(?:'m| am)|feeling)\s+(?:so\s+|very\s+)?(?:lazy|unmotivated|demotivated|bored)|procrastinat\w*|don'?t feel like (?:working|studying|doing)|not in the mood)\b/.test(t)) return 'lazy'
  if (/\b(?:(?:i(?:'m| am)|feeling)\s+(?:so\s+|very\s+)?(?:sad|down|low|upset|depressed|lonely|bad)|bad day|rough day|tough day)\b/.test(t)) return 'sad'
  if (/\b(?:motivat\w*|inspir\w*|pep talk|encourage\w*|(?:a\s+)?quote|push me|boost me|cheer me up|uplift)\b/.test(t)) return 'general'
  return null
}

const CREATE_VERB = /\b(?:add|create|make|set ?up|book|put|block|arrange|organi[sz]e|remind|note|write|jot|save|log|record)\b|\bschedule\s+(?:a|an|the|my|meeting|call|event|it|this|that|time)\b|\bnew\s+(?:task|event|meeting|note)\b/
const QUESTION = /\b(?:what(?:'s| is| are| do i have)?|whats|show(?: me)?|tell me|read(?: out)?|list|any|anything|do i have|is there|kya|kaun|how many|when is)\b/

export function parseCommand(raw: string, ctx: ParseContext): Parsed {
  const n = normalize(raw, ctx.corrections, { autocorrect: ctx.autocorrect })
  return { command: detect(n.text, n.cased, ctx), normalized: n.text, cased: n.cased, radhe: n.radhe }
}

function detect(t: string, cased: string, ctx: ParseContext): Command {
  const words = t.split(' ').filter(Boolean)
  if (ctx.shortcuts?.length) {
    const i = ctx.shortcuts.findIndex((s) => {
      const p = normalize(s.phrase).text
      return !!p && (t === p || t.startsWith(`${p} `))
    })
    if (i >= 0) return { kind: 'shortcut', index: i }
  }
  if (!t) return { kind: 'greet' }
  if (/^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|save it|save|haan|han|ha|ji|ji haan|haan ji|theek hai|thik hai|correct|right|confirm|confirmed|absolutely|of course)(?: please| ji| sure)?$/.test(t)) return { kind: 'yes' }
  if (/^(?:no|nope|nah|nahi|nahin|don'?t|do not|mat|no thanks|wrong)$/.test(t)) return { kind: 'no' }
  if (/^(?:cancel|stop|never ?mind|nothing|exit|close|quit|bye|bye bye|goodbye|good night|bas|ruko|chhodo|leave it|that'?s all|that is all|that'?s it|shut up|be quiet|go away|done)$/.test(t)) return { kind: 'cancel' }
  if (/^(?:thanks?|thank you|thank u|thanks a lot|thank you so much|great|perfect|awesome|nice|good job|well done|cool|wonderful|excellent|super|thanks buddy)$/.test(t)) return { kind: 'thanks' }
  if (/^(?:hi|hello|hey|namaste|namaskar|radhe radhe|jai shri krishna|jai shree krishna|hare krishna|yo|sup|what'?s up|are you there|you there)$/.test(t)) return { kind: 'greet' }
  if (words.length <= 6 && (/\bundo\b|\btake (?:that|it) back\b/.test(t) || /^(?:(?:delete|remove|cancel|scrap) (?:that|it|this|the last(?: one| item| thing)?)|galat|galat hai|that'?s wrong)$/.test(t))) return { kind: 'undo' }
  if (/\b(?:help|what can you do|what do you do|commands|how (?:do i|to) use you|what can i (?:say|ask))\b/.test(t)) return { kind: 'help' }
  if (/^(?:what(?:'s| is) the time|what time is it|time|time now|the time|tell me the time|current time)(?: now)?$/.test(t)) return { kind: 'time' }
  if (/^(?:what(?:'s| is) (?:the |today'?s )?(?:date|day)(?: today)?|what day is (?:it|today)|today'?s date|tell me the date|date today)$/.test(t)) return { kind: 'date' }

  const learn = learnCommand(t, cased)
  if (learn) return learn
  const call = callCommand(t, cased, ctx)
  if (call) return call
  const item = itemCommand(t, cased, ctx)
  if (item) return item

  const create = CREATE_VERB.test(t)
  if (!create) {
    const mood = moodOf(t)
    if (mood) return { kind: 'motivate', mood }
  }
  if (/\b(?:work.?life|balance|burn ?out|burnt out|overwork\w*|working too (?:much|hard|long)|too much work|should i (?:rest|stop|take a break)|need a break|take a break)\b/.test(t) && !create) return { kind: 'balance' }
  if (/^(?:good (?:morning|afternoon|evening)|suprabhat|start my day|brief me|daily briefing|briefing|morning briefing|my briefing|how(?:'s| is) my day(?: looking)?(?: today)?|plan my day|what(?:'s| is) up today)$/.test(t) || /\bbriefing\b/.test(t)) return { kind: 'briefing' }

  // navigation: "open calendar", "go to my notes", "show me settings"
  const nav = t.match(/^(?:open|go to|goto|take me to|launch|switch to|show(?: me)?)\s+(?:the\s+|my\s+)?([a-z ]+?)(?:\s+(?:page|screen|tab|section))?$/)
  if (nav) {
    const r = routeFor(nav[1])
    if (r) return { kind: 'navigate', ...r }
  }
  const navPrefix = t.match(/^(?:open|go to|goto|take me to|launch|switch to)\s+(?:the\s+|my\s+)?([a-z]+(?: [a-z]+)?)/)
  if (navPrefix) {
    const r = routeFor(navPrefix[1]) ?? routeFor(navPrefix[1].split(' ')[0])
    if (r) return { kind: 'navigate', ...r }
  }

  // alarm / timer / focus
  if (/\b(?:alarm|wake me(?: up)?|wake up call|uthana|utha dena)\b/.test(t)) {
    const when = parseWhen(t, ctx.now, ctx.tz)
    if (/\bwake\b/.test(t) && !when.partOfDay && when.hm && !when.hm.certain && when.hm.h <= 11) when.partOfDay = 'morning'
    return { kind: 'alarm', when, label: alarmLabel(t, when) }
  }
  if (/\b(?:timer|countdown|count down)\b/.test(t)) {
    const when = parseWhen(t, ctx.now, ctx.tz)
    const minutes = when.durationMin ?? when.relativeMin ?? null
    return { kind: 'timer', minutes, label: '' }
  }
  if (!create && /\b(?:start|begin)\b.*\b(?:focus|pomodoro|deep work)\b|^(?:focus|focus mode|focus session|pomodoro|let'?s focus)$/.test(t)) {
    const when = parseWhen(t, ctx.now, ctx.tz)
    return { kind: 'focus', minutes: when.durationMin ?? when.relativeMin ?? null }
  }

  // agenda questions: "what's my schedule tomorrow", "any meetings today", "what's next"
  if (!create && (QUESTION.test(t) || /^(?:next meeting|my schedule|schedule|agenda)\b/.test(t) || /^(?:today|tomorrow)(?:'s)?(?:\s+(?:schedule|agenda|plan|meetings?|tasks?))?$/.test(t))) {
    const when = parseWhen(t, ctx.now, ctx.tz)
    const focus: AgendaFocus = /\bnext\b|\bupcoming\b/.test(t) ? 'next' : /\bmeetings?\b/.test(t) ? 'meetings' : /\b(?:tasks?|to ?dos?|todo|due)\b/.test(t) ? 'tasks' : 'all'
    if (focus !== 'all' || /\b(?:schedule|agenda|plan|calendar|day|today|tomorrow|events?|busy|free)\b/.test(t) || hasWhen(when)) return { kind: 'agenda', when, focus }
  }

  return createCommand(t, cased, ctx)
}

function alarmLabel(t: string, when: When): string {
  const rest = stripSpans(t, when.spans)
    .replace(/\b(?:set|create|add|make|put|keep)?\s*(?:an?\s+|my\s+)?alarm\b/g, ' ')
    .replace(/\bwake me(?: up)?\b|\bwake up call\b/g, ' ')
    .replace(/^\s*(?:for|to|called|labelled|labeled|named)\s+/, '')
  return cleanTitle(rest, new Map())
}

// --- teaching by voice --------------------------------------------------------
// "When I say jim I mean gym", "learn that RS means Rahul Sharma", "jim ka matlab gym"

const LEARN = /^(?:when(?:ever)?\s+i\s+say|if\s+i\s+say|learn\s+that|remember\s+that\s+when\s+i\s+say)\s+(.+?)\s*,?\s+(?:i\s+mean|i\s+meant|it\s+means|that\s+means|means|you\s+should\s+hear)\s+(.+?)[.!]?$/i
const LEARN_HI = /^(.+?)\s+ka\s+matlab\s+(.+?)(?:\s+(?:hai|he|hota hai))?[.!]?$/i

function learnCommand(t: string, cased: string): Command | null {
  const clean = (s: string) => s.replace(/["“”‘’]|^'|'$/g, '').trim()
  const m = cased.match(LEARN) ?? t.match(LEARN) ?? cased.match(LEARN_HI)
  if (!m) return null
  const heard = clean(m[1]), meant = clean(m[2])
  if (!heard || !meant || heard.toLowerCase() === meant.toLowerCase() || heard.split(/\s+/).length > 6) return null
  return { kind: 'learn', heard, meant }
}

// --- phone calls -----------------------------------------------------------------

const CALL = /^(?:(?:make|place|give|start)\s+(?:a\s+)?(?:phone\s+|voice\s+)?call\s+(?:to|with)|(?:phone|voice)\s+call\s+(?:to\s+)?|call\s+up|call\s+to|call|phone|dial|ring(?:\s+up)?|try\s+calling|connect\s+me\s+(?:to|with)|i\s+(?:want|need|would like|wanna)\s+to\s+(?:call|talk\s+to|speak\s+(?:to|with))|let\s+me\s+(?:call|talk\s+to))\s+(.+)$/

function callCommand(t: string, cased: string, ctx: ParseContext): Command | null {
  if (/^(?:call|phone)\s+(?:with|me|meeting)\b/.test(t)) return null // "call with Rahul at 5" is a meeting
  const m = t.match(CALL)
  if (!m || /^with\b/.test(m[1])) return null
  let who = ` ${m[1]} `
  let label: PhoneLabel | undefined
  who = who.replace(/\b(?:on|at)\s+(?:(?:his|her|their|the|my)\s+)?(mobile|cell|work|office|home|landline)(?:\s+(?:number|phone))?\b/, (_x, l: string) => {
    label = l === 'cell' ? 'mobile' : l === 'office' ? 'work' : l === 'landline' ? 'home' : (l as PhoneLabel)
    return ' '
  })
  who = who.replace(/\b(?:right now|now|immediately|abhi|asap|please|for me|on (?:speaker|loud ?speaker))\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (!who) return null
  const number = spokenNumber(who)
  if (number) return { kind: 'call', who: number, number, label }
  // "call mom at 8" is a reminder, not a call right now
  const when = parseWhen(who, ctx.now, ctx.tz)
  if (hasWhen(when)) return createCommand(`remind me to call ${who}`, cased, ctx)
  who = who.replace(/^(?:my|the)\s+/, '').replace(/'s$/, '')
  if (!who || who.split(' ').length > 5) return null
  return { kind: 'call', who: restoreCase(who, caseMap(cased)), label }
}

// --- changing existing items -----------------------------------------------------

const LEAD_IN = /^(?:i\s+(?:want|need|would like|wanna)\s+to|let'?s|go ahead and|just|also|then)\s+/

function itemCommand(t: string, cased: string, ctx: ParseContext): Command | null {
  const s = t.replace(LEAD_IN, '')
  const item = (action: ItemAction, refText: string, force: Partial<ItemRef> = {}): Command => {
    const ref = { ...parseRef(refText.replace(/\b(?:from|in|on)\s+(?:my\s+|the\s+)?(?:calendar|schedule|tasks?|to ?do(?: list)?|list)\b/g, ' '), ctx.now, ctx.tz), ...force }
    return { kind: 'item', action, ref }
  }
  const amount = (txt: string) => {
    const w = parseWhen(`for ${txt.replace(/^(?:another|an extra|extra)\s+/, '')}`, ctx.now, ctx.tz)
    return w.durationMin ?? null
  }
  let m: RegExpMatchArray | null

  // mark as done
  if ((m = s.match(/^(?:mark|set)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/))
    || (m = s.match(/^(?:complete|tick off|check off|cross off)\s+(.+)$/))
    || (m = s.match(/^i(?:'ve|\s+have)?(?:\s+already)?\s+(?:finished|completed|done with)\s+(.+)$/))
    || (m = s.match(/^(.+?)\s+(?:is|are|was)\s+(?:done|finished|completed)$/))) {
    return item({ op: 'complete' }, m[1])
  }
  if ((m = s.match(/^finish\s+(.+)$/)) && !hasWhen(parseWhen(m[1], ctx.now, ctx.tz))) return item({ op: 'complete' }, m[1])

  // rename
  if ((m = s.match(/^(?:rename|re name)\s+(.+?)\s+(?:to|as)\s+(.+)$/))
    || (m = s.match(/^change\s+(?:the\s+)?(?:name|title)\s+of\s+(.+?)\s+to\s+(.+)$/))
    || (m = s.match(/^change\s+(.+?)\s+(?:name|title)\s+to\s+(.+)$/))) {
    const title = cleanTitle(m[2], caseMap(cased))
    if (title) return item({ op: 'rename', title }, m[1])
  }

  // longer / shorter
  if ((m = s.match(/^(extend|lengthen|shorten|cut short|reduce)\s+(.+?)\s+by\s+(.+)$/))) {
    const min = amount(m[3])
    if (min) return item({ op: 'extend', minutes: /^(?:shorten|cut|reduce)/.test(m[1]) ? -min : min }, m[2])
  }

  // shift by an amount: "push my meeting back by 30 minutes", "move gym 1 hour earlier"
  const EARLIER = /^(?:prepone|bring forward|pull forward|advance|move up)$/
  if ((m = s.match(/^(postpone|push(?:\s+back)?|delay|move|shift|prepone|bring forward|pull forward|advance|move up)\s+(.+?)\s+(?:back\s+|forward\s+|ahead\s+)?by\s+(.+?)(?:\s+(later|earlier|ahead|back))?$/))
    || (m = s.match(/^(move|shift|push)\s+(.+?)\s+((?:\d+(?:\.\d+)?|an?|one|half an?)\s*(?:minutes?|mins?|hours?|hrs?|days?))\s+(later|earlier|ahead|back)$/))) {
    const min = amount(m[3])
    if (min) {
      const earlier = EARLIER.test(m[1]) || m[4] === 'earlier'
      return item({ op: 'move', shiftMin: earlier ? -min : min }, m[2])
    }
  }

  // "the meeting with Rahul is postponed to Friday"
  if ((m = s.match(/^(.+?)\s+(?:is|has been|got|was|will be)\s+(?:postponed|moved|rescheduled|shifted|pushed|preponed)\s+(?:to|till|until)\s+(.+)$/))) {
    const w = parseWhen(bareTime(m[2]), ctx.now, ctx.tz)
    if (hasWhen(w)) return item({ op: 'move', when: w }, m[1])
  }

  // move to a new time: "move my meeting with Rahul to 6 pm", "reschedule gym to tomorrow"
  if ((m = s.match(/^(re ?schedule|move|shift|postpone|push|delay|prepone|bring forward|change|update|edit|modify)\s+(.+)$/))) {
    const verb = m[1]
    const rest = m[2].replace(/^(?:the\s+)?(?:time|date|timing|day)\s+(?:of|for)\s+/, '')
    const splits = [...rest.matchAll(/\s(?:to|till|until|for|into|on)\s/g)].reverse()
    for (const sp of splits) {
      const left = rest.slice(0, sp.index)
      const right = rest.slice(sp.index! + sp[0].length)
      const w = parseWhen(bareTime(right), ctx.now, ctx.tz)
      if (left.trim() && hasWhen(w)) return item({ op: 'move', when: w }, left)
    }
    if (/^(?:change|update|edit|modify)$/.test(verb)) {
      if (/\b(?:meeting|event|task|reminder|appointment|calendar|schedule)\b/.test(rest)) {
        return { kind: 'info', say: 'I can change the time, the date or the name. Try “move my meeting with Rahul to 6 PM” or “rename it to Weekly review”.' }
      }
      return null
    }
    return item({ op: 'move' }, rest) // Jarvis asks for the new time
  }

  // delete / cancel
  if ((m = s.match(/^(?:delete|remove|cancel|erase|scrap|scratch|call off|clear|get rid of|discard|trash|drop)\s+(.+)$/))
    || (m = s.match(/^(.+?)\s+(?:is|has been|got|was|are|have been)\s+(?:cancelled|canceled|called off)$/))) {
    const what = m[1]
    if (/^(?:me|a|an)\b/.test(what) && /^drop/.test(s)) return null
    if (/\b(?:alarms?|timers?)\b/.test(what)) return { kind: 'info', say: 'Alarms and timers live in your Clock app. Open it to turn one off.' }
    if (/\bnotes?\b/.test(what)) return { kind: 'info', say: 'I can’t delete notes by voice yet. Open Notes to remove it.' }
    const clear = /^clear\b/.test(s) && /\b(?:schedule|calendar|day|plan|agenda|everything|meetings|tasks)\b/.test(what)
    return item({ op: 'delete' }, what, clear ? { all: true } : {})
  }
  return null
}

/** "6" / "6:30 pm" alone → "at 6" so the time parser accepts it. */
export function bareTime(s: string): string {
  return s.trim().replace(/^(\d{1,2}(?:[:.]\d{2})?)(\s*(?:am|pm))?(?=\s|$)/, 'at $1$2')
}

// --- creation ---------------------------------------------------------------

const NOTE_TRIGGER = /\b(?:take|make|add|create|write|save)\s+(?:a\s+)?(?:quick\s+|new\s+)?note(?:\s+(?:that|saying|of|about))?\b|\bnote\s+(?:down|that|this|it)\b|^note\b|\b(?:write|jot)\s+(?:this|that|it)?\s*down\b|\b(?:put|save|add)\s+(?:it|this|that)\s+(?:in|to|on|into)\s+(?:my\s+)?notes?\b|\b(?:add|put|save)\s+(?:to|in|into)\s+(?:my\s+)?notes?\b|\bremember that\b|\bnew note\b/

function noteBody(cased: string): string {
  const re = new RegExp(NOTE_TRIGGER.source.replace(/\\s\+/g, '[\\s,:]+'), 'i')
  const m = re.exec(cased)
  if (!m) return cased.trim()
  const before = cased.slice(0, m.index).trim()
  const after = cased.slice(m.index + m[0].length).trim()
  const body = after.length >= before.length ? after : before
  return body.replace(/^[\s:,.;-]*(?:that|this|saying)?[\s:,.;-]+/i, '').replace(/[\s:,;-]+$/, '').trim()
}

function noteTitle(body: string): string {
  const first = body.split(/(?<=[.!?])\s|\n/)[0] ?? body
  const words = first.replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean)
  const t = words.slice(0, 7).join(' ')
  return t ? capitalize(t) + (words.length > 7 ? '…' : '') : 'Voice note'
}

function createCommand(t: string, cased: string, ctx: ParseContext): Command {
  const cm = caseMap(cased)
  if (NOTE_TRIGGER.test(t)) {
    const body = noteBody(cased)
    return { kind: 'create', target: 'note', title: noteTitle(body), text: body, when: emptyWhen(), participants: [], remind: false }
  }

  const when = parseWhen(t, ctx.now, ctx.tz)
  let rest = stripSpans(t, when.spans)

  const remind = /\bremind(?:er)?\b|\bremember to\b|\bdon'?t let me forget\b/.test(rest)
  const meeting = /\b(?:meeting|meet(?:\s+up)?\s+with|call with|video call|zoom call|teams call|sync(?:\s+up)?\s+with|catch ?up with|standup|stand-up|interview|one on one|1:1|1 on 1)\b/
  const task = /\b(?:add (?:a )?task|new task|create (?:a )?task|to ?do|todo|task)\b/
  const event = /\b(?:calendar|event|schedule|block|book|appointment|add|put|create|plan|set ?up|organi[sz]e|arrange|make)\b/

  let target: Target | null = null
  if (/^(?:remind me|set (?:a )?reminder|reminder|remember to|don'?t let me forget)\b/.test(rest)) target = 'task'
  else if (meeting.test(rest)) target = 'meeting'
  else if (task.test(rest) || remind) target = 'task'
  else if (event.test(rest)) target = 'event'

  let priority: Priority | undefined
  rest = rest.replace(/\b(?:it'?s\s+)?(?:very\s+)?(urgent|important|high priority|top priority|asap|critical)\b/g, (_m, p: string) => {
    priority = p === 'critical' ? 'critical' : 'high'
    return ' '
  })

  if (!target) return { kind: 'unknown', title: cleanTitle(rest, cm), when }

  if (target === 'task') {
    const s = rest
      .replace(/\b(?:please\s+)?(?:remind me|set (?:a )?reminder|reminder|remember to|don'?t let me forget)\s*(?:to|about|that|of|for)?\s*/g, ' ')
      .replace(/\b(?:add|create|make|new|put)\s+(?:a\s+)?(?:task|to ?do|todo)(?:\s+(?:to|for|called|named|titled))?\s*/g, ' ')
      .replace(/\b(?:to|on|in|into)\s+(?:my\s+)?(?:tasks?|to ?do(?: list)?|todo list|list)\b/g, ' ')
      .replace(/^\s*(?:i\s+(?:need|have|must|should|want)\s+to|to)\s+/, ' ')
    return { kind: 'create', target, title: cleanTitle(s, cm), when, participants: [], remind, priority }
  }

  if (target === 'meeting') {
    let s = ` ${rest} `
    let platform: MeetingPlatform | undefined
    s = s.replace(/\b(?:on|via|over|using|through)\s+(zoom|google meet|g ?meet|meet|hangouts?|teams|microsoft teams|ms teams|phone|call|phone call|whatsapp(?: call)?)\b/g, (_m, p: string) => {
      platform = PLATFORMS.find(([re]) => re.test(p))?.[1]
      return ' '
    })
    s = s.replace(/\b(zoom|teams|whatsapp|video|phone)\s+(?=call\b|meeting\b)/g, (_m, p: string) => {
      platform ??= PLATFORMS.find(([re]) => re.test(p))?.[1]
      return ' '
    })
    let topic = ''
    s = s.replace(/\b(?:about|regarding|re|to discuss|discussing|on the topic of|for the|for)\s+(.+)$/, (_m, x: string) => { topic = x; return ' ' })
    const participants: string[] = []
    // names end at the next keyword (Hinglish puts the verb after the name: "with rahul schedule meeting")
    s = s.replace(/\bwith\s+(.+?)(?=\s+(?:and remind|at|in|on|for|to|about|regarding|schedule|set|book|fix|arrange|add|create|meeting|call|sync|catch)\b|\s*$)/, (_m, x: string) => {
      for (const part of x.split(/\s*(?:,|\band\b|&)\s*/)) {
        const name = cleanTitle(part.split(/\s+/).slice(0, 3).join(' '), cm)
        if (name && !/^(?:my|the|a|an|team)$/i.test(name)) participants.push(name.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase()))
      }
      return ' '
    })
    s = s
      .replace(/\b(?:schedule|set ?up|book|arrange|fix|add|create|put|plan|organi[sz]e|new|have|got|make|block)\b/g, ' ')
      .replace(/\b(?:on|to|in)\s+(?:the\s+|my\s+)?(?:calendar|schedule)\b/g, ' ')
    // "team sync" / "client review meeting" keep their words; a bare "meeting" becomes the default title
    let base = cleanTitle(s, cm)
    if (/^(?:meeting|meet(?: up)?|call|video call|sync(?: up)?|catch ?up)$/i.test(base)) base = ''
    const who = participants.join(', ')
    const topicTitle = cleanTitle(topic, cm)
    const title = `${base || 'Meeting'}${who ? ` with ${who}` : ''}${topicTitle ? ` – ${topicTitle}` : ''}`
    return { kind: 'create', target, title, when, participants, platform, remind, priority }
  }

  // event
  let s = rest
    .replace(/\b(?:on|to|in|into)\s+(?:the\s+|my\s+)?(?:calendar|schedule|diary|agenda)\b/g, ' ')
    .replace(/\b(?:add|put|create|make|schedule|set ?up|book|plan|block(?: out)?|arrange|organi[sz]e|save|log)\b(?:\s+(?:it|this|that|some time|time))?(?:\s+for)?/g, ' ')
    .replace(/^\s*(?:an?|the)\s+(?:new\s+)?(?:calendar\s+)?event\b(?:\s+(?:for|called|named|titled))?/, ' ')
  let location: string | undefined
  s = s.replace(/\b(?:at|in)\s+((?:the\s+)?[a-z][a-z' ]{1,40})$/, (m, place: string) => {
    if (/^(?:the\s+)?(?:morning|afternoon|evening|night|calendar)$/.test(place)) return m
    location = restoreCase(place.replace(/^the\s+/, ''), cm).replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
    return ' '
  })
  return { kind: 'create', target: 'event', title: cleanTitle(s, cm), when, participants: [], location, remind, priority }
}
