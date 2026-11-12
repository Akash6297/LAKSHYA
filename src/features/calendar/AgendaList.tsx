import { useNavigate } from 'react-router-dom'
import { BookOpen, CalendarDays, CheckSquare, Flag, GraduationCap, Palmtree, Users, Video } from 'lucide-react'
import { cn, safeUrl } from '@/lib/utils'
import { dayLabel, fmtTime, localDateKey } from '@/lib/dates'
import { useAppData } from '@/providers/AppDataProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import type { CalendarItem, ItemKind } from '@/services/calendar'
import type { EventRow, Meeting, Task } from '@/types/db'

export const KIND_ICON: Record<ItemKind, typeof CalendarDays> = {
  event: CalendarDays, task: CheckSquare, meeting: Users, study: BookOpen, exam: GraduationCap, deadline: Flag, timeoff: Palmtree,
}

export function useOpenItem() {
  const navigate = useNavigate()
  const { openEvent, openTask, openMeeting } = useQuickCreate()
  return (i: CalendarItem) => {
    switch (i.kind) {
      case 'event': return openEvent({ row: i.row as EventRow, master: i.master, originalStart: i.master ? i.originalStart : undefined, start: i.start, end: i.end })
      case 'task': return openTask(i.row as Task)
      case 'meeting': return openMeeting(i.row as Meeting)
      case 'study': case 'exam': return navigate('/study')
      case 'deadline': return navigate(`/projects/${i.id}`)
      case 'timeoff': return navigate('/work')
    }
  }
}

export function AgendaList({ items, groupByDay, empty }: { items: CalendarItem[]; groupByDay?: boolean; empty?: React.ReactNode }) {
  const { tz, h24 } = useAppData()
  const open = useOpenItem()
  if (!items.length) return <>{empty}</>
  let lastDay = ''
  return (
    <ul className="space-y-1">
      {items.map((i) => {
        const day = localDateKey(i.start, tz)
        const header = groupByDay && day !== lastDay ? ((lastDay = day), day) : null
        const Icon = KIND_ICON[i.kind]
        const url = safeUrl((i.row as { meeting_url?: string | null }).meeting_url)
        const now = Date.now()
        const live = !i.allDay && i.start.getTime() <= now && i.end.getTime() > now
        return (
          <li key={i.key}>
            {header && <div className="mt-3 mb-1 px-2 text-[11px] font-bold tracking-wider text-subtle uppercase first:mt-0">{dayLabel(header, tz)}</div>}
            <button onClick={() => open(i)} className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-surface-2', i.done && 'opacity-60')}>
              <span className="w-16 shrink-0 text-right text-xs font-semibold text-muted tabular-nums">{i.allDay ? 'All day' : fmtTime(i.start, tz, h24)}</span>
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: i.color }} />
              <Icon className="h-4 w-4 shrink-0 text-muted" />
              <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', i.done && 'line-through')}>{i.title}</span>
              {live && <span className="chip bg-danger-soft text-danger">Now</span>}
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-lg p-1.5 text-primary hover:bg-primary-soft" aria-label="Join meeting">
                  <Video className="h-4 w-4" />
                </a>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
