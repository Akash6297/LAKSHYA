-- =============================================================================
-- LAKSHYA – reminder worker helpers (service role only)
-- =============================================================================

-- Idempotent job upsert. A key that was already delivered is never re-queued;
-- a key that was cancelled (source edited) is revived with the fresh payload.
create or replace function public.upsert_reminder_jobs(p_jobs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.reminder_jobs (user_id, source_type, source_id, occurrence_at, offset_minutes, fire_at, idempotency_key, payload)
  select j.user_id, j.source_type, j.source_id, j.occurrence_at, j.offset_minutes, j.fire_at, j.idempotency_key, j.payload
    from jsonb_to_recordset(p_jobs) as j(user_id uuid, source_type text, source_id uuid, occurrence_at timestamptz,
                                         offset_minutes int, fire_at timestamptz, idempotency_key text, payload jsonb)
  on conflict (idempotency_key) do update
     set status = 'pending', payload = excluded.payload, fire_at = excluded.fire_at,
         attempts = 0, next_attempt_at = null, last_error = null, locked_at = null
   where reminder_jobs.status = 'cancelled';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.upsert_reminder_jobs(jsonb) from public, anon, authenticated;

-- Housekeeping to stay well inside the 500 MB free database.
create or replace function public.prune_reminder_data() returns void
language sql security definer set search_path = public as $$
  delete from public.reminder_jobs where status in ('sent', 'partial', 'cancelled', 'skipped') and updated_at < now() - interval '30 days';
  delete from public.reminder_jobs where status = 'failed' and attempts >= 5 and updated_at < now() - interval '30 days';
  delete from public.notification_logs where created_at < now() - interval '90 days';
  delete from public.notifications where is_read and created_at < now() - interval '90 days';
  delete from public.activity_logs where created_at < now() - interval '365 days';
$$;
revoke execute on function public.prune_reminder_data() from public, anon, authenticated;

-- Worker heartbeat so the UI can show whether the scheduler is running.
create table public.scheduler_heartbeat (
  id          smallint primary key default 1 check (id = 1),
  last_run_at timestamptz not null,
  last_result jsonb
);
alter table public.scheduler_heartbeat enable row level security;
create policy "authenticated can read heartbeat" on public.scheduler_heartbeat for select to authenticated using (true);
revoke insert, update, delete on public.scheduler_heartbeat from anon, authenticated;
revoke all on public.scheduler_heartbeat from anon;
