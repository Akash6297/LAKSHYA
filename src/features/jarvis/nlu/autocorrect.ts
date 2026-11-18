// Autocorrect for voice and typed commands. Fixes the misspellings people type
// ("calender", "shedule", "postphone") and the words speech recognisers
// commonly mishear ("remainder" for "reminder", "meating"). Runs offline.
//
// Two layers:
//   1. an explicit dictionary of known mistakes (safe for any word length)
//   2. fuzzy matching against long command keywords only (6+ letter words),
//      so short real words in titles ("cancer", "remain") are never touched.

const FIXES: Record<string, string> = {}
const add = (right: string, wrongs: string) => { for (const w of wrongs.split(/\s+/)) if (w) FIXES[w] = right }

add('calendar', 'calender calander calandar calendr calendor kalendar kalender callender')
add('calendars', 'calenders calanders')
add('meeting', 'meating meetng metting meetin meting meeing meetting mtg')
add('meetings', 'meatings meetngs mettings meetins')
add('schedule', 'shedule schedual schedul scedule skedule shedual schdule schedulle schedle shcedule')
add('reschedule', 'reshedule rescedule reschedual reskedule reschdule rescheduel reschedul')
add('reminder', 'remainder reminde remindr reminer remider')
add('reminders', 'remainders')
add('remind', 'remaind rimind remine')
add('alarm', 'alaram alram allarm alrm alarum allaram alaarm')
add('cancel', 'cancle cancal cansel kancel cancell cencel')
add('delete', 'delet delte dilit dlete deleat dellete delite')
add('appointment', 'apointment appointmnt appoinment apointmant appointmant appoitment')
add('postpone', 'postpond postpon postphone postpne')
add('prepone', 'prepond')
add('tomorrow', 'tomarrow tomorow tommorow tommorrow tomorro tmrw tmr 2morrow tomrw tommorw tomorrw')
add('tonight', 'tonite 2nite')
add('today', '2day')
add('wednesday', 'wensday wedensday wednsday wendsday')
add('thursday', 'thurday thrusday thursdy')
add('saturday', 'saterday satarday saturaday')
add('tuesday', 'tuseday tuesdy teusday')
add('friday', 'firday fryday fridy')
add('monday', 'mondey munday')
add('sunday', 'sundey sundy')
add('february', 'febuary feburary')
add('august', 'agust')
add('minutes', 'minuts minits')
add('minute', 'minit minut')
add('evening', 'evng evning')
add('morning', 'mornin mrng morng')
add('afternoon', 'afternon aftrnoon')
add('birthday', 'bday birtday brithday')
add('call', 'kol')
add('phone', 'fone')
add('task', 'tsk')
add('tasks', 'taks tasx')

// Long keywords that are worth fuzzy-matching.
const KEYWORDS = [
  'calendar', 'meeting', 'meetings', 'schedule', 'reschedule', 'reminder', 'reminders', 'appointment', 'postpone',
  'tomorrow', 'afternoon', 'evening', 'morning', 'tonight', 'wednesday', 'thursday', 'saturday', 'tuesday',
  'january', 'february', 'september', 'october', 'november', 'december', 'birthday', 'minutes',
]

// Ordinary words that sit one typo away from a keyword and must stay as they are.
const REAL_WORDS = new Set(['melting', 'mooring', 'evenings', 'mornings', 'greeting', 'meetup', 'sweeting', 'minuted', 'meeting', 'mention', 'morality'])

/** Damerau–Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

function fuzzyKeyword(w: string): string | null {
  if (w.length < 6 || REAL_WORDS.has(w) || KEYWORDS.includes(w) || /\d/.test(w)) return null
  let best: string | null = null
  let bestD = Infinity
  for (const k of KEYWORDS) {
    // inflections of a keyword ("scheduled", "reminders") are fine as they are
    if (w.startsWith(k) || k.startsWith(w)) return null
    const limit = k.length >= 10 ? 2 : 1
    const dist = editDistance(w, k, limit)
    if (dist <= limit && dist < bestD) { best = k; bestD = dist }
  }
  return best
}

/** Lower-case text in, corrected lower-case text out. Only whole words change. */
export function autocorrect(text: string): string {
  const t = text
    // "re schedule", "re-schedule", "pre pone", "post pone"
    .replace(/\bre[\s-]schedul\w*/g, 'reschedule')
    .replace(/\bpost[\s-]pone\b/g, 'postpone')
    .replace(/\bpre[\s-]pone\b/g, 'prepone')
    // "5 p m", "5 a. m."
    .replace(/(\d)\s*([ap])\s?\.?\s?m\b\.?/g, '$1 $2m')
  return t.replace(/[a-z0-9]+/g, (w) => FIXES[w] ?? fuzzyKeyword(w) ?? w)
}

// --- spoken phone numbers ------------------------------------------------------

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ek: '1', teen: '3', chaar: '4', paanch: '5', saat: '7', aath: '8', nau: '9', shunya: '0',
}

/**
 * "nine eight seven six five four three two one zero" → "9876543210",
 * also "double five", "triple seven", and mixed "98 76 five four 3210".
 * Returns null when the text isn't a phone number.
 */
export function spokenNumber(text: string): string | null {
  const parts = text.toLowerCase().replace(/[-().]/g, ' ').split(/\s+/).filter(Boolean)
  let out = ''
  let repeat = 1
  for (const p of parts) {
    if (p === 'double') { repeat = 2; continue }
    if (p === 'triple') { repeat = 3; continue }
    if (p === 'plus') { out += '+'; continue }
    if (/^\+?\d+$/.test(p)) {
      const digits = p.replace('+', '')
      out += (p.startsWith('+') ? '+' : '') + digits[0].repeat(repeat - 1) + digits
      repeat = 1
      continue
    }
    const d = DIGIT_WORDS[p]
    if (d === undefined) return null
    out += d.repeat(repeat)
    repeat = 1
  }
  const digits = out.replace(/\D/g, '')
  return digits.length >= 3 && digits.length <= 15 ? out : null
}
