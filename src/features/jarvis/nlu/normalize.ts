// Turns a raw speech transcript into a normalized, lower-case English command.
// Runs fully on-device: no AI service, no cost, works offline.
//
// Handles: wake-phrase prefixes, politeness filler, the user's own
// "when I say X I mean Y" corrections, common Hinglish (Latin script) and
// Devanagari scheduling words, spelled-out numbers next to time units.

import { autocorrect } from './autocorrect'

export interface Correction { heard: string; meant: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SMALL_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
}
const NUM_WORD = `(?:${Object.keys(SMALL_NUMBERS).join('|')})`

/** "twenty five" → 25, "forty-five" → 45, "seven" → 7 */
function wordsToNumber(s: string): number | null {
  const parts = s.toLowerCase().split(/[\s-]+/).filter(Boolean)
  let total = 0
  for (const p of parts) {
    const n = SMALL_NUMBERS[p]
    if (n === undefined) return null
    total += n
  }
  return parts.length ? total : null
}

// Devanagari → Latin equivalents the parser understands.
const DEVANAGARI: [RegExp, string][] = [
  [/परसों/g, ' parso '], [/कल/g, ' kal '], [/आज/g, ' aaj '], [/अभी/g, ' abhi '],
  [/सुबह/g, ' subah '], [/दोपहर/g, ' dopahar '], [/शाम/g, ' shaam '], [/रात/g, ' raat '],
  [/बजे/g, ' baje '], [/मिनट/g, ' minute '], [/घंटे|घंटा/g, ' ghante '], [/बाद/g, ' baad '],
  [/मीटिंग/g, ' meeting '], [/मिलना/g, ' milna '], [/के साथ/g, ' ke saath '], [/से/g, ' se '],
  [/नोट/g, ' note '], [/कैलेंडर/g, ' calendar '], [/अलार्म/g, ' alarm '], [/टास्क/g, ' task '],
  [/याद दिलाना|याद दिला देना|याद दिलाओ|याद दिला दो/g, ' yaad dilana '], [/रिमाइंड/g, ' remind '],
  [/करो|कर दो|कीजिए|करना/g, ' karo '], [/लगा दो|लगाओ|लगा देना/g, ' laga do '],
  [/बताओ|बता दो|बताइए/g, ' batao '], [/क्या/g, ' kya '], [/मेरा|मेरी|मेरे/g, ' mera '],
  [/सोमवार/g, ' monday '], [/मंगलवार/g, ' tuesday '], [/बुधवार/g, ' wednesday '], [/गुरुवार|बृहस्पतिवार/g, ' thursday '],
  [/शुक्रवार/g, ' friday '], [/शनिवार/g, ' saturday '], [/रविवार/g, ' sunday '],
  [/हर दिन|रोज़|रोज/g, ' every day '], [/हाँ|हां/g, ' haan '], [/नहीं/g, ' nahi '], [/धन्यवाद|शुक्रिया/g, ' thanks '],
  [/को/g, ' ko '], [/कॉल/g, ' call '], [/फ़ोन|फोन/g, ' phone '], [/कैंसिल|कैंसल/g, ' cancel '], [/हटा दो|हटाओ|हटा/g, ' hata do '],
  [/शिफ्ट/g, ' shift '], [/हो गया|हो गई/g, ' ho gaya '],
  [/[।॥]/g, ' '],
]
const DEVANAGARI_DIGITS = '०१२३४५६७८९'

// Hinglish (Latin script) → English. Order matters: specific phrases first.
const HINGLISH: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\bparso(?:n)?\b/g, 'day after tomorrow'],
  [/\b(?:aaj|aj)\s+(?:raat|rat)\b/g, 'tonight'],
  [/\b(?:aaj|aj)\b/g, 'today'],
  [/\bkal\b/g, 'tomorrow'], // when scheduling, "kal" means tomorrow
  [/\babhi\b/g, 'now'],
  [/\b(?:subah|subha|suba|savere|sawere)\b/g, 'morning'],
  [/\b(?:dopahar|dopehar|dupahar|dophar)\b/g, 'afternoon'],
  [/\b(?:shaam|sham|shyam)\b/g, 'evening'],
  [/\braat\b/g, 'night'],
  [/\b(?:har\s+din|roz(?:ana)?|daily)\b/g, 'every day'],
  [/\bsaa?de\s+(\d{1,2})\b/g, '$1:30'],
  [/\bsa(?:a)?va\s+(\d{1,2})\b|\bsavva\s+(\d{1,2})\b/g, (_m, a, b) => `${a ?? b}:15`],
  [/\bpaune\s+(\d{1,2})\b/g, (_m, h) => `${Number(h) <= 1 ? 12 : Number(h) - 1}:45`],
  [/\bdedh\s+baje\b/g, 'at 1:30'], [/\bdha(?:a)?i\s+baje\b/g, 'at 2:30'],
  [/\b(\d{1,2}(?::\d{2})?)\s*baje\b/g, 'at $1'],
  [/\b(\d+)\s*(?:minute|minutes|min|mins|mint)\s+(?:baad|bad|mein|me)\b/g, 'in $1 minutes'],
  [/\b(\d+)\s*(?:ghante|ghanta|ghanton|hour|hours)\s+(?:baad|bad|mein|me)\b/g, 'in $1 hours'],
  [/\b(\d+)\s*(?:din)\s+(?:baad|bad|mein|me)\b/g, 'in $1 days'],
  [/\b(\d+)\s*(?:ghante|ghanta)\b/g, '$1 hours'],
  [/\b(\d+)\s*(?:mint)\b/g, '$1 minutes'],
  [/\b([a-z]+)\s+(?:ke|ki)\s+sa(?:a)?th\b/g, 'with $1'],
  [/\b([a-z]+)\s+se\s+(?:milna|mulaqat|meeting)\b/g, 'meeting with $1'],
  [/\b(?:mujhe\s+)?yaad\s+dila(?:na|o|do|dena|iye|\s+dena|\s+do)\b/g, 'remind me'],
  [/\bmujhe\s+remind\s+(?:karo|kar\s+do|karna|kariye)\b/g, 'remind me'],
  [/\b(?:note|likh)\s+(?:kar\s+lo|karo|kar\s+do|lo|le|kar\s+lena|kar\s+le)\b/g, 'take a note'],
  [/\bcalendar\s+(?:me|mein|par|pe)\s+(?:daal|dal|daalo|dalo|add\s+karo|add\s+kar\s+do|laga|likh)\s*(?:do|dena|de)?\b/g, 'add to calendar'],
  [/\balarm\s+(?:laga|lagao|lagana|set\s+karo|set\s+kar\s+do|set\s+kar\s+dena)\s*(?:do|dena|de)?\b/g, 'set alarm'],
  [/\bmeeting\s+(?:set|fix|rakh|rakho|schedule|book)\s*(?:karo|kar\s+do|do|dena|kar\s+dena)?\b/g, 'schedule meeting'],
  [/\b(?:mera|meri|mere)\s+(?:schedule|din|plan)\s+(?:batao|bata\s+do|bataiye|kya\s+hai)\b/g, "what's my schedule"],
  [/\b(?:today|tomorrow)\s+kya\s+(?:hai|plan\s+hai)\b/g, (m) => `what's on ${m.split(/\s+/)[0]}`],
  [/\bkitne\s+baje\s+(?:hai|hain|hue)\b/g, 'what time is it'],
  [/\b(?:batao|bata\s+do|bataiye|bataye)\b/g, 'tell me'],
  [/\b(?:mujhe\s+)?motivate\s+(?:karo|kar\s+do|kijiye)\b/g, 'motivate me'],
  [/\bthak\s+gaya(?:\s+hu|\s+hoon)?\b|\bthaka\s+hua\s+hu\b/g, "i'm tired"],
  [/\b(?:shukriya|dhanyavaad|dhanyawad|thank\s+you\s+ji)\b/g, 'thanks'],
  // calls: "mummy ko call karo", "rahul sharma ko phone lagao"
  [/\b([a-z]+(?:\s+[a-z]+)?)\s+ko\s+(?:call|phone|fone|kol)\b(?:\s+(?:karo|kar\s*do|kar\s*dena|kardo|lagao|laga\s*do|lagana|milao|mila\s*do|karna|kar))?/g, (m: string, who: string) => {
    const w = who.split(' ')
    const keep: string[] = []
    while (w.length && CALL_STOP.has(w[0])) keep.push(w.shift()!)
    return w.length ? `${keep.join(' ')} call ${w.join(' ')}`.trim() : m
  }],
  // editing: "meeting ko 6 baje shift karo" → "move meeting to at 6"
  [/^(?!(?:remind|add|create|set|make|schedule|note|take|call)\b)(.+?)\s+ko\s+(.+?)\s+(?:shift|move|reschedule|postpone|prepone|change|badal|badlo|kar)(?:\s+(?:karo|kar\s*do|kar\s*dena|kardo|do|dena))?$/, 'move $1 to $2'],
  [/^(?!(?:remind|add|create|set|make|schedule|note|take|call|reschedule|move)\b)(.+?)\s+(?:ko\s+)?(?:(?:shift|reschedule|postpone|prepone)\s+(?:karo|kar\s*do|kar\s*dena|kardo|kar)|aage\s+(?:badha|badhao|badha\s+do|kar\s*do))$/, 'reschedule $1'],
  // "gym wali meeting cancel kar do", "kal ka dentist hata do"
  [/^(?!(?:remind|add|create|set|make|schedule|note|take|cancel|delete|remove|call)\b)(.+?)\s+(?:ko\s+)?(?:(?:cancel|delete|remove|radd)\s+(?:karo|kar\s*do|kar\s*dena|kardo|kar)|hata(?:o|\s+do|\s+dena)?|mita(?:o|\s+do|\s+dena)?)$/, 'cancel $1'],
  // "report ko done mark karo", "gym kar liya", "report ho gaya"
  [/^(.+?)\s+(?:ko\s+)?(?:done|complete)\s+(?:mark\s+)?(?:karo|kar\s*do|kardo)$/, 'mark $1 as done'],
  [/^(?:maine\s+)?(.+?)\s+(?:ho\s*gaya|ho\s*gayi|ho\s*gya|hogaya|kar\s+liya|kar\s+li|done\s+hai|complete\s+ho\s+gaya)$/, 'mark $1 as done'],
]

const CALL_STOP = new Set(['me', 'mujhe', 'remind', 'to', 'and', 'please', 'abhi', 'now'])

// filler that never changes meaning
const FILLER = /\b(?:please|plz|pls|kindly|could you|can you|would you|will you|i want you to|i'd like you to|i need you to|for me|zara|kripya|jarvis(?!\s+settings)|karo|kar do|kardo|kariye|kijiye|na|maine)\b/g

const WAKE_PREFIX = /^(?:(?:hey|hi|hello|ok|okay|radhe\s+radhe|radhe|radha\s+radha)\s+)?(?:jarvis|jervis|jarvish|javis|jaarvis|jarwis|lakshya|laksha|lakshay|lucky|luck\s+shia)\b[\s,.!?]*/

export function applyCorrections(text: string, corrections: Correction[]): string {
  let out = text
  for (const c of corrections) {
    const heard = c.heard.trim().toLowerCase()
    if (!heard) continue
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(heard)}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_m, pre) => `${pre}${c.meant.trim()}`)
  }
  return out
}

export interface Normalized {
  /** lower-case, cleaned command text the parser works on */
  text: string
  /** the user's words with corrections applied but original casing kept (for titles/notes) */
  cased: string
  /** true when the utterance began with "radhe radhe" (Jarvis greets back in kind) */
  radhe: boolean
}

export function normalize(raw: string, corrections: Correction[] = [], opts: { autocorrect?: boolean } = {}): Normalized {
  let cased = applyCorrections(raw.normalize('NFC'), corrections).replace(/\s+/g, ' ').trim()
  const radhe = /^\s*radh[ae]\s+radh[ae]/i.test(cased)
  // drop the wake phrase from the cased copy too
  cased = cased.replace(new RegExp(WAKE_PREFIX.source, 'i'), '').trim()

  let t = cased.toLowerCase()
  for (const [re, rep] of DEVANAGARI) t = t.replace(re, rep)
  t = t.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
  t = t
    .replace(/\b([ap])\.\s?m\.?(?=\s|$|[,!?])/g, '$1m') // "5 p.m." → "5 pm"
    .replace(/(\d)(am|pm)\b/g, '$1 $2')
    .replace(/[“”"]/g, '')
    .replace(/[,!?;]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (opts.autocorrect !== false) t = autocorrect(t)
  t = t.replace(WAKE_PREFIX, '').trim()
  for (const [re, rep] of HINGLISH) t = t.replace(re, rep as never)

  // spelled-out numbers next to time words → digits ("at five pm", "in twenty minutes")
  t = t.replace(new RegExp(`\\b(at|by|in|for|after|around|before)\\s+(${NUM_WORD}(?:[\\s-]${NUM_WORD})?)\\b`, 'g'), (m, pre, n) => {
    const v = wordsToNumber(n)
    return v === null ? m : `${pre} ${v}`
  })
  t = t.replace(new RegExp(`\\b(${NUM_WORD}(?:[\\s-]${NUM_WORD})?)\\s+(am|pm|o'?clock|minutes?|mins?|hours?|hrs?|days?|weeks?|seconds?|secs?)\\b`, 'g'), (m, n, unit) => {
    const v = wordsToNumber(n)
    return v === null ? m : `${v} ${unit}`
  })
  t = t.replace(/\b(an?|one)\s+and\s+a\s+half\s+hours?\b/g, '90 minutes').replace(/\bhalf\s+an?\s+hour\b/g, '30 minutes')

  t = t.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
  return { text: t, cased, radhe }
}

/** Map lower-case words back to how the user (or recognizer) cased them, e.g. names. */
export function caseMap(cased: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const w of cased.split(/[^\p{L}\p{N}'-]+/u)) {
    if (!w) continue
    const lw = w.toLowerCase()
    // keep the first capitalised spelling we see (proper nouns)
    if (w !== lw && !m.has(lw)) m.set(lw, w)
  }
  return m
}

export function restoreCase(text: string, map: Map<string, string>): string {
  return text.replace(/[\p{L}\p{N}'-]+/gu, (w) => map.get(w.toLowerCase()) ?? w)
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
