// Builds the plain-text daily agenda / weekly summary from rows. Pure function.
import { localTimeHM } from './time.ts'

export interface AgendaInput {
  timezone: string
  dateLabel: string
  items: { title: string; start: Date; kind: string }[]
  dueTasks: { title: string; priority: string }[]
  overdueCount: number
}

export function buildAgendaText(a: AgendaInput): string {
  const lines: string[] = [`📅 ${a.dateLabel}`]
  if (a.items.length) {
    lines.push('', 'Schedule:')
    for (const i of [...a.items].sort((x, y) => x.start.getTime() - y.start.getTime())) {
      lines.push(`• ${localTimeHM(i.start, a.timezone)}  ${i.title}${i.kind !== 'event' ? ` (${i.kind})` : ''}`)
    }
  } else {
    lines.push('', 'No scheduled events today.')
  }
  if (a.dueTasks.length) {
    lines.push('', 'Due today:')
    for (const t of a.dueTasks.slice(0, 10)) lines.push(`• ${t.title}${t.priority === 'critical' || t.priority === 'high' ? ' ❗' : ''}`)
    if (a.dueTasks.length > 10) lines.push(`…and ${a.dueTasks.length - 10} more`)
  }
  if (a.overdueCount) lines.push('', `⚠️ ${a.overdueCount} overdue task${a.overdueCount === 1 ? '' : 's'}`)
  return lines.join('\n')
}

export interface WeeklyInput {
  completed: number
  created: number
  overdue: number
  focusMinutes: number
  studyMinutes: number
  meetings: number
}

export function buildWeeklyText(w: WeeklyInput): string {
  const h = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`
  return [
    '📊 Your week in LAKSHYA',
    '',
    `✅ Tasks completed: ${w.completed}`,
    `➕ Tasks created: ${w.created}`,
    `⚠️ Currently overdue: ${w.overdue}`,
    `🎯 Focus time: ${h(w.focusMinutes)}`,
    `📚 Study time: ${h(w.studyMinutes)}`,
    `🤝 Meetings: ${w.meetings}`,
  ].join('\n')
}
