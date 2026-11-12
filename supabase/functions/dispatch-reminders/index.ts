// LAKSHYA reminder scheduler + dispatcher.
// Invoked every minute by pg_cron (or every 5+ minutes by GitHub Actions).
// Each run: (1) plan idempotent jobs for the lookahead window, (2) lease due
// jobs, (3) deliver per channel with per-channel success logs, (4) schedule
// retries with backoff. Safe to run concurrently or repeatedly.
import { adminClient, json, safeEqual } from '../_shared/deno/http.ts'
import { emailConfigured, sendEmail, sendPush, sendTelegram, type DeliveryResult } from '../_shared/deno/channels.ts'
import {
  DEFAULT_WINDOW_MS, MAX_REMINDER_MINUTES, jobsForOccurrence, planDigestJobs, planEventJobs,
  type EventRow, type PlannedJob, type Window,
} from '../_shared/reminders.ts'
import { expandOccurrences } from '../_shared/recurrence.ts'
import { addDaysKey, isQuietTime, localDateKey, zonedDayBounds, zonedInstant } from '../_shared/time.ts'
import { buildAgendaText, buildWeeklyText } from '../_shared/digest.ts'

type Db = ReturnType<typeof adminClient>
type Channel = 'in_app' | 'push' | 'email' | 'telegram'

const PAGE = 1000
const GRACE_MS = 15 * 60_000
const MISSED_AFTER_MS = 2 * 60 * 60_000
const MAX_ATTEMPTS = 5

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const given = req.headers.get('x-cron-secret') ?? ''
  if (!secret || !safeEqual(secret, given)) return json({ error: 'unauthorized' }, 401)

  const db = adminClient()
  const now = new Date()
  const result: Record<string, unknown> = { at: now.toISOString() }
  try {
    result.planned = await plan(db, { now, lookaheadMs: DEFAULT_WINDOW_MS, graceMs: GRACE_MS })
    result.dispatched = await dispatch(db, now)
    if (now.getUTCMinutes() === 0) await db.rpc('prune_reminder_data')
    await db.from('scheduler_heartbeat').upsert({ id: 1, last_run_at: now.toISOString(), last_result: result })
    return json(result)
  } catch (e) {
    console.error('dispatch-reminders failed', e)
    await db.from('scheduler_heartbeat').upsert({ id: 1, last_run_at: now.toISOString(), last_result: { error: String(e) } })
    return json({ error: 'internal error' }, 500)
  }
})

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) return all
  }
}

interface Prefs {
  user_id: string
  in_app_enabled: boolean; push_enabled: boolean; email_enabled: boolean; telegram_enabled: boolean
  email_address: string | null
  notify_events: boolean; notify_tasks: boolean; notify_meetings: boolean; notify_exams: boolean; notify_projects: boolean; notify_study: boolean
  daily_agenda_enabled: boolean; daily_agenda_time: string
  weekly_summary_enabled: boolean; weekly_summary_dow: number; weekly_summary_time: string
  quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string
  task_default_reminders: number[]; project_deadline_reminders: number[]
}

async function loadPrefs(db: Db, userIds?: string[]) {
  let q1 = db.from('notification_preferences').select('*')
  let q2 = db.from('user_settings').select('user_id, timezone')
  if (userIds) { q1 = q1.in('user_id', userIds); q2 = q2.in('user_id', userIds) }
  const prefs = await pageAll<Prefs>((a, b) => q1.range(a, b))
  const tz = new Map((await pageAll<{ user_id: string; timezone: string }>((a, b) => q2.range(a, b))).map((r) => [r.user_id, r.timezone]))
  return new Map(prefs.map((p) => [p.user_id, { ...p, timezone: tz.get(p.user_id) ?? 'Asia/Kolkata' }]))
}

// ---------------------------------------------------------------------------
// 1. Planning
// ---------------------------------------------------------------------------
async function plan(db: Db, w: Window): Promise<number> {
  const prefs = await loadPrefs(db)
  const from = new Date(w.now.getTime() - w.graceMs).toISOString()
  const until = new Date(w.now.getTime() + w.lookaheadMs + MAX_REMINDER_MINUTES * 60_000).toISOString()
  const jobs: PlannedJob[] = []
  const on = (uid: string, key: keyof Prefs) => prefs.get(uid)?.[key] !== false

  // Events: one-off in window, all recurring masters, and exceptions in window
  const evCols = 'id,user_id,title,location,start_at,end_at,timezone,rrule,exdates,reminder_minutes,recurring_event_id,original_start'
  const events = [
    ...await pageAll<EventRow>((a, b) => db.from('events').select(evCols).is('rrule', null).gte('start_at', from).lte('start_at', until).range(a, b)),
    ...await pageAll<EventRow>((a, b) => db.from('events').select(evCols).not('rrule', 'is', null).range(a, b)),
  ].filter((e) => on(e.user_id, 'notify_events') && e.reminder_minutes?.length)
  // exceptions need to be present (even without reminders) to suppress the master instance
  const exceptions = events.length
    ? await pageAll<EventRow>((a, b) => db.from('events').select(evCols).not('recurring_event_id', 'is', null).gte('original_start', from).lte('original_start', until).range(a, b))
    : []
  const seen = new Set(events.map((e) => e.id))
  jobs.push(...planEventJobs(w, [...events, ...exceptions.filter((e) => !seen.has(e.id))]).filter((j) => on(j.user_id, 'notify_events')))

  // Tasks: reminders before the time block (if scheduled) or before the deadline
  const tasks = await pageAll<{ id: string; user_id: string; title: string; start_at: string | null; due_at: string | null; has_due_time: boolean; reminder_minutes: number[] }>(
    (a, b) => db.from('tasks').select('id,user_id,title,start_at,due_at,has_due_time,reminder_minutes')
      .not('status', 'in', '(completed,cancelled)')
      .or(`and(start_at.gte.${from},start_at.lte.${until}),and(due_at.gte.${from},due_at.lte.${until})`)
      .range(a, b))
  for (const t of tasks) {
    if (!on(t.user_id, 'notify_tasks')) continue
    const anchor = t.start_at ?? (t.has_due_time ? t.due_at : null)
    const offsets = t.reminder_minutes?.length ? t.reminder_minutes : prefs.get(t.user_id)?.task_default_reminders ?? []
    if (anchor) jobs.push(...jobsForOccurrence(w, { user_id: t.user_id, type: 'task', id: t.id, title: t.title, link: `/tasks?task=${t.id}`, detail: t.start_at ? 'Scheduled task' : 'Task due' }, new Date(anchor), offsets))
    else if (t.due_at && t.reminder_minutes?.length) {
      // date-only deadline: anchor reminders at 09:00 local on the due date
      const tz = prefs.get(t.user_id)?.timezone ?? 'Asia/Kolkata'
      const nine = zonedInstant(localDateKey(new Date(new Date(t.due_at).getTime() - 1000), tz), '09:00', tz)
      jobs.push(...jobsForOccurrence(w, { user_id: t.user_id, type: 'task', id: t.id, title: t.title, link: `/tasks?task=${t.id}`, detail: 'Due today' }, nine, t.reminder_minutes))
    }
  }

  // Overdue: one notification per deadline, within 24h of passing
  const overdue = await pageAll<{ id: string; user_id: string; title: string; due_at: string }>(
    (a, b) => db.from('tasks').select('id,user_id,title,due_at').not('status', 'in', '(completed,cancelled)')
      .lt('due_at', w.now.toISOString()).gte('due_at', new Date(w.now.getTime() - 86_400_000).toISOString()).range(a, b))
  for (const t of overdue) {
    if (!on(t.user_id, 'notify_tasks')) continue
    jobs.push({ user_id: t.user_id, source_type: 'overdue', source_id: t.id, occurrence_at: t.due_at, offset_minutes: 0, fire_at: w.now.toISOString(),
      idempotency_key: `overdue:${t.id}:${new Date(t.due_at).toISOString()}`, payload: { title: `Overdue: ${t.title}`, body: 'This task passed its deadline.', link: `/tasks?task=${t.id}` } })
  }

  const meetings = await pageAll<{ id: string; user_id: string; title: string; start_at: string; reminder_minutes: number[]; platform: string }>(
    (a, b) => db.from('meetings').select('id,user_id,title,start_at,reminder_minutes,platform').gte('start_at', from).lte('start_at', until).range(a, b))
  for (const m of meetings) if (on(m.user_id, 'notify_meetings'))
    jobs.push(...jobsForOccurrence(w, { user_id: m.user_id, type: 'meeting', id: m.id, title: m.title, link: `/meetings?meeting=${m.id}`, detail: 'Meeting' }, new Date(m.start_at), m.reminder_minutes ?? []))

  const exams = await pageAll<{ id: string; user_id: string; title: string; exam_at: string; reminder_minutes: number[]; kind: string }>(
    (a, b) => db.from('exams').select('id,user_id,title,exam_at,reminder_minutes,kind').gte('exam_at', from).lte('exam_at', until).range(a, b))
  for (const x of exams) if (on(x.user_id, 'notify_exams'))
    jobs.push(...jobsForOccurrence(w, { user_id: x.user_id, type: 'exam', id: x.id, title: x.title, link: '/study', detail: x.kind === 'mock' ? 'Mock exam' : 'Exam' }, new Date(x.exam_at), x.reminder_minutes ?? []))

  const study = await pageAll<{ id: string; user_id: string; title: string | null; start_at: string; reminder_minutes: number[] }>(
    (a, b) => db.from('study_sessions').select('id,user_id,title,start_at,reminder_minutes').eq('completed', false).gte('start_at', from).lte('start_at', until).range(a, b))
  for (const s of study) if (on(s.user_id, 'notify_study'))
    jobs.push(...jobsForOccurrence(w, { user_id: s.user_id, type: 'study', id: s.id, title: s.title || 'Study session', link: '/study', detail: 'Study session' }, new Date(s.start_at), s.reminder_minutes ?? []))

  const untilDate = until.slice(0, 10)
  const projects = await pageAll<{ id: string; user_id: string; title: string; deadline: string }>(
    (a, b) => db.from('projects').select('id,user_id,title,deadline').not('status', 'in', '(completed,cancelled)')
      .gte('deadline', addDaysKey(w.now.toISOString().slice(0, 10), -1)).lte('deadline', untilDate).range(a, b))
  for (const p of projects) {
    if (!on(p.user_id, 'notify_projects')) continue
    const pr = prefs.get(p.user_id)
    const at = zonedInstant(p.deadline, '09:00', pr?.timezone ?? 'Asia/Kolkata')
    jobs.push(...jobsForOccurrence(w, { user_id: p.user_id, type: 'project', id: p.id, title: `Project deadline: ${p.title}`, link: `/projects/${p.id}` }, at, pr?.project_deadline_reminders ?? [1440]))
  }

  for (const p of prefs.values()) jobs.push(...planDigestJobs(w, { ...p, user_id: p.user_id }))

  let changed = 0
  for (let i = 0; i < jobs.length; i += 500) {
    const { data, error } = await db.rpc('upsert_reminder_jobs', { p_jobs: jobs.slice(i, i + 500) })
    if (error) throw error
    changed += data ?? 0
  }
  return changed
}

// ---------------------------------------------------------------------------
// 2–4. Dispatch
// ---------------------------------------------------------------------------
interface Job {
  id: string; user_id: string; source_type: string; source_id: string | null; fire_at: string; occurrence_at: string | null
  attempts: number; idempotency_key: string; payload: { title: string; body: string; link: string }
}

async function dispatch(db: Db, now: Date) {
  const stats = { claimed: 0, sent: 0, failed: 0, skipped: 0 }
  for (let round = 0; round < 5; round++) {
    const { data: jobs, error } = await db.rpc('claim_reminder_jobs', { p_limit: 50 })
    if (error) throw error
    if (!jobs?.length) break
    stats.claimed += jobs.length
    const prefs = await loadPrefs(db, [...new Set((jobs as Job[]).map((j) => j.user_id))])
    for (const job of jobs as Job[]) {
      const outcome = await deliverJob(db, job, prefs.get(job.user_id), now).catch((e) => ({ status: 'failed' as const, error: String(e) }))
      stats[outcome.status === 'sent' || outcome.status === 'partial' ? 'sent' : outcome.status === 'skipped' ? 'skipped' : 'failed']++
      const retry = outcome.status === 'failed' && job.attempts < MAX_ATTEMPTS
      await db.from('reminder_jobs').update({
        status: outcome.status,
        last_error: outcome.error ?? null,
        locked_at: null,
        sent_at: outcome.status === 'sent' || outcome.status === 'partial' ? new Date().toISOString() : null,
        // exponential backoff: 2, 4, 8, 16 minutes
        next_attempt_at: retry ? new Date(Date.now() + 2 ** job.attempts * 60_000).toISOString() : null,
      }).eq('id', job.id)
    }
    if (jobs.length < 50) break
  }
  return stats
}

type Outcome = { status: 'sent' | 'partial' | 'failed' | 'skipped'; error?: string }

async function deliverJob(db: Db, job: Job, prefs: (Prefs & { timezone: string }) | undefined, now: Date): Promise<Outcome> {
  if (!prefs) return { status: 'skipped', error: 'no preferences' }
  const isDigest = job.source_type === 'agenda' || job.source_type === 'weekly_summary'
  if (!isDigest && now.getTime() - new Date(job.fire_at).getTime() > MISSED_AFTER_MS) {
    return { status: 'skipped', error: 'missed delivery window (scheduler was not running)' }
  }

  // Re-validate the source: it may have been completed/deleted after planning.
  if (job.source_type === 'task' || job.source_type === 'overdue') {
    const { data } = await db.from('tasks').select('status').eq('id', job.source_id!).maybeSingle()
    if (!data || data.status === 'completed' || data.status === 'cancelled') return { status: 'skipped', error: 'task no longer active' }
  }

  let { title, body } = job.payload
  const { link } = job.payload
  if (job.source_type === 'agenda') body = await agendaFor(db, job.user_id, prefs.timezone, now)
  if (job.source_type === 'weekly_summary') body = await weeklyFor(db, job.user_id, now)

  const { data: done } = await db.from('notification_logs').select('channel').eq('reminder_job_id', job.id).eq('status', 'sent')
  const alreadySent = new Set((done ?? []).map((d: { channel: string }) => d.channel))
  const quiet = prefs.quiet_hours_enabled && isQuietTime(now, prefs.timezone, prefs.quiet_start, prefs.quiet_end)

  const channels: [Channel, boolean, () => Promise<DeliveryResult>][] = [
    ['in_app', prefs.in_app_enabled, async () => {
      const { error } = await db.from('notifications').upsert(
        { user_id: job.user_id, kind: job.source_type === 'agenda' ? 'agenda' : job.source_type === 'weekly_summary' ? 'summary' : job.source_type === 'overdue' ? 'overdue' : 'reminder',
          title, body, link, source_type: job.source_type, source_id: job.source_id, dedupe_key: job.idempotency_key },
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
      return error ? { ok: false, error: error.message } : { ok: true }
    }],
    ['push', prefs.push_enabled && !quiet, async () => {
      const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', job.user_id)
      const r = await sendPush(subs ?? [], { title, body: body.split('\n').slice(0, 4).join('\n'), link, tag: job.idempotency_key })
      if (r.expired?.length) await db.from('push_subscriptions').delete().in('endpoint', r.expired)
      return r
    }],
    ['email', prefs.email_enabled && !!prefs.email_address && emailConfigured() && !quiet, () =>
      sendEmail(prefs.email_address!, title, body, link)],
    ['telegram', prefs.telegram_enabled && !quiet, async () => {
      const { data } = await db.from('integration_secrets').select('secret').eq('user_id', job.user_id).eq('provider', 'telegram').maybeSingle()
      if (!data) return { ok: false, error: 'Telegram not configured' }
      const s = data.secret as { bot_token?: string; chat_id: string }
      return sendTelegram(s.bot_token || Deno.env.get('TELEGRAM_BOT_TOKEN') || '', s.chat_id, `🔔 ${title}\n${body}`)
    }],
  ]

  let attempted = 0, failed = 0
  const errors: string[] = []
  for (const [channel, enabled, send] of channels) {
    if (!enabled || alreadySent.has(channel)) continue
    attempted++
    const r = await send()
    await db.from('notification_logs').insert({ user_id: job.user_id, reminder_job_id: job.id, channel, status: r.ok ? 'sent' : 'failed', attempt: job.attempts, error: r.error ?? null })
    if (!r.ok) { failed++; errors.push(`${channel}: ${r.error}`) }
  }
  if (attempted === 0) return alreadySent.size ? { status: 'sent' } : { status: 'skipped', error: quiet ? 'quiet hours' : 'all channels disabled' }
  if (failed === 0) return { status: 'sent' }
  if (job.attempts >= MAX_ATTEMPTS) return { status: failed < attempted || alreadySent.size ? 'partial' : 'failed', error: errors.join('; ') }
  return { status: 'failed', error: errors.join('; ') }
}

async function agendaFor(db: Db, userId: string, tz: string, now: Date): Promise<string> {
  const day = localDateKey(now, tz)
  const [s, e] = zonedDayBounds(day, tz)
  const S = s.toISOString(), E = e.toISOString()
  const [ev, rec, ex, mt, st, due, od] = await Promise.all([
    db.from('events').select('title,start_at').eq('user_id', userId).is('rrule', null).is('recurring_event_id', null).lt('start_at', E).gte('end_at', S),
    db.from('events').select('id,title,start_at,end_at,timezone,rrule,exdates').eq('user_id', userId).not('rrule', 'is', null),
    db.from('events').select('title,start_at,recurring_event_id,original_start').eq('user_id', userId).not('recurring_event_id', 'is', null).lt('start_at', E).gte('end_at', S),
    db.from('meetings').select('title,start_at').eq('user_id', userId).gte('start_at', S).lt('start_at', E),
    db.from('study_sessions').select('title,start_at').eq('user_id', userId).gte('start_at', S).lt('start_at', E),
    db.from('tasks').select('title,priority').eq('user_id', userId).not('status', 'in', '(completed,cancelled)').gte('due_at', S).lt('due_at', E),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).not('status', 'in', '(completed,cancelled)').lt('due_at', now.toISOString()),
  ])
  const items: { title: string; start: Date; kind: string }[] = []
  for (const x of ev.data ?? []) items.push({ title: x.title, start: new Date(x.start_at), kind: 'event' })
  for (const x of ex.data ?? []) items.push({ title: x.title, start: new Date(x.start_at), kind: 'event' })
  const overridden = new Set((ex.data ?? []).map((x: { original_start: string }) => new Date(x.original_start).toISOString()))
  for (const m of rec.data ?? []) for (const o of expandOccurrences(m, s, e, overridden)) items.push({ title: m.title, start: o.start, kind: 'event' })
  for (const x of mt.data ?? []) items.push({ title: x.title, start: new Date(x.start_at), kind: 'meeting' })
  for (const x of st.data ?? []) items.push({ title: x.title || 'Study session', start: new Date(x.start_at), kind: 'study' })
  const dateLabel = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  return buildAgendaText({ timezone: tz, dateLabel, items, dueTasks: due.data ?? [], overdueCount: od.count ?? 0 })
}

async function weeklyFor(db: Db, userId: string, now: Date): Promise<string> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const [done, created, overdue, focus, study, meetings] = await Promise.all([
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('completed_at', since),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).not('status', 'in', '(completed,cancelled)').lt('due_at', now.toISOString()),
    db.from('focus_sessions').select('actual_minutes').eq('user_id', userId).eq('kind', 'focus').gte('started_at', since),
    db.from('study_sessions').select('actual_minutes,start_at,end_at,completed').eq('user_id', userId).eq('completed', true).gte('start_at', since),
    db.from('meetings').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('start_at', since).lt('start_at', now.toISOString()),
  ])
  return buildWeeklyText({
    completed: done.count ?? 0,
    created: created.count ?? 0,
    overdue: overdue.count ?? 0,
    focusMinutes: (focus.data ?? []).reduce((a: number, f: { actual_minutes: number }) => a + (f.actual_minutes ?? 0), 0),
    studyMinutes: (study.data ?? []).reduce((a: number, s: { actual_minutes: number | null; start_at: string; end_at: string }) =>
      a + (s.actual_minutes ?? Math.round((new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 60_000)), 0),
    meetings: meetings.count ?? 0,
  })
}
