import { CalendarClock, FolderKanban, Repeat } from 'lucide-react'
import { Checkbox } from '@/components/ui/form'
import { PriorityBadge } from '@/components/ui/display'
import { cn } from '@/lib/utils'
import { dayLabel, fmt, fmtTime, localDateKey } from '@/lib/dates'
import { isOverdue } from '@/lib/planning'
import { priorityMeta } from '@/lib/constants'
import { useAppData } from '@/providers/AppDataProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useTaskActions } from '@/services/tasks'
import type { Task } from '@/types/db'

export function DueLabel({ task }: { task: Task }) {
  const { tz, h24 } = useAppData()
  if (!task.due_at && !task.start_at) return null
  const overdue = isOverdue(task)
  const at = task.start_at ?? task.due_at!
  const key = task.due_date ?? localDateKey(new Date(at), tz)
  const time = task.start_at ? fmtTime(task.start_at, tz, h24) : task.has_due_time ? fmtTime(task.due_at!, tz, h24) : null
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'font-semibold text-danger' : 'text-muted')}>
      <CalendarClock className="h-3 w-3" />
      {overdue ? `Overdue · ${fmt(task.due_at!, tz, 'd MMM')}` : `${dayLabel(task.start_at ? localDateKey(new Date(task.start_at), tz) : key, tz)}${time ? ` · ${time}` : ''}`}
    </span>
  )
}

export function TaskItem({ task, projectName, compact, showProject = true, blocked }: { task: Task; projectName?: string; compact?: boolean; showProject?: boolean; blocked?: boolean }) {
  const { categoryById } = useAppData()
  const { openTask } = useQuickCreate()
  const { toggle } = useTaskActions()
  const done = task.status === 'completed'
  const cat = task.category_id ? categoryById.get(task.category_id) : null
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTask(task)}
      onKeyDown={(e) => { if (e.key === 'Enter') openTask(task) }}
      className={cn('group flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-surface-2', compact && 'py-1.5')}
    >
      <Checkbox checked={done} onChange={() => toggle(task)} label={`Mark "${task.title}" ${done ? 'not done' : 'done'}`} color={priorityMeta(task.priority).color} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-semibold', done && 'text-muted line-through')}>{task.title}</div>
        {!compact && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <DueLabel task={task} />
            {showProject && projectName && <span className="inline-flex items-center gap-1 text-xs text-muted"><FolderKanban className="h-3 w-3" />{projectName}</span>}
            {cat && <span className="inline-flex items-center gap-1 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />{cat.name}</span>}
            {task.recurrence && <Repeat className="h-3 w-3 text-muted" aria-label="Repeats" />}
            {blocked && <span className="chip bg-warning-soft text-warning">Blocked</span>}
            {task.tags.slice(0, 3).map((t) => <span key={t} className="text-xs text-subtle">#{t}</span>)}
          </div>
        )}
      </div>
      {!done && task.priority !== 'medium' && task.priority !== 'low' && <PriorityBadge priority={task.priority} compact={compact} />}
    </div>
  )
}
