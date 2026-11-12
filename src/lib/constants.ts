import type { GoalType, MeetingPlatform, Priority, ProjectStatus, TaskRecurrence, TaskStatus } from '@/types/db'

export const PRIORITIES: { value: Priority; label: string; color: string; weight: number }[] = [
  { value: 'critical', label: 'Critical', color: '#E11D48', weight: 4 },
  { value: 'high', label: 'High', color: '#F97316', weight: 3 },
  { value: 'medium', label: 'Medium', color: '#6366F1', weight: 2 },
  { value: 'low', label: 'Low', color: '#94A3B8', weight: 1 },
]
export const priorityMeta = (p: Priority) => PRIORITIES.find((x) => x.value === p) ?? PRIORITIES[2]

export const TASK_STATUSES: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'not_started', label: 'Not Started', color: '#94A3B8' },
  { value: 'in_progress', label: 'In Progress', color: '#6366F1' },
  { value: 'pending', label: 'Pending', color: '#F59E0B' },
  { value: 'completed', label: 'Completed', color: '#10B981' },
  { value: 'cancelled', label: 'Cancelled', color: '#64748B' },
]
export const taskStatusMeta = (s: TaskStatus) => TASK_STATUSES.find((x) => x.value === s) ?? TASK_STATUSES[0]

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; color: string }[] = [
  { value: 'planning', label: 'Planning', color: '#0EA5E9' },
  { value: 'active', label: 'Active', color: '#6366F1' },
  { value: 'on_hold', label: 'On Hold', color: '#F59E0B' },
  { value: 'completed', label: 'Completed', color: '#10B981' },
  { value: 'cancelled', label: 'Cancelled', color: '#64748B' },
]
export const projectStatusMeta = (s: ProjectStatus) => PROJECT_STATUSES.find((x) => x.value === s) ?? PROJECT_STATUSES[0]

export const TASK_RECURRENCES: { value: TaskRecurrence | ''; label: string }[] = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

export const GOAL_TYPES: { value: GoalType; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom' },
]

export const PLATFORMS: { value: MeetingPlatform; label: string; color: string; pattern?: RegExp }[] = [
  { value: 'google_meet', label: 'Google Meet', color: '#10B981', pattern: /meet\.google\.com/ },
  { value: 'zoom', label: 'Zoom', color: '#2D8CFF', pattern: /zoom\.(us|com)/ },
  { value: 'teams', label: 'Microsoft Teams', color: '#6264A7', pattern: /teams\.(microsoft|live)\.com/ },
  { value: 'in_person', label: 'In person', color: '#F59E0B' },
  { value: 'phone', label: 'Phone', color: '#64748B' },
  { value: 'other', label: 'Other', color: '#94A3B8' },
]
export const platformMeta = (p: MeetingPlatform) => PLATFORMS.find((x) => x.value === p) ?? PLATFORMS[5]
export function detectPlatform(url: string): MeetingPlatform | null {
  return PLATFORMS.find((p) => p.pattern?.test(url))?.value ?? null
}

/** Reminder presets in minutes (spec: 1d, 12h, 3h, 1h, 30m) */
export const REMINDER_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: 'At start' },
  { value: 10, label: '10 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 180, label: '3 hours before' },
  { value: 720, label: '12 hours before' },
  { value: 1440, label: '1 day before' },
]
export function reminderLabel(min: number): string {
  const p = REMINDER_PRESETS.find((r) => r.value === min)
  if (p) return p.label
  if (min % 1440 === 0) return `${min / 1440} days before`
  if (min % 60 === 0) return `${min / 60} hours before`
  return `${min} minutes before`
}

export const COMMON_TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Dhaka', 'Asia/Kathmandu',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland', 'Africa/Nairobi', 'UTC',
]

export const SWATCHES = ['#6366F1', '#8B5CF6', '#0EA5E9', '#14B8A6', '#10B981', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#64748B']
