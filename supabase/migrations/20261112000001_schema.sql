-- =============================================================================
-- LAKSHYA – core schema
-- Every user-owned table carries user_id (default auth.uid()) and RLS.
-- Child rows reference parents through composite (id, user_id) foreign keys so a
-- row can never point at another user's record, even with a forged parent id.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------- enums -----------------------------------------------------------
create type public.priority_level as enum ('critical', 'high', 'medium', 'low');
create type public.task_status    as enum ('not_started', 'in_progress', 'pending', 'completed', 'cancelled');
create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type public.goal_type      as enum ('daily', 'weekly', 'monthly', 'yearly', 'custom');
create type public.goal_status    as enum ('active', 'completed', 'paused', 'abandoned');
create type public.meeting_platform as enum ('google_meet', 'zoom', 'teams', 'in_person', 'phone', 'other');
create type public.reminder_status as enum ('pending', 'processing', 'sent', 'partial', 'failed', 'cancelled', 'skipped');
create type public.delivery_channel as enum ('in_app', 'push', 'email', 'telegram');

-- ---------- helpers ---------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- profiles & settings --------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  avatar_url  text check (char_length(avatar_url) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.user_settings (
  user_id                 uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  timezone                text not null default 'Asia/Kolkata' check (char_length(timezone) <= 64),
  theme                   text not null default 'system' check (theme in ('light', 'dark', 'system')),
  week_starts_on          smallint not null default 1 check (week_starts_on between 0 and 6),
  time_format             text not null default '12h' check (time_format in ('12h', '24h')),
  default_calendar_view   text not null default 'timeGridWeek',
  default_event_minutes   int not null default 60 check (default_event_minutes between 5 and 1440),
  -- working_hours: { "1": {"enabled":true,"start":"09:30","end":"18:00","mode":"office"}, ... } keyed by ISO weekday 0..6 (0 = Sunday)
  working_hours           jsonb not null default '{
     "0":{"enabled":false,"start":"09:00","end":"17:00","mode":"office"},
     "1":{"enabled":true,"start":"09:30","end":"18:00","mode":"office"},
     "2":{"enabled":true,"start":"09:30","end":"18:00","mode":"office"},
     "3":{"enabled":true,"start":"09:30","end":"18:00","mode":"wfh"},
     "4":{"enabled":true,"start":"09:30","end":"18:00","mode":"office"},
     "5":{"enabled":true,"start":"09:30","end":"18:00","mode":"wfh"},
     "6":{"enabled":false,"start":"09:00","end":"13:00","mode":"office"}}'::jsonb,
  focus_minutes           int not null default 25 check (focus_minutes between 1 and 240),
  short_break_minutes     int not null default 5  check (short_break_minutes between 1 and 60),
  long_break_minutes      int not null default 15 check (long_break_minutes between 1 and 120),
  daily_focus_target_min  int not null default 120 check (daily_focus_target_min between 0 and 1440),
  daily_study_target_min  int not null default 120 check (daily_study_target_min between 0 and 1440),
  weekly_study_target_min int not null default 600 check (weekly_study_target_min between 0 and 10080),
  whatsapp_number         text check (whatsapp_number ~ '^[0-9]{6,15}$'),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  slug        text not null check (char_length(slug) between 1 and 40),
  color       text not null default '#6D6AF0' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, slug)
);

-- ---------- projects --------------------------------------------------------
create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 200),
  description   text check (char_length(description) <= 10000),
  category_id   uuid,
  start_date    date,
  deadline      date,
  priority      public.priority_level not null default 'medium',
  status        public.project_status not null default 'planning',
  progress      smallint not null default 0 check (progress between 0 and 100),
  progress_mode text not null default 'auto' check (progress_mode in ('auto', 'manual')),
  color         text not null default '#6D6AF0' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  links         jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  notes         text check (char_length(notes) <= 20000),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id),
  check (deadline is null or start_date is null or deadline >= start_date),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id)
);

create table public.project_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id  uuid not null,
  title       text not null check (char_length(title) between 1 and 200),
  due_date    date,
  is_done     boolean not null default false,
  done_at     timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete cascade
);

-- ---------- events (calendar) ----------------------------------------------
-- Recurrence: a master row carries an RFC 5545 RRULE (wall-clock in `timezone`)
-- plus exdates. Edited single occurrences are separate rows pointing to the
-- master via recurring_event_id + original_start ("exceptions").
create table public.events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title               text not null check (char_length(title) between 1 and 200),
  description         text check (char_length(description) <= 10000),
  location            text check (char_length(location) <= 300),
  meeting_url         text check (meeting_url is null or meeting_url ~* '^https?://'),
  notes               text check (char_length(notes) <= 20000),
  category_id         uuid,
  project_id          uuid,
  priority            public.priority_level not null default 'medium',
  tags                text[] not null default '{}',
  all_day             boolean not null default false,
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  timezone            text not null default 'Asia/Kolkata',
  rrule               text check (rrule is null or rrule ~ '^(RRULE:)?FREQ='),
  exdates             timestamptz[] not null default '{}',
  recurring_event_id  uuid,
  original_start      timestamptz,
  reminder_minutes    int[] not null default '{30}',
  -- client-generated key that makes "double-click save" idempotent
  client_key          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, client_key),
  check (end_at >= start_at),
  check ((recurring_event_id is null) = (original_start is null)),
  check (recurring_event_id is null or rrule is null),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id),
  foreign key (recurring_event_id, user_id) references public.events(id, user_id) on delete cascade
);
create unique index events_exception_unique on public.events (recurring_event_id, original_start) where recurring_event_id is not null;

-- ---------- tasks -----------------------------------------------------------
create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title                text not null check (char_length(title) between 1 and 300),
  description          text check (char_length(description) <= 10000),
  notes                text check (char_length(notes) <= 20000),
  category_id          uuid,
  project_id           uuid,
  milestone_id         uuid,
  priority             public.priority_level not null default 'medium',
  status               public.task_status not null default 'not_started',
  start_date           date,
  due_date             date,
  -- optional time block (My Day / calendar). Stored as absolute instants.
  start_at             timestamptz,
  end_at               timestamptz,
  -- deadline as instant: due_date at due_time in the user's timezone (end of day if no time)
  due_at               timestamptz,
  has_due_time         boolean not null default false,
  tags                 text[] not null default '{}',
  reminder_minutes     int[] not null default '{}',
  recurrence           text check (recurrence in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly')),
  recurrence_parent_id uuid,
  sort_order           double precision not null default 0,
  in_reschedule_queue  boolean not null default false,
  completed_at         timestamptz,
  client_key           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, client_key),
  check (end_at is null or start_at is null or end_at >= start_at),
  check (due_date is null or start_date is null or due_date >= start_date),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id),
  foreign key (milestone_id, user_id) references public.project_milestones(id, user_id) on delete set null (milestone_id)
);

create table public.task_subtasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id     uuid not null,
  title       text not null check (char_length(title) between 1 and 300),
  is_done     boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks(id, user_id) on delete cascade
);

create table public.task_dependencies (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id            uuid not null,
  depends_on_task_id uuid not null,
  created_at         timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id),
  foreign key (task_id, user_id) references public.tasks(id, user_id) on delete cascade,
  foreign key (depends_on_task_id, user_id) references public.tasks(id, user_id) on delete cascade
);

-- ---------- meetings --------------------------------------------------------
create table public.meetings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title             text not null check (char_length(title) between 1 and 200),
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  platform          public.meeting_platform not null default 'google_meet',
  meeting_url       text check (meeting_url is null or meeting_url ~* '^https?://'),
  agenda            text check (char_length(agenda) <= 10000),
  description       text check (char_length(description) <= 10000),
  notes             text check (char_length(notes) <= 50000),
  project_id        uuid,
  reminder_minutes  int[] not null default '{30,1440}',
  attended          boolean,
  client_key        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, client_key),
  check (end_at >= start_at),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id)
);

create table public.meeting_participants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meeting_id  uuid not null,
  name        text not null check (char_length(name) between 1 and 120),
  email       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at  timestamptz not null default now(),
  foreign key (meeting_id, user_id) references public.meetings(id, user_id) on delete cascade
);

-- meeting follow-ups are ordinary tasks linked back to the meeting
alter table public.tasks add column meeting_id uuid;
alter table public.tasks add foreign key (meeting_id, user_id) references public.meetings(id, user_id) on delete set null (meeting_id);

-- ---------- study planner ---------------------------------------------------
create table public.subjects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  color         text not null default '#0EA5E9' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  target_hours  numeric(6,1) check (target_hours >= 0),
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id)
);

create table public.chapters (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id          uuid not null,
  title               text not null check (char_length(title) between 1 and 200),
  status              text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  completed_at        timestamptz,
  revision_count      int not null default 0 check (revision_count >= 0),
  next_revision_date  date,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, user_id),
  foreign key (subject_id, user_id) references public.subjects(id, user_id) on delete cascade
);

create table public.study_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id      uuid not null,
  chapter_id      uuid,
  title           text check (char_length(title) <= 200),
  kind            text not null default 'study' check (kind in ('study', 'revision', 'practice')),
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  completed       boolean not null default false,
  actual_minutes  int check (actual_minutes between 0 and 1440),
  notes           text check (char_length(notes) <= 10000),
  reminder_minutes int[] not null default '{15}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_at >= start_at),
  foreign key (subject_id, user_id) references public.subjects(id, user_id) on delete cascade,
  foreign key (chapter_id, user_id) references public.chapters(id, user_id) on delete set null (chapter_id)
);

create table public.exams (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id       uuid,
  title            text not null check (char_length(title) between 1 and 200),
  kind             text not null default 'exam' check (kind in ('exam', 'mock')),
  exam_at          timestamptz not null,
  duration_minutes int not null default 180 check (duration_minutes between 1 and 1440),
  location         text check (char_length(location) <= 300),
  score            numeric(8,2),
  max_score        numeric(8,2),
  notes            text check (char_length(notes) <= 10000),
  reminder_minutes int[] not null default '{1440,180}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects(id, user_id) on delete set null (subject_id)
);

-- ---------- work ------------------------------------------------------------
create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null default 'leave' check (kind in ('leave', 'holiday', 'sick', 'other')),
  title       text not null check (char_length(title) between 1 and 200),
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'planned' check (status in ('planned', 'approved', 'taken', 'cancelled')),
  notes       text check (char_length(notes) <= 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.work_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_date   date not null,
  title       text not null check (char_length(title) between 1 and 300),
  is_done     boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- notes -----------------------------------------------------------
create table public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null default 'Untitled' check (char_length(title) <= 300),
  content_html text not null default '' check (char_length(content_html) <= 500000),
  content_text text not null default '' check (char_length(content_text) <= 200000),
  kind         text not null default 'personal' check (kind in ('quick', 'personal', 'meeting', 'project', 'study')),
  tags         text[] not null default '{}',
  is_pinned    boolean not null default false,
  is_archived  boolean not null default false,
  task_id      uuid,
  project_id   uuid,
  event_id     uuid,
  meeting_id   uuid,
  subject_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks(id, user_id) on delete set null (task_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id),
  foreign key (event_id, user_id) references public.events(id, user_id) on delete set null (event_id),
  foreign key (meeting_id, user_id) references public.meetings(id, user_id) on delete set null (meeting_id),
  foreign key (subject_id, user_id) references public.subjects(id, user_id) on delete set null (subject_id)
);

-- ---------- goals & habits --------------------------------------------------
create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 200),
  description   text check (char_length(description) <= 10000),
  goal_type     public.goal_type not null default 'monthly',
  status        public.goal_status not null default 'active',
  start_date    date not null default current_date,
  target_date   date,
  target_value  numeric(12,2) check (target_value > 0),
  current_value numeric(12,2) not null default 0 check (current_value >= 0),
  unit          text check (char_length(unit) <= 30),
  notes         text check (char_length(notes) <= 20000),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id)
);

create table public.goal_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id     uuid not null,
  title       text not null check (char_length(title) between 1 and 200),
  is_done     boolean not null default false,
  done_at     timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals(id, user_id) on delete cascade
);

create table public.habits (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  description     text check (char_length(description) <= 2000),
  frequency       text not null default 'daily' check (frequency in ('daily', 'weekly', 'custom')),
  days_of_week    smallint[] not null default '{0,1,2,3,4,5,6}',
  target_per_week smallint not null default 7 check (target_per_week between 1 and 7),
  color           text not null default '#10B981' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id)
);

create table public.habit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id    uuid not null,
  log_date    date not null,
  created_at  timestamptz not null default now(),
  unique (habit_id, log_date),
  foreign key (habit_id, user_id) references public.habits(id, user_id) on delete cascade
);

-- ---------- focus / my day --------------------------------------------------
create table public.focus_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id          uuid,
  kind             text not null default 'focus' check (kind in ('focus', 'short_break', 'long_break')),
  planned_minutes  int not null check (planned_minutes between 1 and 240),
  actual_minutes   int not null default 0 check (actual_minutes between 0 and 240),
  completed        boolean not null default false,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks(id, user_id) on delete set null (task_id)
);

create table public.day_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_date   date not null,
  priorities  jsonb not null default '[]'::jsonb check (jsonb_typeof(priorities) = 'array'),
  quick_notes text not null default '' check (char_length(quick_notes) <= 20000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, plan_date)
);

-- ---------- attachments (Supabase Storage metadata) -------------------------
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_type  text not null check (entity_type in ('event', 'project', 'task', 'meeting', 'note')),
  entity_id    uuid not null,
  storage_path text not null check (char_length(storage_path) <= 500),
  file_name    text not null check (char_length(file_name) <= 255),
  mime_type    text,
  size_bytes   bigint not null check (size_bytes between 0 and 10485760),
  created_at   timestamptz not null default now()
);

-- ---------- notifications ---------------------------------------------------
create table public.notification_preferences (
  user_id               uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  in_app_enabled        boolean not null default true,
  push_enabled          boolean not null default false,
  email_enabled         boolean not null default false,
  telegram_enabled      boolean not null default false,
  email_address         text check (email_address is null or email_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notify_events         boolean not null default true,
  notify_tasks          boolean not null default true,
  notify_meetings       boolean not null default true,
  notify_exams          boolean not null default true,
  notify_projects       boolean not null default true,
  notify_study          boolean not null default true,
  daily_agenda_enabled  boolean not null default true,
  daily_agenda_time     time not null default '07:00',
  weekly_summary_enabled boolean not null default true,
  weekly_summary_dow    smallint not null default 0 check (weekly_summary_dow between 0 and 6),
  weekly_summary_time   time not null default '19:00',
  quiet_hours_enabled   boolean not null default false,
  quiet_start           time not null default '22:30',
  quiet_end             time not null default '07:00',
  task_default_reminders    int[] not null default '{60}',
  project_deadline_reminders int[] not null default '{1440}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null default 'reminder' check (kind in ('reminder', 'agenda', 'summary', 'overdue', 'system')),
  title       text not null check (char_length(title) <= 300),
  body        text check (char_length(body) <= 4000),
  link        text check (char_length(link) <= 500),
  source_type text,
  source_id   uuid,
  is_read     boolean not null default false,
  read_at     timestamptz,
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://'),
  p256dh       text not null,
  auth         text not null,
  user_agent   text check (char_length(user_agent) <= 400),
  last_used_at timestamptz,
  failed_count int not null default 0,
  created_at   timestamptz not null default now()
);

-- Public (non-secret) integration status. Secrets live in integration_secrets.
create table public.integrations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider       text not null check (provider in ('telegram', 'email')),
  is_configured  boolean not null default false,
  display_hint   text check (char_length(display_hint) <= 120),
  last_tested_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, provider)
);

-- Secrets: RLS on, NO client policies, client privileges revoked. Only the
-- service role (Edge Functions) and security-definer functions can touch it.
create table public.integration_secrets (
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null check (provider in ('telegram')),
  secret      jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, provider)
);

-- ---------- reminder scheduling ---------------------------------------------
create table public.reminder_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  source_type      text not null check (source_type in ('event', 'task', 'meeting', 'exam', 'study', 'project', 'agenda', 'weekly_summary', 'overdue')),
  source_id        uuid,
  occurrence_at    timestamptz,
  offset_minutes   int not null default 0,
  fire_at          timestamptz not null,
  idempotency_key  text not null unique,
  status           public.reminder_status not null default 'pending',
  attempts         int not null default 0,
  next_attempt_at  timestamptz,
  locked_at        timestamptz,
  last_error       text,
  payload          jsonb not null default '{}'::jsonb,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.notification_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  reminder_job_id  uuid references public.reminder_jobs(id) on delete set null,
  channel          public.delivery_channel not null,
  status           text not null check (status in ('sent', 'failed', 'skipped')),
  attempt          int not null default 1,
  error            text,
  created_at       timestamptz not null default now()
);
-- one successful delivery per job per channel = idempotent retries
create unique index notification_logs_one_success on public.notification_logs (reminder_job_id, channel) where status = 'sent';

-- ---------- activity / history ---------------------------------------------
create table public.activity_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  entity_type  text not null,
  entity_id    uuid not null,
  action       text not null check (action in ('created', 'updated', 'deleted', 'completed', 'reopened')),
  changes      jsonb,
  created_at   timestamptz not null default now()
);

-- ---------- indexes ---------------------------------------------------------
create index on public.categories (user_id);
create index on public.projects (user_id, status);
create index on public.project_milestones (project_id);
create index events_range_idx on public.events (user_id, start_at, end_at);
create index events_recurring_idx on public.events (user_id) where rrule is not null;
create index on public.events (recurring_event_id);
create index tasks_user_status_idx on public.tasks (user_id, status);
create index tasks_due_idx on public.tasks (user_id, due_at) where status not in ('completed', 'cancelled');
create index tasks_block_idx on public.tasks (user_id, start_at) where start_at is not null;
create index on public.tasks (project_id);
create index on public.tasks (meeting_id);
create index on public.task_subtasks (task_id);
create index on public.task_dependencies (depends_on_task_id);
create index meetings_range_idx on public.meetings (user_id, start_at);
create index on public.meeting_participants (meeting_id);
create index on public.chapters (subject_id);
create index study_range_idx on public.study_sessions (user_id, start_at);
create index exams_range_idx on public.exams (user_id, exam_at);
create index on public.time_off (user_id, start_date);
create index on public.work_checklist_items (user_id, item_date);
create index notes_user_idx on public.notes (user_id, is_archived, is_pinned, updated_at desc);
create index notes_fts_idx on public.notes using gin (to_tsvector('simple', title || ' ' || content_text));
create index on public.goals (user_id, status);
create index on public.goal_milestones (goal_id);
create index on public.habits (user_id);
create index habit_logs_date_idx on public.habit_logs (user_id, log_date);
create index on public.focus_sessions (user_id, started_at);
create index on public.attachments (entity_type, entity_id);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where not is_read;
create index on public.push_subscriptions (user_id);
create index reminder_jobs_due_idx on public.reminder_jobs (fire_at) where status in ('pending', 'failed');
create index on public.reminder_jobs (source_type, source_id);
create index on public.reminder_jobs (user_id);
create index on public.notification_logs (user_id, created_at desc);
create index on public.notification_logs (reminder_job_id);
create index activity_entity_idx on public.activity_logs (entity_type, entity_id, created_at desc);
create index on public.activity_logs (user_id, created_at desc);

-- ---------- updated_at triggers ---------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_settings','categories','projects','project_milestones','events','tasks','task_subtasks',
    'meetings','subjects','chapters','study_sessions','exams','time_off','work_checklist_items','notes',
    'goals','goal_milestones','habits','day_plans','notification_preferences','integrations','reminder_jobs'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
