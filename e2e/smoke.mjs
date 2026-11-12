// UI smoke test: drives the production build in Chromium against a mocked
// Supabase (REST + Auth), visits every page at desktop and phone sizes,
// fails on uncaught errors and saves screenshots to e2e/screenshots/.
// Run: npm run build:e2e && node e2e/smoke.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const PORT = 4179
const BASE = `http://localhost:${PORT}`
const UID = '11111111-1111-4111-8111-111111111111'
const now = Date.now()
const iso = (h) => new Date(now + h * 3_600_000).toISOString()
const day = (d) => new Date(now + d * 86_400_000).toISOString().slice(0, 10)
const base = { user_id: UID, created_at: iso(-200), updated_at: iso(-1) }
const cat = (id, name, slug, color, i) => ({ ...base, id, name, slug, color, sort_order: i })

const DB = {
  profiles: [{ id: UID, full_name: 'Asha Verma', avatar_url: null, created_at: iso(-500), updated_at: iso(-1) }],
  user_settings: [{ user_id: UID, timezone: 'Asia/Kolkata', theme: 'light', week_starts_on: 1, time_format: '12h', default_calendar_view: 'timeGridWeek', default_event_minutes: 60,
    working_hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { enabled: d > 0 && d < 6, start: '09:30', end: '18:00', mode: d % 2 ? 'office' : 'wfh' }])),
    focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, daily_focus_target_min: 120, daily_study_target_min: 120, weekly_study_target_min: 600, whatsapp_number: null, updated_at: iso(-1) }],
  notification_preferences: [{ user_id: UID, in_app_enabled: true, push_enabled: false, email_enabled: false, telegram_enabled: false, email_address: 'asha@example.com',
    notify_events: true, notify_tasks: true, notify_meetings: true, notify_exams: true, notify_projects: true, notify_study: true, daily_agenda_enabled: true, daily_agenda_time: '07:00:00',
    weekly_summary_enabled: true, weekly_summary_dow: 0, weekly_summary_time: '19:00:00', quiet_hours_enabled: false, quiet_start: '22:30:00', quiet_end: '07:00:00', task_default_reminders: [60], project_deadline_reminders: [1440] }],
  categories: [cat('c1', 'Office', 'office', '#6366F1', 1), cat('c2', 'Studies', 'studies', '#0EA5E9', 2), cat('c3', 'Personal', 'personal', '#F59E0B', 3), cat('c4', 'Health', 'health', '#10B981', 4)],
  projects: [
    { ...base, id: 'p1', title: 'Website relaunch', description: 'New marketing site', category_id: 'c1', start_date: day(-20), deadline: day(12), priority: 'high', status: 'active', progress: 45, progress_mode: 'auto', color: '#6366F1', links: [{ label: 'Figma', url: 'https://figma.com' }], notes: null, completed_at: null },
    { ...base, id: 'p2', title: 'GATE preparation', description: null, category_id: 'c2', start_date: day(-60), deadline: day(80), priority: 'critical', status: 'active', progress: 30, progress_mode: 'manual', color: '#0EA5E9', links: [], notes: null, completed_at: null },
  ],
  project_milestones: [{ ...base, id: 'm1', project_id: 'p1', title: 'Design sign-off', due_date: day(2), is_done: true, done_at: iso(-20), sort_order: 0 }, { ...base, id: 'm2', project_id: 'p1', title: 'Launch', due_date: day(12), is_done: false, done_at: null, sort_order: 1 }],
  tasks: [
    { id: 't1', title: 'Finalize homepage copy', priority: 'critical', status: 'in_progress', due_date: day(0), due_at: iso(4), project_id: 'p1', category_id: 'c1', start_at: iso(1), end_at: iso(2) },
    { id: 't2', title: 'Review pull request #42', priority: 'high', status: 'not_started', due_date: day(-1), due_at: iso(-10), category_id: 'c1' },
    { id: 't3', title: 'Revise thermodynamics notes', priority: 'medium', status: 'not_started', due_date: day(0), due_at: iso(8), category_id: 'c2', project_id: 'p2' },
    { id: 't4', title: 'Book dentist appointment', priority: 'low', status: 'pending', due_date: day(3), due_at: iso(72), category_id: 'c3', recurrence: 'monthly' },
    { id: 't5', title: 'Morning run', priority: 'medium', status: 'completed', due_date: day(0), due_at: iso(-2), completed_at: iso(-3), category_id: 'c4' },
  ].map((t) => ({ ...base, description: null, notes: null, milestone_id: null, meeting_id: null, project_id: null, start_date: null, start_at: null, end_at: null, has_due_time: true, tags: ['demo'], reminder_minutes: [30],
    recurrence: null, recurrence_parent_id: null, sort_order: 0, in_reschedule_queue: false, completed_at: null, client_key: null, ...t })),
  events: [
    { ...base, id: 'e1', title: 'Team standup', description: null, location: 'Zoom', meeting_url: 'https://zoom.us/j/1', notes: null, category_id: 'c1', project_id: null, priority: 'medium', tags: [], all_day: false,
      start_at: iso(-48 + 0.5), end_at: iso(-48 + 0.75), timezone: 'Asia/Kolkata', rrule: 'FREQ=DAILY', exdates: [], recurring_event_id: null, original_start: null, reminder_minutes: [10], client_key: null },
    { ...base, id: 'e2', title: 'Gym', description: null, location: null, meeting_url: null, notes: null, category_id: 'c4', project_id: null, priority: 'low', tags: [], all_day: false,
      start_at: iso(1.5), end_at: iso(2.5), timezone: 'Asia/Kolkata', rrule: null, exdates: [], recurring_event_id: null, original_start: null, reminder_minutes: [30], client_key: null },
  ],
  meetings: [{ ...base, id: 'mt1', title: 'Client review', start_at: iso(5), end_at: iso(6), platform: 'google_meet', meeting_url: 'https://meet.google.com/abc', agenda: '1. Demo\n2. Feedback', description: null, notes: '', project_id: 'p1', reminder_minutes: [30], attended: null, client_key: null }],
  meeting_participants: [{ ...base, id: 'pp1', meeting_id: 'mt1', name: 'Rahul', email: null }],
  subjects: [{ ...base, id: 's1', name: 'Thermodynamics', color: '#0EA5E9', target_hours: 40, archived: false }],
  chapters: [{ ...base, id: 'ch1', subject_id: 's1', title: 'First law', status: 'completed', completed_at: iso(-50), revision_count: 1, next_revision_date: day(-1), sort_order: 0 }, { ...base, id: 'ch2', subject_id: 's1', title: 'Entropy', status: 'in_progress', completed_at: null, revision_count: 0, next_revision_date: null, sort_order: 1 }],
  study_sessions: [{ ...base, id: 'ss1', subject_id: 's1', chapter_id: 'ch2', title: null, kind: 'study', start_at: iso(-26), end_at: iso(-24.5), completed: true, actual_minutes: 80, notes: null, reminder_minutes: [15] },
    { ...base, id: 'ss2', subject_id: 's1', chapter_id: null, title: 'Evening revision', kind: 'revision', start_at: iso(9), end_at: iso(10), completed: false, actual_minutes: null, notes: null, reminder_minutes: [15] }],
  exams: [{ ...base, id: 'x1', subject_id: 's1', title: 'GATE Mock 3', kind: 'mock', exam_at: iso(24 * 9), duration_minutes: 180, location: null, score: null, max_score: null, notes: null, reminder_minutes: [1440] }],
  time_off: [{ ...base, id: 'to1', kind: 'holiday', title: 'Diwali', start_date: day(6), end_date: day(7), status: 'approved', notes: null }],
  work_checklist_items: [{ ...base, id: 'w1', item_date: day(0), title: 'Check emails', is_done: true, sort_order: 0 }],
  notes: [{ ...base, id: 'n1', title: 'Launch ideas', content_html: '<h2>Ideas</h2><p>Use a <strong>countdown</strong>.</p>', content_text: 'Ideas Use a countdown.', kind: 'project', tags: ['launch'], is_pinned: true, is_archived: false, task_id: null, project_id: 'p1', event_id: null, meeting_id: null, subject_id: null }],
  goals: [{ ...base, id: 'g1', title: 'Read 12 books', description: null, goal_type: 'yearly', status: 'active', start_date: day(-300), target_date: day(60), target_value: 12, current_value: 7, unit: 'books', notes: null, completed_at: null }],
  goal_milestones: [],
  habits: [{ ...base, id: 'h1', title: 'Meditate', description: null, frequency: 'daily', days_of_week: [0, 1, 2, 3, 4, 5, 6], target_per_week: 7, color: '#10B981', archived: false }],
  habit_logs: [-1, -2, -3, -5, -6].map((d, i) => ({ ...base, id: `hl${i}`, habit_id: 'h1', log_date: day(d) })),
  focus_sessions: [{ ...base, id: 'f1', task_id: 't1', kind: 'focus', planned_minutes: 25, actual_minutes: 25, completed: true, started_at: iso(-3), ended_at: iso(-2.5) }],
  day_plans: [],
  notifications: [{ ...base, id: 'nt1', kind: 'agenda', title: 'Your agenda for today', body: '• 09:00 Team standup\n• 14:00 Client review', link: '/my-day', source_type: 'agenda', source_id: null, is_read: false, read_at: null }],
  notification_logs: [{ ...base, id: 'nl1', reminder_job_id: null, channel: 'in_app', status: 'sent', attempt: 1, error: null }],
  activity_logs: [{ ...base, id: 'a1', entity_type: 'task', entity_id: 't5', action: 'completed', changes: {} }],
  integrations: [], task_subtasks: [], task_dependencies: [], attachments: [], push_subscriptions: [],
  scheduler_heartbeat: [{ id: 1, last_run_at: iso(-0.02) }],
}

function handleRest(url, method, headers) {
  const u = new URL(url)
  const table = u.pathname.split('/rest/v1/')[1]
  if (table.startsWith('rpc/')) return { status: 200, body: table.endsWith('global_search') ? [{ kind: 'task', id: 't1', title: 'Finalize homepage copy', subtitle: 'in_progress', at: iso(4) }] : [] }
  if (method !== 'GET' && method !== 'HEAD') return { status: 201, body: method === 'DELETE' ? [] : [{ id: 'new', ...base }] }
  let rows = DB[table] ?? []
  // honour simple eq / id filters so detail pages resolve
  for (const [k, v] of u.searchParams) {
    if (v.startsWith('eq.') && rows.length && k in rows[0]) rows = rows.filter((r) => String(r[k]) === v.slice(3))
  }
  if (method === 'HEAD') return { status: 200, body: null, headers: { 'content-range': `0-0/${rows.length}` } }
  if ((headers.accept ?? '').includes('vnd.pgrst.object')) return rows[0] ? { status: 200, body: rows[0] } : { status: 406, body: { code: 'PGRST116', message: 'no rows' } }
  return { status: 200, body: rows, headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` } }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
await new Promise((r) => { server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()); setTimeout(r, 8000) })

mkdirSync('e2e/screenshots', { recursive: true })
const browser = await chromium.launch()
const failures = []
const PAGES = ['/', '/my-day', '/calendar', '/tasks', '/projects', '/projects/p1', '/work', '/study', '/meetings', '/notes', '/notes/n1', '/goals', '/focus', '/analytics', '/notifications', '/settings']

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' })
  await ctx.route('**/rest/v1/**', (route) => {
    const r = handleRest(route.request().url(), route.request().method(), route.request().headers())
    return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range', ...(r.headers ?? {}) }, body: r.body == null ? '' : JSON.stringify(r.body) })
  })
  await ctx.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: UID, email: 'asha@example.com' }) }))
  await ctx.route('**/realtime/v1/**', (route) => route.abort())
  await ctx.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await ctx.addInitScript(([uid]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: 'x.eyJzdWIiOiIxIn0.x', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
      user: { id: uid, email: 'asha@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }))
    localStorage.setItem('lakshya-theme', 'light')
  }, [UID])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|fonts\.g/i.test(m.text())) errors.push(`console: ${m.text()}`) })

  for (const path of PAGES) {
    errors.length = 0
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const crashed = await page.locator('text=Something went wrong').count()
    const overflow = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= window.innerWidth + 1) return null
      // report the outermost offending elements (skip intentional horizontal scrollers)
      const scrolls = (e) => { for (let p = e.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; return false }
      return [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !scrolls(e))
        .slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`).join(' ; ') || 'unknown'
    })
    const name = `${label}${path.replace(/\//g, '_') || '_home'}`
    await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: false })
    if (errors.length || crashed) failures.push(`${label} ${path}: ${errors.join(' | ') || 'crash screen'}`)
    if (overflow) failures.push(`${label} ${path}: horizontal overflow → ${overflow}`)
    console.log(`${errors.length || crashed || overflow ? '✗' : '✓'} ${label} ${path}`)
  }

  // interactions: quick add modal, search palette, task modal
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.keyboard.press('q')
  if (!(await page.getByRole('dialog', { name: 'Quick add' }).isVisible())) failures.push(`${label}: Q shortcut did not open quick add`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.getByLabel('Search query').fill('home')
  await page.waitForTimeout(600)
  if (!(await page.getByText('Finalize homepage copy').first().isVisible())) failures.push(`${label}: search returned nothing`)
  await page.screenshot({ path: `e2e/screenshots/${label}_search.png` })
  await page.keyboard.press('Escape')
  await page.keyboard.press('t')
  await page.getByRole('button', { name: 'Create task' }).click()
  if (!(await page.getByText('Title is required').isVisible())) failures.push(`${label}: task form validation not shown`)
  await page.screenshot({ path: `e2e/screenshots/${label}_task_form.png` })
  await ctx.close()
}

// dark theme + logged-out screens
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', serviceWorkers: 'block' })
await ctx.route('https://fonts.googleapis.com/**', (route) => route.abort())
const p = await ctx.newPage()
await p.goto(BASE + '/login', { waitUntil: 'networkidle' })
await p.screenshot({ path: 'e2e/screenshots/dark_login.png' })
await p.goto(BASE + '/my-day', { waitUntil: 'networkidle' })
if (!p.url().endsWith('/login')) failures.push('protected route did not redirect to /login when signed out')

await browser.close()
server.kill()
if (failures.length) {
  console.error('\nFAILURES:\n' + failures.join('\n'))
  process.exit(1)
}
console.log('\nAll smoke checks passed.')
