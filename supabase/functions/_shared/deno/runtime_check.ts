// Deno runtime sanity check for the shared modules + npm deps used by the
// Edge Functions. Run: npx deno run --config supabase/functions/deno.json -A supabase/functions/_shared/deno/runtime_check.ts
import { expandOccurrences } from '../recurrence.ts'
import { planEventJobs } from '../reminders.ts'
import { isQuietTime, zonedInstant } from '../time.ts'
import webpush from 'npm:web-push@3.6.7'
import nodemailer from 'npm:nodemailer@6.9.16'

const occ = expandOccurrences(
  { id: 'm', start_at: '2026-03-02T14:00:00Z', end_at: '2026-03-02T15:00:00Z', timezone: 'America/New_York', rrule: 'FREQ=WEEKLY;BYDAY=MO' },
  new Date('2026-03-01T00:00:00Z'), new Date('2026-03-20T00:00:00Z'),
)
const ok1 = occ.map((o) => o.start.toISOString()).join() === '2026-03-02T14:00:00.000Z,2026-03-09T13:00:00.000Z,2026-03-16T13:00:00.000Z'
const jobs = planEventJobs({ now: new Date('2026-11-12T03:30:00Z'), lookaheadMs: 86_400_000, graceMs: 900_000 }, [{
  id: 'e', user_id: 'u', title: 'x', location: null, start_at: '2026-11-12T04:30:00Z', end_at: '2026-11-12T05:00:00Z', timezone: 'Asia/Kolkata',
  rrule: null, exdates: [], reminder_minutes: [30], recurring_event_id: null, original_start: null,
}])
const ok2 = jobs.length === 1 && jobs[0].fire_at === '2026-11-12T04:00:00.000Z'
const ok3 = isQuietTime(zonedInstant('2026-11-12', '23:00', 'Asia/Kolkata'), 'Asia/Kolkata', '22:30', '07:00')
const keys = webpush.generateVAPIDKeys()
const ok4 = typeof keys.publicKey === 'string' && typeof nodemailer.createTransport === 'function'
console.log({ recurrenceDST: ok1, reminderPlanning: ok2, quietHours: ok3, npmDepsLoad: ok4 })
if (!(ok1 && ok2 && ok3 && ok4)) Deno.exit(1)
