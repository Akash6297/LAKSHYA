// @vitest-environment node
// Runs the real migrations inside PGlite (Postgres compiled to WASM) with
// minimal stand-ins for Supabase's auth/storage schemas, then verifies RLS
// isolation and the business-logic triggers.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = join(__dirname, '..', 'migrations')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

let db: PGlite

const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);` : 'reset role;')
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}

const q = async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(SUPABASE_STUBS)
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${A}', 'a@example.com', '{"full_name":"Asha"}'),
      ('${B}', 'b@example.com', '{"timezone":"Not/AZone"}');
  `)
}, 60_000)

afterAll(async () => db?.close())

describe('signup bootstrap', () => {
  it('creates profile, settings, preferences and default categories', async () => {
    const [p] = await q<{ full_name: string }>(`select full_name from profiles where id = $1`, [A])
    expect(p.full_name).toBe('Asha')
    const [s] = await q<{ timezone: string }>(`select timezone from user_settings where user_id = $1`, [B])
    expect(s.timezone).toBe('Asia/Kolkata') // invalid zone in metadata falls back safely
    const cats = await q(`select slug from categories where user_id = $1`, [A])
    expect(cats).toHaveLength(10)
  })
})

describe('row level security', () => {
  it('isolates users from each other', async () => {
    await as(A, () => q(`insert into tasks (title) values ('A secret task')`))
    const seenByB = await as(B, () => q(`select * from tasks`))
    expect(seenByB).toHaveLength(0)
    const updated = await as(B, () => q(`update tasks set title = 'pwned' returning id`))
    expect(updated).toHaveLength(0)
    const seenByA = await as(A, () => q<{ title: string }>(`select title from tasks`))
    expect(seenByA.map((t) => t.title)).toEqual(['A secret task'])
  })

  it('rejects forged user_id on insert', async () => {
    await expect(as(B, () => q(`insert into tasks (user_id, title) values ($1, 'forged')`, [A]))).rejects.toThrow(/row-level security/)
  })

  it('blocks referencing another user\'s parent record', async () => {
    const [proj] = await as(A, () => q<{ id: string }>(`insert into projects (title) values ('A project') returning id`))
    await expect(as(B, () => q(`insert into tasks (title, project_id) values ('sneaky', $1)`, [proj.id]))).rejects.toThrow(/foreign key/)
  })

  it('anon sees nothing', async () => {
    await db.exec('set role anon')
    await expect(db.query('select * from tasks')).rejects.toThrow(/permission denied/)
    await db.exec('reset role')
  })

  it('keeps integration secrets unreadable by clients', async () => {
    await as(A, () => q(`select save_telegram_integration('', '123456789')`))
    await expect(as(A, () => q(`select * from integration_secrets`))).rejects.toThrow(/permission denied/)
    const [i] = await as(A, () => q<{ display_hint: string }>(`select display_hint from integrations`))
    expect(i.display_hint).toContain('6789')
    await expect(as(A, () => q(`select save_telegram_integration('bad-token', '123456789')`))).rejects.toThrow(/token/)
  })

  it('does not let clients run the reminder worker or forge jobs', async () => {
    await expect(as(A, () => q(`select * from claim_reminder_jobs(10)`))).rejects.toThrow(/permission denied/)
    await expect(as(A, () => q(`insert into reminder_jobs (user_id, source_type, fire_at, idempotency_key) values ($1, 'task', now(), 'x')`, [A])))
      .rejects.toThrow(/permission denied/)
  })
})

describe('business logic triggers', () => {
  it('stamps completion and spawns the next recurring task exactly once', async () => {
    const [t] = await as(A, () =>
      q<{ id: string }>(`insert into tasks (title, due_date, recurrence) values ('Water plants', '2026-11-13', 'weekdays') returning id`))
    await as(A, () => q(`update tasks set status = 'completed' where id = $1`, [t.id]))
    await as(A, () => q(`update tasks set status = 'in_progress' where id = $1`, [t.id]))
    await as(A, () => q(`update tasks set status = 'completed' where id = $1`, [t.id]))
    const next = await as(A, () => q<{ due_date: Date; status: string }>(`select due_date, status from tasks where recurrence_parent_id = $1`, [t.id]))
    expect(next).toHaveLength(1)
    expect(next[0].status).toBe('not_started')
    expect(new Date(next[0].due_date).toISOString().slice(0, 10)).toBe('2026-11-16') // Friday → Monday
    const [done] = await as(A, () => q<{ completed_at: string | null }>(`select completed_at from tasks where id = $1`, [t.id]))
    expect(done.completed_at).not.toBeNull()
  })

  it('auto-computes project progress from tasks', async () => {
    const [p] = await as(A, () => q<{ id: string }>(`insert into projects (title) values ('Launch') returning id`))
    await as(A, () => q(`insert into tasks (title, project_id, status) values ('a', $1, 'completed'), ('b', $1, 'not_started'), ('c', $1, 'cancelled'), ('d', $1, 'completed')`, [p.id]))
    const [{ progress }] = await as(A, () => q<{ progress: number }>(`select progress from projects where id = $1`, [p.id]))
    expect(progress).toBe(67)
  })

  it('cancels pending reminders when the source changes', async () => {
    const [e] = await as(A, () => q<{ id: string }>(
      `insert into events (title, start_at, end_at) values ('Dentist', now() + interval '1 day', now() + interval '1 day 1 hour') returning id`))
    await q(`insert into reminder_jobs (user_id, source_type, source_id, fire_at, idempotency_key) values ($1, 'event', $2, now() + interval '23 hours', 'k1')`, [A, e.id])
    await as(A, () => q(`update events set start_at = start_at + interval '1 hour', end_at = end_at + interval '1 hour' where id = $1`, [e.id]))
    const [job] = await q<{ status: string }>(`select status from reminder_jobs where idempotency_key = 'k1'`)
    expect(job.status).toBe('cancelled')
  })

  it('claims due jobs exactly once (skip locked lease)', async () => {
    await q(`insert into reminder_jobs (user_id, source_type, fire_at, idempotency_key) values ($1, 'agenda', now() - interval '1 minute', 'due-1')`, [A])
    const first = await q(`select * from claim_reminder_jobs(10)`)
    const second = await q(`select * from claim_reminder_jobs(10)`)
    expect(first.map((j: Record<string, unknown>) => j.idempotency_key)).toContain('due-1')
    expect(second.map((j: Record<string, unknown>) => j.idempotency_key)).not.toContain('due-1')
  })

  it('records history in activity_logs', async () => {
    const rows = await as(A, () => q<{ action: string }>(`select action from activity_logs where entity_type = 'task'`))
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['created', 'completed', 'reopened']))
  })

  it('rejects invalid timezones', async () => {
    await expect(as(A, () => q(`update user_settings set timezone = 'Mars/Olympus'`))).rejects.toThrow(/Unknown timezone/)
  })
})

describe('data ownership', () => {
  it('searches only the caller\'s data', async () => {
    const a = await as(A, () => q(`select * from global_search('secret')`))
    const b = await as(B, () => q(`select * from global_search('secret')`))
    expect(a.length).toBeGreaterThan(0)
    expect(b).toHaveLength(0)
  })

  it('imports a backup transactionally into the caller\'s account', async () => {
    const backup = {
      projects: [{ id: '33333333-3333-4333-8333-333333333333', title: 'Imported project', status: 'active', priority: 'high', progress: 0, progress_mode: 'auto', color: '#6D6AF0', links: [] }],
      tasks: [{ id: '44444444-4444-4444-8444-444444444444', title: 'Imported task', project_id: '33333333-3333-4333-8333-333333333333', status: 'not_started', priority: 'low', tags: [], reminder_minutes: [], sort_order: 0, has_due_time: false, in_reschedule_queue: false }],
    }
    const [r] = await as(B, () => q<{ import_backup: Record<string, number> }>(`select import_backup($1::jsonb)`, [JSON.stringify(backup)]))
    expect(r.import_backup).toEqual({ projects: 1, tasks: 1 })
    const [t] = await q<{ user_id: string }>(`select user_id from tasks where id = '44444444-4444-4444-8444-444444444444'`)
    expect(t.user_id).toBe(B)

    const bad = { tasks: [{ id: '55555555-5555-4555-8555-555555555555', title: 'x', project_id: '33333333-3333-4333-8333-333333333333', status: 'not_started', priority: 'low' }], notes: [{ title: null }] }
    await expect(as(B, () => q(`select import_backup($1::jsonb)`, [JSON.stringify(bad)]))).rejects.toThrow()
    const leaked = await q(`select 1 from tasks where id = '55555555-5555-4555-8555-555555555555'`)
    expect(leaked).toHaveLength(0) // whole import rolled back
  })

  it('deletes all personal data but keeps the account usable', async () => {
    await as(B, () => q(`select delete_all_my_data()`))
    const tasks = await as(B, () => q(`select * from tasks`))
    const cats = await as(B, () => q(`select * from categories`))
    expect(tasks).toHaveLength(0)
    expect(cats).toHaveLength(10)
    const aTasks = await as(A, () => q(`select * from tasks`))
    expect(aTasks.length).toBeGreaterThan(0)
  })
})
