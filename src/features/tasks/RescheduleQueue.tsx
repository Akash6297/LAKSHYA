// Unfinished/overdue tasks land here. Nothing moves until the user clicks –
// LAKSHYA never silently reschedules (spec §21).
import { CalendarArrowUp } from 'lucide-react'
import { Card } from '@/components/ui/display'
import { Button } from '@/components/ui/Button'
import { addDaysKey, fmt, taskDueAt, todayKey } from '@/lib/dates'
import { useAppData } from '@/providers/AppDataProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useTaskActions } from '@/services/tasks'
import type { Task } from '@/types/db'

export function RescheduleQueue({ tasks }: { tasks: Task[] }) {
  const { tz } = useAppData()
  const { update } = useTaskActions()
  const { openTask } = useQuickCreate()
  const today = todayKey(tz)

  const moveTo = (t: Task, day: string) => {
    const time = t.has_due_time && t.due_at ? fmt(t.due_at, tz, 'HH:mm') : null
    const shiftDays = t.due_date ? (new Date(day).getTime() - new Date(t.due_date).getTime()) / 86_400_000 : 0
    update.mutate({
      id: t.id,
      base: t,
      patch: {
        due_date: day,
        due_at: taskDueAt(day, time, tz),
        start_date: t.start_date && t.start_date > day ? day : t.start_date,
        // keep a time block on the same clock time
        start_at: t.start_at ? new Date(new Date(t.start_at).getTime() + shiftDays * 86_400_000).toISOString() : null,
        end_at: t.end_at ? new Date(new Date(t.end_at).getTime() + shiftDays * 86_400_000).toISOString() : null,
        in_reschedule_queue: false,
      },
    })
  }

  return (
    <Card title={`Reschedule queue · ${tasks.length}`} icon={<CalendarArrowUp className="h-4 w-4" />} className="border-warning/40">
      <p className="mb-3 text-xs text-muted">These tasks passed their deadline. Choose a new date – nothing is moved automatically.</p>
      <ul className="space-y-2">
        {tasks.slice(0, 6).map((t) => (
          <li key={t.id} className="rounded-xl bg-surface-2 p-2.5">
            <button className="block w-full truncate text-left text-sm font-semibold hover:text-primary" onClick={() => openTask(t)}>{t.title}</button>
            <div className="mt-0.5 text-xs text-danger">Was due {fmt(t.due_at!, tz, 'EEE d MMM')}</div>
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" variant="soft" onClick={() => moveTo(t, today)}>Today</Button>
              <Button size="sm" variant="outline" onClick={() => moveTo(t, addDaysKey(today, 1))}>Tomorrow</Button>
              <Button size="sm" variant="ghost" onClick={() => openTask(t)}>Pick…</Button>
            </div>
          </li>
        ))}
      </ul>
      {tasks.length > 6 && <p className="mt-2 text-xs text-muted">+{tasks.length - 6} more in Tasks → Overdue</p>}
    </Card>
  )
}
