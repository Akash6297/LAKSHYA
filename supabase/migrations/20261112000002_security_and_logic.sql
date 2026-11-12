-- =============================================================================
-- LAKSHYA – Row Level Security, grants, triggers and RPCs
-- =============================================================================

-- ---------- RLS: owner-only CRUD on every user table -------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'categories','projects','project_milestones','events','tasks','task_subtasks','task_dependencies',
    'meetings','meeting_participants','subjects','chapters','study_sessions','exams','time_off',
    'work_checklist_items','notes','goals','goal_milestones','habits','habit_logs','focus_sessions',
    'day_plans','attachments','notifications','push_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- singleton per-user tables (PK = user_id); rows are created by the signup trigger
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.user_settings enable row level security;
create policy "own settings select" on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "own settings insert" on public.user_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own settings update" on public.user_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.notification_preferences enable row level security;
create policy "own prefs select" on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy "own prefs insert" on public.notification_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own prefs update" on public.notification_preferences for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- read-only for clients (written by server / security-definer functions)
alter table public.integrations enable row level security;
create policy "own integrations select" on public.integrations for select to authenticated using (user_id = (select auth.uid()));
create policy "own integrations delete" on public.integrations for delete to authenticated using (user_id = (select auth.uid()));

alter table public.notification_logs enable row level security;
create policy "own logs select" on public.notification_logs for select to authenticated using (user_id = (select auth.uid()));

alter table public.reminder_jobs enable row level security;
create policy "own jobs select" on public.reminder_jobs for select to authenticated using (user_id = (select auth.uid()));

alter table public.activity_logs enable row level security;
create policy "own activity select" on public.activity_logs for select to authenticated using (user_id = (select auth.uid()));

-- secrets: RLS with no policies + revoked privileges = invisible to clients
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

-- anon role gets nothing on user data
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- clients may not forge job/log rows
revoke insert, update on public.reminder_jobs, public.notification_logs, public.activity_logs from authenticated;
revoke insert, update on public.integrations from authenticated;

-- ---------- signup bootstrap ------------------------------------------------
create or replace function public.seed_default_categories(p_user uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.categories (user_id, name, slug, color, sort_order) values
    (p_user, 'Office',    'office',    '#6366F1', 1),
    (p_user, 'Projects',  'projects',  '#8B5CF6', 2),
    (p_user, 'Studies',   'studies',   '#0EA5E9', 3),
    (p_user, 'Meetings',  'meetings',  '#14B8A6', 4),
    (p_user, 'Personal',  'personal',  '#F59E0B', 5),
    (p_user, 'Exams',     'exams',     '#EF4444', 6),
    (p_user, 'Deadlines', 'deadlines', '#F43F5E', 7),
    (p_user, 'Health',    'health',    '#10B981', 8),
    (p_user, 'Family',    'family',    '#EC4899', 9),
    (p_user, 'Other',     'other',     '#64748B', 10)
  on conflict (user_id, slug) do nothing;
$$;
revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
    values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 120))
    on conflict do nothing;
  insert into public.user_settings (user_id, timezone)
    values (new.id, coalesce(
      (select name from pg_timezone_names where name = new.raw_user_meta_data->>'timezone' limit 1),
      'Asia/Kolkata'))
    on conflict do nothing;
  insert into public.notification_preferences (user_id, email_address)
    values (new.id, new.email) on conflict do nothing;
  perform public.seed_default_categories(new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Guard: a timezone must be a real IANA zone
create or replace function public.validate_timezone() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
create trigger validate_tz before insert or update of timezone on public.user_settings
  for each row execute function public.validate_timezone();
create trigger validate_tz before insert or update of timezone on public.events
  for each row execute function public.validate_timezone();

-- ---------- tasks: completion bookkeeping + recurrence ----------------------
create or replace function public.tasks_before_write() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
    new.in_reschedule_queue := false;
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create or replace function public.next_recurrence_date(p_date date, p_rule text) returns date
language sql immutable as $$
  select case p_rule
    when 'daily'    then p_date + 1
    when 'weekdays' then p_date + case extract(isodow from p_date)::int when 5 then 3 when 6 then 2 else 1 end
    when 'weekly'   then p_date + 7
    when 'biweekly' then p_date + 14
    when 'monthly'  then (p_date + interval '1 month')::date
    when 'yearly'   then (p_date + interval '1 year')::date
  end
$$;

-- When a recurring task is completed, create the next instance (same transaction).
create or replace function public.tasks_spawn_next() returns trigger
language plpgsql as $$
declare
  v_base date;
  v_next date;
  v_shift interval;
begin
  if new.recurrence is null or new.status <> 'completed' or old.status = 'completed' then
    return null;
  end if;
  v_base := coalesce(new.due_date, new.start_date, (now() at time zone 'utc')::date);
  v_next := public.next_recurrence_date(v_base, new.recurrence);
  v_shift := (v_next - v_base) * interval '1 day';
  -- one successor per completed instance (idempotent if re-completed)
  if exists (select 1 from public.tasks where recurrence_parent_id = new.id) then
    return null;
  end if;
  insert into public.tasks (user_id, title, description, notes, category_id, project_id, priority, status,
    start_date, due_date, start_at, end_at, due_at, has_due_time, tags, reminder_minutes, recurrence, recurrence_parent_id, sort_order)
  values (new.user_id, new.title, new.description, new.notes, new.category_id, new.project_id, new.priority, 'not_started',
    new.start_date + (v_next - v_base), case when new.due_date is null then null else v_next end,
    new.start_at + v_shift, new.end_at + v_shift, new.due_at + v_shift, new.has_due_time,
    new.tags, new.reminder_minutes, new.recurrence, new.id, new.sort_order);
  return null;
end $$;
create trigger tasks_spawn_next after update of status on public.tasks
  for each row execute function public.tasks_spawn_next();

-- ---------- projects: automatic progress from tasks -------------------------
create or replace function public.recompute_project_progress(p_project uuid) returns void
language plpgsql as $$
declare v_total int; v_done int;
begin
  if p_project is null then return; end if;
  select count(*) filter (where status <> 'cancelled'), count(*) filter (where status = 'completed')
    into v_total, v_done from public.tasks where project_id = p_project;
  update public.projects
     set progress = case when v_total = 0 then 0 else round(100.0 * v_done / v_total) end
   where id = p_project and progress_mode = 'auto';
end $$;

create or replace function public.tasks_after_project_change() returns trigger
language plpgsql as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.recompute_project_progress(new.project_id); end if;
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.project_id is distinct from new.project_id) then
    perform public.recompute_project_progress(old.project_id);
  end if;
  return null;
end $$;
create trigger tasks_project_progress after insert or delete or update of status, project_id on public.tasks
  for each row execute function public.tasks_after_project_change();

create or replace function public.projects_before_write() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  if tg_op = 'UPDATE' and new.progress_mode = 'auto' and old.progress_mode = 'manual' then
    select case when count(*) filter (where status <> 'cancelled') = 0 then 0
           else round(100.0 * count(*) filter (where status = 'completed') / count(*) filter (where status <> 'cancelled')) end
      into new.progress from public.tasks where project_id = new.id;
  end if;
  return new;
end $$;
create trigger projects_before_write before insert or update on public.projects
  for each row execute function public.projects_before_write();

-- generic done_at stamping for milestone tables
create or replace function public.stamp_done_at() returns trigger
language plpgsql as $$
begin
  if new.is_done and (tg_op = 'INSERT' or not old.is_done) then new.done_at := now();
  elsif not new.is_done then new.done_at := null; end if;
  return new;
end $$;
create trigger stamp_done_at before insert or update on public.project_milestones for each row execute function public.stamp_done_at();
create trigger stamp_done_at before insert or update on public.goal_milestones for each row execute function public.stamp_done_at();

create or replace function public.goals_before_write() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then new.completed_at := null; end if;
  return new;
end $$;
create trigger goals_before_write before insert or update on public.goals for each row execute function public.goals_before_write();

create or replace function public.chapters_before_write() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then new.completed_at := now();
  elsif new.status <> 'completed' then new.completed_at := null; end if;
  return new;
end $$;
create trigger chapters_before_write before insert or update on public.chapters for each row execute function public.chapters_before_write();

-- ---------- activity log (history) ------------------------------------------
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_changes jsonb;
  v_row jsonb;
  v_old jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'created'; v_row := to_jsonb(new);
    v_changes := jsonb_build_object('title', v_row->'title');
  elsif tg_op = 'DELETE' then
    v_action := 'deleted'; v_row := to_jsonb(old);
    v_changes := jsonb_build_object('title', v_row->'title');
  else
    v_row := to_jsonb(new); v_old := to_jsonb(old);
    select jsonb_object_agg(key, jsonb_build_array(v_old->key, value)) into v_changes
      from jsonb_each(v_row) where key not in ('updated_at', 'sort_order') and v_old->key is distinct from value;
    if v_changes is null then return null; end if;
    v_action := case
      when v_row->>'status' = 'completed' and v_old->>'status' is distinct from 'completed' then 'completed'
      when v_old->>'status' = 'completed' and v_row->>'status' is distinct from 'completed' then 'reopened'
      else 'updated' end;
  end if;
  insert into public.activity_logs (user_id, entity_type, entity_id, action, changes)
    values ((v_row->>'user_id')::uuid, tg_argv[0], (v_row->>'id')::uuid, v_action, v_changes);
  return null;
end $$;

create trigger log_activity after insert or update or delete on public.events   for each row execute function public.log_activity('event');
create trigger log_activity after insert or update or delete on public.tasks    for each row execute function public.log_activity('task');
create trigger log_activity after insert or update or delete on public.projects for each row execute function public.log_activity('project');
create trigger log_activity after insert or update or delete on public.meetings for each row execute function public.log_activity('meeting');
create trigger log_activity after insert or update or delete on public.goals    for each row execute function public.log_activity('goal');

-- ---------- reminders: cancel pending jobs when the source changes ----------
-- The scheduler (Edge Function) re-plans jobs every run; a cancelled job whose
-- key is still valid is revived with fresh payload, so edits never duplicate.
create or replace function public.cancel_source_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  update public.reminder_jobs set status = 'cancelled'
   where source_type = tg_argv[0] and source_id = v_id and status in ('pending', 'failed');
  return null;
end $$;

create trigger cancel_reminders after update or delete on public.events   for each row execute function public.cancel_source_reminders('event');
create trigger cancel_reminders after update or delete on public.tasks    for each row execute function public.cancel_source_reminders('task');
create trigger cancel_reminders after update or delete on public.meetings for each row execute function public.cancel_source_reminders('meeting');
create trigger cancel_reminders after update or delete on public.exams    for each row execute function public.cancel_source_reminders('exam');
create trigger cancel_reminders after update or delete on public.study_sessions for each row execute function public.cancel_source_reminders('study');
create trigger cancel_reminders after update or delete on public.projects for each row execute function public.cancel_source_reminders('project');

-- Worker claim: atomically lease due jobs (safe under concurrent workers).
create or replace function public.claim_reminder_jobs(p_limit int default 50)
returns setof public.reminder_jobs
language sql security definer set search_path = public as $$
  update public.reminder_jobs j
     set status = 'processing', locked_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from public.reminder_jobs
      where (status = 'pending' and fire_at <= now())
         or (status = 'failed' and attempts < 5 and next_attempt_at <= now())
         or (status = 'processing' and locked_at < now() - interval '10 minutes')
      order by fire_at
      limit p_limit
      for update skip locked)
  returning j.*;
$$;
revoke execute on function public.claim_reminder_jobs(int) from public, anon, authenticated;

-- ---------- integrations (secrets never leave the server) -------------------
create or replace function public.save_telegram_integration(p_bot_token text, p_chat_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_chat_id !~ '^-?[0-9]{3,20}$' then raise exception 'Invalid Telegram chat id' using errcode = '22023'; end if;
  if p_bot_token is not null and p_bot_token <> '' and p_bot_token !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$' then
    raise exception 'Invalid Telegram bot token format' using errcode = '22023';
  end if;
  insert into public.integration_secrets (user_id, provider, secret, updated_at)
    values (v_uid, 'telegram', jsonb_build_object('bot_token', nullif(p_bot_token, ''), 'chat_id', p_chat_id), now())
    on conflict (user_id, provider) do update set secret = excluded.secret, updated_at = now();
  insert into public.integrations (user_id, provider, is_configured, display_hint, last_error)
    values (v_uid, 'telegram', true,
            'Chat …' || right(p_chat_id, 4) || case when coalesce(p_bot_token, '') = '' then ' · shared bot' else ' · own bot' end, null)
    on conflict (user_id, provider) do update set is_configured = true, display_hint = excluded.display_hint, last_error = null;
end $$;
revoke execute on function public.save_telegram_integration(text, text) from public, anon;
grant execute on function public.save_telegram_integration(text, text) to authenticated;

create or replace function public.remove_integration(p_provider text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.integration_secrets where user_id = auth.uid() and provider = p_provider;
  delete from public.integrations where user_id = auth.uid() and provider = p_provider;
  if p_provider = 'telegram' then
    update public.notification_preferences set telegram_enabled = false where user_id = auth.uid();
  end if;
end $$;
revoke execute on function public.remove_integration(text) from public, anon;
grant execute on function public.remove_integration(text) to authenticated;

-- ---------- notifications helpers -------------------------------------------
create or replace function public.mark_all_notifications_read() returns void
language sql security invoker as $$
  update public.notifications set is_read = true, read_at = now() where user_id = auth.uid() and not is_read;
$$;

-- ---------- data ownership --------------------------------------------------
-- Deletes every personal record but keeps the account. Single transaction.
create or replace function public.delete_all_my_data() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.notes where user_id = v_uid;
  delete from public.focus_sessions where user_id = v_uid;
  delete from public.tasks where user_id = v_uid;
  delete from public.events where user_id = v_uid and recurring_event_id is not null;
  delete from public.events where user_id = v_uid;
  delete from public.meetings where user_id = v_uid;
  delete from public.exams where user_id = v_uid;
  delete from public.subjects where user_id = v_uid;
  delete from public.projects where user_id = v_uid;
  delete from public.goals where user_id = v_uid;
  delete from public.habits where user_id = v_uid;
  delete from public.time_off where user_id = v_uid;
  delete from public.work_checklist_items where user_id = v_uid;
  delete from public.day_plans where user_id = v_uid;
  delete from public.attachments where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.reminder_jobs where user_id = v_uid;
  delete from public.notification_logs where user_id = v_uid;
  delete from public.activity_logs where user_id = v_uid;
  delete from public.categories where user_id = v_uid;
  perform public.seed_default_categories(v_uid);
end $$;
revoke execute on function public.delete_all_my_data() from public, anon;
grant execute on function public.delete_all_my_data() to authenticated;

-- Restore from a LAKSHYA JSON backup in ONE transaction. Runs as the caller, so
-- RLS applies and user_id is forced to auth.uid() for every row. The client
-- remaps ids to fresh UUIDs before calling this.
create or replace function public.import_backup(p jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_t text;
  v_n int;
  v_cols text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- parent tables first
  foreach v_t in array array[
    'categories','projects','project_milestones','meetings','meeting_participants','events','tasks','task_subtasks',
    'task_dependencies','subjects','chapters','study_sessions','exams','time_off','work_checklist_items','notes',
    'goals','goal_milestones','habits','habit_logs','focus_sessions','day_plans'
  ] loop
    if jsonb_typeof(p->v_t) = 'array' and jsonb_array_length(p->v_t) > 0 then
      -- only columns present in the backup, so absent keys fall back to column defaults
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = v_t and c.column_name <> 'user_id'
         and exists (select 1 from jsonb_array_elements(p->v_t) r where r ? c.column_name);
      -- events: insert masters before exceptions (self reference)
      execute format(
        'insert into public.%1$I (%2$s, user_id) select %2$s, $2 from jsonb_populate_recordset(null::public.%1$I, $1) %3$s',
        v_t, v_cols, case when v_t = 'events' then 'order by recurring_event_id nulls first' else '' end)
        using p->v_t, v_uid;
      get diagnostics v_n = row_count;
      v_counts := v_counts || jsonb_build_object(v_t, v_n);
    end if;
  end loop;
  return v_counts;
end $$;
revoke execute on function public.import_backup(jsonb) from public, anon;
grant execute on function public.import_backup(jsonb) to authenticated;

-- ---------- global search ---------------------------------------------------
create or replace function public.global_search(q text, p_limit int default 8)
returns table (kind text, id uuid, title text, subtitle text, at timestamptz)
language sql stable security invoker set search_path = public as $$
  with s as (select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat)
  (select 'task', t.id, t.title, t.status::text, t.due_at from tasks t, s where t.title ilike s.pat or t.description ilike s.pat order by t.updated_at desc limit p_limit)
  union all
  (select 'event', e.id, e.title, coalesce(e.location, ''), e.start_at from events e, s where e.title ilike s.pat or e.description ilike s.pat order by e.start_at desc limit p_limit)
  union all
  (select 'project', p.id, p.title, p.status::text, p.deadline::timestamptz from projects p, s where p.title ilike s.pat or p.description ilike s.pat limit p_limit)
  union all
  (select 'meeting', m.id, m.title, m.platform::text, m.start_at from meetings m, s where m.title ilike s.pat or m.agenda ilike s.pat order by m.start_at desc limit p_limit)
  union all
  (select 'note', n.id, n.title, left(n.content_text, 80), n.updated_at from notes n, s where n.title ilike s.pat or n.content_text ilike s.pat order by n.updated_at desc limit p_limit)
  union all
  (select 'goal', g.id, g.title, g.status::text, g.target_date::timestamptz from goals g, s where g.title ilike s.pat limit p_limit)
  union all
  (select 'subject', sb.id, sb.name, 'subject', null::timestamptz from subjects sb, s where sb.name ilike s.pat limit p_limit)
$$;

-- ---------- realtime for in-app notifications -------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------- storage bucket for attachments (1 GB free tier total) -----------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('attachments', 'attachments', false, 10485760)
  on conflict (id) do nothing;

create policy "own attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own attachments write" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
