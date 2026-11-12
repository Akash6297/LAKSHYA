// Free, custom "Timeline" (Gantt-style) view. FullCalendar's resource timeline
// is part of its paid Premium plugins, so LAKSHYA renders its own.
import { addDaysKey, dayLabel, fmt, localDateKey, todayKey } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { KIND_ICON, useOpenItem } from './AgendaList'
import type { CalendarItem, ItemKind } from '@/services/calendar'

const ROWS: { kind: ItemKind; label: string }[] = [
  { kind: 'deadline', label: 'Deadlines' },
  { kind: 'exam', label: 'Exams' },
  { kind: 'meeting', label: 'Meetings' },
  { kind: 'event', label: 'Events' },
  { kind: 'task', label: 'Tasks' },
  { kind: 'study', label: 'Study' },
  { kind: 'timeoff', label: 'Leave' },
]

export function TimelineView({ items, startKey, days }: { items: CalendarItem[]; startKey: string; days: number }) {
  const { tz } = useAppData()
  const open = useOpenItem()
  const keys = Array.from({ length: days }, (_, i) => addDaysKey(startKey, i))
  const today = todayKey(tz)
  const col = (d: Date, end = false) => {
    const k = localDateKey(end ? new Date(d.getTime() - 1) : d, tz)
    const idx = keys.indexOf(k)
    return idx === -1 ? (k < startKey ? 0 : days - 1) : idx
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <div className="min-w-[820px]">
        <div className="grid border-b border-line bg-surface-2" style={{ gridTemplateColumns: `120px repeat(${days}, minmax(0,1fr))` }}>
          <div />
          {keys.map((k) => (
            <div key={k} className={cn('border-l border-line px-1 py-2 text-center text-[11px] font-semibold', k === today ? 'text-primary' : 'text-muted')}>
              <div>{fmt(k + 'T12:00:00Z', 'UTC', 'EEE')}</div>
              <div className={cn('text-sm', k === today && 'mx-auto grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-fg')}>{fmt(k + 'T12:00:00Z', 'UTC', 'd')}</div>
            </div>
          ))}
        </div>
        {ROWS.map((r) => {
          const rowItems = items.filter((i) => i.kind === r.kind)
          const Icon = KIND_ICON[r.kind]
          // simple lane packing so bars don't overlap
          const lanes: number[] = []
          const placed = rowItems.map((it) => {
            const s = col(it.start), e = Math.max(s, col(it.end, true))
            let lane = lanes.findIndex((end) => end < s)
            if (lane === -1) { lane = lanes.length; lanes.push(e) } else lanes[lane] = e
            return { it, s, e, lane }
          })
          return (
            <div key={r.kind} className="grid border-b border-line last:border-0" style={{ gridTemplateColumns: `120px repeat(${days}, minmax(0,1fr))` }}>
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted"><Icon className="h-3.5 w-3.5" />{r.label}</div>
              <div className="relative col-span-full col-start-2 grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0,1fr))`, gridAutoRows: '28px', minHeight: 36, paddingBlock: 4 }}>
                {keys.map((k, i) => <div key={k} className={cn('border-l border-line', k === today && 'bg-primary-soft/50')} style={{ gridColumn: i + 1, gridRow: `1 / span ${Math.max(1, lanes.length)}` }} />)}
                {placed.map(({ it, s, e, lane }) => (
                  <button key={it.key} onClick={() => open(it)} title={`${it.title} · ${dayLabel(localDateKey(it.start, tz), tz)}`}
                    className={cn('z-[1] mx-0.5 my-0.5 truncate rounded-md px-1.5 text-left text-[11px] font-semibold text-white shadow-soft', it.done && 'line-through opacity-50')}
                    style={{ gridColumn: `${s + 1} / ${e + 2}`, gridRow: lane + 1, background: it.color }}>
                    {it.title}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
