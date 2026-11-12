// Row types mirroring supabase/migrations. Keep in sync when the schema changes.
export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type TaskStatus = 'not_started' | 'in_progress' | 'pending' | 'completed' | 'cancelled'
export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'
export type GoalType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
export type GoalStatus = 'active' | 'completed' | 'paused' | 'abandoned'
export type MeetingPlatform = 'google_meet' | 'zoom' | 'teams' | 'in_person' | 'phone' | 'other'
export type TaskRecurrence = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'

interface Owned {
  id: string
  user_id: string
  created_at: string
}
interface Timestamped extends Owned {
  updated_at: string
}

export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface WorkDay {
  enabled: boolean
  start: string
  end: string
  mode: 'office' | 'wfh'
}

export interface UserSettings {
  user_id: string
  timezone: string
  theme: 'light' | 'dark' | 'system'
  week_starts_on: number
  time_format: '12h' | '24h'
  default_calendar_view: string
  default_event_minutes: number
  working_hours: Record<string, WorkDay>
  focus_minutes: number
  short_break_minutes: number
  long_break_minutes: number
  daily_focus_target_min: number
  daily_study_target_min: number
  weekly_study_target_min: number
  whatsapp_number: string | null
  updated_at: string
}

export interface Category extends Timestamped {
  name: string
  slug: string
  color: string
  sort_order: number
}

export interface Project extends Timestamped {
  title: string
  description: string | null
  category_id: string | null
  start_date: string | null
  deadline: string | null
  priority: Priority
  status: ProjectStatus
  progress: number
  progress_mode: 'auto' | 'manual'
  color: string
  links: { label: string; url: string }[]
  notes: string | null
  completed_at: string | null
}

export interface Milestone extends Timestamped {
  project_id: string
  title: string
  due_date: string | null
  is_done: boolean
  done_at: string | null
  sort_order: number
}

export interface EventRow extends Timestamped {
  title: string
  description: string | null
  location: string | null
  meeting_url: string | null
  notes: string | null
  category_id: string | null
  project_id: string | null
  priority: Priority
  tags: string[]
  all_day: boolean
  start_at: string
  end_at: string
  timezone: string
  rrule: string | null
  exdates: string[]
  recurring_event_id: string | null
  original_start: string | null
  reminder_minutes: number[]
  client_key: string | null
}

export interface Task extends Timestamped {
  title: string
  description: string | null
  notes: string | null
  category_id: string | null
  project_id: string | null
  milestone_id: string | null
  meeting_id: string | null
  priority: Priority
  status: TaskStatus
  start_date: string | null
  due_date: string | null
  start_at: string | null
  end_at: string | null
  due_at: string | null
  has_due_time: boolean
  tags: string[]
  reminder_minutes: number[]
  recurrence: TaskRecurrence | null
  recurrence_parent_id: string | null
  sort_order: number
  in_reschedule_queue: boolean
  completed_at: string | null
  client_key: string | null
}

export interface Subtask extends Timestamped {
  task_id: string
  title: string
  is_done: boolean
  sort_order: number
}

export interface TaskDependency extends Owned {
  task_id: string
  depends_on_task_id: string
}

export interface Meeting extends Timestamped {
  title: string
  start_at: string
  end_at: string
  platform: MeetingPlatform
  meeting_url: string | null
  agenda: string | null
  description: string | null
  notes: string | null
  project_id: string | null
  reminder_minutes: number[]
  attended: boolean | null
  client_key: string | null
}

export interface MeetingParticipant extends Owned {
  meeting_id: string
  name: string
  email: string | null
}

export interface Subject extends Timestamped {
  name: string
  color: string
  target_hours: number | null
  archived: boolean
}

export interface Chapter extends Timestamped {
  subject_id: string
  title: string
  status: 'not_started' | 'in_progress' | 'completed'
  completed_at: string | null
  revision_count: number
  next_revision_date: string | null
  sort_order: number
}

export interface StudySession extends Timestamped {
  subject_id: string
  chapter_id: string | null
  title: string | null
  kind: 'study' | 'revision' | 'practice'
  start_at: string
  end_at: string
  completed: boolean
  actual_minutes: number | null
  notes: string | null
  reminder_minutes: number[]
}

export interface Exam extends Timestamped {
  subject_id: string | null
  title: string
  kind: 'exam' | 'mock'
  exam_at: string
  duration_minutes: number
  location: string | null
  score: number | null
  max_score: number | null
  notes: string | null
  reminder_minutes: number[]
}

export interface TimeOff extends Timestamped {
  kind: 'leave' | 'holiday' | 'sick' | 'other'
  title: string
  start_date: string
  end_date: string
  status: 'planned' | 'approved' | 'taken' | 'cancelled'
  notes: string | null
}

export interface ChecklistItem extends Timestamped {
  item_date: string
  title: string
  is_done: boolean
  sort_order: number
}

export interface Note extends Timestamped {
  title: string
  content_html: string
  content_text: string
  kind: 'quick' | 'personal' | 'meeting' | 'project' | 'study'
  tags: string[]
  is_pinned: boolean
  is_archived: boolean
  task_id: string | null
  project_id: string | null
  event_id: string | null
  meeting_id: string | null
  subject_id: string | null
}

export interface Goal extends Timestamped {
  title: string
  description: string | null
  goal_type: GoalType
  status: GoalStatus
  start_date: string
  target_date: string | null
  target_value: number | null
  current_value: number
  unit: string | null
  notes: string | null
  completed_at: string | null
}

export interface GoalMilestone extends Timestamped {
  goal_id: string
  title: string
  is_done: boolean
  done_at: string | null
  sort_order: number
}

export interface Habit extends Timestamped {
  title: string
  description: string | null
  frequency: 'daily' | 'weekly' | 'custom'
  days_of_week: number[]
  target_per_week: number
  color: string
  archived: boolean
}

export interface HabitLog extends Owned {
  habit_id: string
  log_date: string
}

export interface FocusSession extends Owned {
  task_id: string | null
  kind: 'focus' | 'short_break' | 'long_break'
  planned_minutes: number
  actual_minutes: number
  completed: boolean
  started_at: string
  ended_at: string | null
}

export interface DayPlan extends Timestamped {
  plan_date: string
  priorities: { text: string; done: boolean }[]
  quick_notes: string
}

export interface Attachment extends Owned {
  entity_type: 'event' | 'project' | 'task' | 'meeting' | 'note'
  entity_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
}

export interface NotificationPrefs {
  user_id: string
  in_app_enabled: boolean
  push_enabled: boolean
  email_enabled: boolean
  telegram_enabled: boolean
  email_address: string | null
  notify_events: boolean
  notify_tasks: boolean
  notify_meetings: boolean
  notify_exams: boolean
  notify_projects: boolean
  notify_study: boolean
  daily_agenda_enabled: boolean
  daily_agenda_time: string
  weekly_summary_enabled: boolean
  weekly_summary_dow: number
  weekly_summary_time: string
  quiet_hours_enabled: boolean
  quiet_start: string
  quiet_end: string
  task_default_reminders: number[]
  project_deadline_reminders: number[]
}

export interface AppNotification extends Owned {
  kind: 'reminder' | 'agenda' | 'summary' | 'overdue' | 'system'
  title: string
  body: string | null
  link: string | null
  source_type: string | null
  source_id: string | null
  is_read: boolean
  read_at: string | null
}

export interface Integration extends Timestamped {
  provider: 'telegram' | 'email'
  is_configured: boolean
  display_hint: string | null
  last_tested_at: string | null
  last_error: string | null
}

export interface NotificationLog extends Owned {
  reminder_job_id: string | null
  channel: 'in_app' | 'push' | 'email' | 'telegram'
  status: 'sent' | 'failed' | 'skipped'
  attempt: number
  error: string | null
}

export interface ActivityLog extends Owned {
  entity_type: string
  entity_id: string
  action: 'created' | 'updated' | 'deleted' | 'completed' | 'reopened'
  changes: Record<string, unknown> | null
}

/** Map of table name → row type, used by the generic resource hooks. */
export interface Tables {
  categories: Category
  projects: Project
  project_milestones: Milestone
  events: EventRow
  tasks: Task
  task_subtasks: Subtask
  task_dependencies: TaskDependency
  meetings: Meeting
  meeting_participants: MeetingParticipant
  subjects: Subject
  chapters: Chapter
  study_sessions: StudySession
  exams: Exam
  time_off: TimeOff
  work_checklist_items: ChecklistItem
  notes: Note
  goals: Goal
  goal_milestones: GoalMilestone
  habits: Habit
  habit_logs: HabitLog
  focus_sessions: FocusSession
  day_plans: DayPlan
  attachments: Attachment
  notifications: AppNotification
  integrations: Integration
  notification_logs: NotificationLog
  activity_logs: ActivityLog
}
export type TableName = keyof Tables
