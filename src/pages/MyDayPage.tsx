import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, GripVertical, ListTodo, NotebookPen, Plus, Star, Timer, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, PageHeader, ProgressRing } from '@/components/ui/display'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Textarea } from '@/components/ui/form'
import { EmptyState, ListSkeleton } from '@/components/ui/feedback'
import { TaskItem } from '@/features/tasks/TaskItem'
import { useOpenItem, KIND_ICON } from '@/features/calendar/AgendaList'
import { useOpenTasks } from '@/features/tasks/hooks'
import { addDaysKey, dayLabel, dowOfKey, fmt, fmtRange, fmtTime, todayKey, zonedDayBounds, zonedInstant } from '@/lib/dates'
import { busyMinutes, conflictsWith, findConflicts, freeSlots, isOverdue } from '@/lib/planning'
import { cn, minutesToHuman, pct } from '@/lib/utils'
import { supabase, unwrap } from '@/lib/supabase'
import { useAppData } from '@/providers/AppDataProvider'
import { useAuth } from '@/providers/AuthProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useCalendarFeed, updateEvent, useInvalidateCalendar, type CalendarItem } from '@/services/calendar'
import { useTaskActions } from '@/services/tasks'
import type { DayPlan, EventRow, Meeting, Task } from '@/types/db'

const PPM = 1.1 // pixels per minute
const SLOT = 30

export default function MyDayPage() {
  const { tz, h24, categoryById, settings } = useAppData()
  const { user } = useAuth()
  const { openTask } = useQuickCreate()
  const [day, setDay] = useState(() => todayKey(tz))
  const [from, to] = useMemo(() => zonedDayBounds(day, tz), [day, tz])
  const feed = useCalendarFeed(from, to, { tz, categories: categoryById })
  const open = useOpenTasks()
  const { update: updateTask } = useTaskActions()
  const invalidate = useInvalidateCalendar()
  const openItem = useOpenItem()
  const isToday = day === todayKey(tz)

  const wh = settings.working_hours?.[String(dowOfKey(day))]
  const workFrom = wh?.enabled ? zonedInstant(day, wh.start, tz) : zonedInstant(day, '08:00', tz)
  const workTo = wh?.enabled ? zonedInstant(day, wh.end, tz) : zonedInstant(day, '20:00', tz)

  // only items that actually overlap this day; anything outside would be clamped to the grid edge and pile up
  const timed = feed.items.filter((i) => !i.allDay && i.end > from && i.start < to)
  const allDay = feed.items.filter((i) => i.allDay)
  const intervals = timed.filter((i) => !i.done).map((i) => ({ id: i.key, title: i.title, start: i.start, end: i.end }))
  const conflicts = findConflicts(intervals)
  const conflictKeys = new Set(conflicts.flat().map((c) => c.id))
  const slots = freeSlots(intervals, isToday ? new Date(Math.max(Date.now(), workFrom.getTime())) : workFrom, workTo, 15)
  const freeMin = slots.reduce((a, s) => a + (s.end.getTime() - s.start.getTime()) / 60_000, 0)
  const busyMin = busyMinutes(intervals, workFrom, workTo)

  const unscheduled = (open.data ?? []).filter((t) => !t.start_at && (t.due_date === day || (isToday && isOverdue(t)) || (t.start_date === day)))
  const dayTasks = feed.items.filter((i) => i.kind === 'task')
  const doneCount = dayTasks.filter((i) => i.done).length + feed.items.filter((i) => i.kind === 'study' && i.done).length
  const totalCount = dayTasks.length + feed.items.filter((i) => i.kind === 'study').length
  const completion = pct(doneCount, totalCount)

  // visible hour range: working hours ±, expanded to include every item
  const startHour = Math.max(0, Math.min(Number(fmt(workFrom, tz, 'H')) - 1, ...timed.map((i) => (i.start < from ? 0 : Number(fmt(i.start, tz, 'H'))))))
  const endHour = Math.min(24, Math.max(Number(fmt(workTo, tz, 'H')) + 2, ...timed.map((i) => (i.end >= to ? 24 : Number(fmt(i.end, tz, 'H')) + 1))))
  const gridStart = zonedInstant(day, `${String(startHour).padStart(2, '0')}:00`, tz)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }))

  const onDragEnd = async (e: DragEndEvent) => {
    const slot = e.over?.id as string | undefined
    if (!slot?.startsWith('slot:')) return
    const start = new Date(Number(slot.slice(5)))
    const data = e.active.data.current as { kind: 'task' | 'event' | 'meeting'; task?: Task; item?: CalendarItem }
    const durMs = data.item ? data.item.end.getTime() - data.item.start.getTime() : 30 * 60_000
    const end = new Date(start.getTime() + durMs)
    const clash = conflictsWith({ start, end, id: data.item?.key }, intervals)
    try {
      if (data.kind === 'task') {
        const t = data.task ?? (data.item!.row as Task)
        updateTask.mutate({ id: t.id, base: t, patch: { start_at: start.toISOString(), end_at: end.toISOString(), start_date: t.start_date && t.start_date > day ? day : t.start_date } })
      } else if (data.kind === 'event') {
        const it = data.item!
        await updateEvent({ row: it.row as EventRow, master: it.master, originalStart: it.master ? it.originalStart : undefined }, { start_at: start.toISOString(), end_at: end.toISOString() }, 'this')
        if (it.master) toast.info('Moved this occurrence only')
      } else if (data.kind === 'meeting') {
        unwrap(await supabase.from('meetings').update({ start_at: start.toISOString(), end_at: end.toISOString() }).eq('id', data.item!.id))
      }
      await invalidate()
      toast.success(`Scheduled ${fmtRange(start, end, tz, h24)}`, { description: clash.length ? `⚠ Overlaps with ${clash.map((c) => c.title).join(', ')}` : undefined })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Daily planner" title={dayLabel(day, tz) === 'Today' ? 'My Day' : dayLabel(day, tz)} subtitle={fmt(zonedInstant(day, '12:00', tz), tz, 'EEEE, d MMMM yyyy')}
        actions={<>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setDay(addDaysKey(day, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" onClick={() => setDay(todayKey(tz))} disabled={isToday}>Today</Button>
            <Button variant="outline" size="icon" onClick={() => setDay(addDaysKey(day, 1))} aria-label="Next day"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Link to="/focus"><Button variant="soft" icon={<Timer className="h-4 w-4" />}>Focus mode</Button></Link>
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card flex items-center gap-3 p-4"><ProgressRing value={completion} size={48} stroke={6} /><div><div className="text-xs font-semibold text-muted">Completed</div><div className="font-bold">{doneCount}/{totalCount}</div></div></div>
        <div className="card p-4"><div className="text-xs font-semibold text-muted">Free time{wh?.enabled ? ' (work hours)' : ''}</div><div className="text-xl font-extrabold text-success">{minutesToHuman(Math.round(freeMin))}</div></div>
        <div className="card p-4"><div className="text-xs font-semibold text-muted">Scheduled</div><div className="text-xl font-extrabold">{minutesToHuman(busyMin)}</div></div>
        <div className={cn('card p-4', conflicts.length && 'border-warning/50 bg-warning-soft')}><div className="text-xs font-semibold text-muted">Conflicts</div><div className={cn('text-xl font-extrabold', conflicts.length ? 'text-warning' : '')}>{conflicts.length}</div></div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <Card title="Timeline" icon={<Clock className="h-4 w-4" />} action={<span className="text-xs text-muted">Drag tasks onto the timeline</span>}>
            {allDay.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {allDay.map((i) => (
                  <button key={i.key} onClick={() => openItem(i)} className={cn('chip px-2.5 py-1', i.done && 'line-through opacity-60')} style={{ background: `${i.color}22`, color: i.color }}>{i.title}</button>
                ))}
              </div>
            )}
            {feed.loading ? <ListSkeleton rows={6} /> : (
              <Timeline
                gridStart={gridStart} hours={endHour - startHour} items={timed} conflictKeys={conflictKeys} freeSlots={slots}
                now={isToday ? new Date() : null} onOpen={openItem}
              />
            )}
            {conflicts.length > 0 && (
              <div className="mt-3 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 font-semibold text-warning"><AlertTriangle className="h-4 w-4" /> Scheduling conflicts</div>
                <ul className="space-y-0.5 text-xs text-muted">{conflicts.slice(0, 5).map(([a, b]) => <li key={a.id + b.id}>{a.title} ↔ {b.title} ({fmtRange(b.start, a.end < b.end ? a.end : b.end, tz, h24)})</li>)}</ul>
              </div>
            )}
          </Card>

          <div className="space-y-5">
            <DailyPriorities day={day} userId={user!.id} />
            <Card title={`Unscheduled · ${unscheduled.length}`} icon={<ListTodo className="h-4 w-4" />} action={<Button size="icon-sm" variant="ghost" onClick={() => openTask(null, { due_date: day })} aria-label="Add task for this day"><Plus className="h-4 w-4" /></Button>}>
              {open.isLoading ? <ListSkeleton rows={3} /> : unscheduled.length ? (
                <ul className="space-y-1">{unscheduled.map((t) => <DraggableTask key={t.id} task={t} />)}</ul>
              ) : <EmptyState compact title="Everything is scheduled" description="Tasks due this day without a time block appear here." />}
              {slots.length > 0 && unscheduled.length > 0 && (
                <p className="mt-3 text-xs text-muted">Suggested free slots: {slots.slice(0, 3).map((s) => fmtRange(s.start, s.end, tz, h24)).join(' · ')}</p>
              )}
            </Card>
            <QuickNotes day={day} userId={user!.id} />
          </div>
        </div>
      </DndContext>
    </div>
  )
}

function Timeline({ gridStart, hours, items, conflictKeys, freeSlots: free, now, onOpen }: {
  gridStart: Date; hours: number; items: CalendarItem[]; conflictKeys: Set<string>; freeSlots: { start: Date; end: Date }[]; now: Date | null; onOpen: (i: CalendarItem) => void
}) {
  const { tz, h24 } = useAppData()
  const scroller = useRef<HTMLDivElement>(null)
  const totalMin = hours * 60
  const minOf = (d: Date) => Math.max(0, Math.min(totalMin, (d.getTime() - gridStart.getTime()) / 60_000))

  // lane assignment for overlapping items
  const laid = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime())
    const lanes: number[] = []
    const out: { item: CalendarItem; lane: number; lanes: number }[] = []
    let cluster: typeof out = []
    let clusterEnd = 0
    const flush = () => { const n = Math.max(...cluster.map((c) => c.lane)) + 1; cluster.forEach((c) => (c.lanes = n)); out.push(...cluster); cluster = []; lanes.length = 0 }
    for (const it of sorted) {
      if (cluster.length && it.start.getTime() >= clusterEnd) flush()
      let lane = lanes.findIndex((end) => end <= it.start.getTime())
      if (lane === -1) { lane = lanes.length; lanes.push(0) }
      lanes[lane] = it.end.getTime()
      cluster.push({ item: it, lane, lanes: 1 })
      clusterEnd = Math.max(clusterEnd, it.end.getTime())
    }
    if (cluster.length) flush()
    return out
  }, [items])

  useEffect(() => {
    if (now && scroller.current) scroller.current.scrollTop = Math.max(0, minOf(now) * PPM - 120)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={scroller} className="relative max-h-[70vh] overflow-y-auto pr-1">
      <div className="relative ml-14" style={{ height: totalMin * PPM }}>
        {Array.from({ length: totalMin / SLOT }).map((_, i) => (
          <Slot key={i} at={new Date(gridStart.getTime() + i * SLOT * 60_000)} top={i * SLOT * PPM} label={i % 2 === 0 ? fmtTime(new Date(gridStart.getTime() + i * SLOT * 60_000), tz, h24) : null} />
        ))}
        {free.map((s) => (
          <div key={s.start.toISOString()} className="pointer-events-none absolute right-0 left-0 rounded-lg border border-dashed border-success/40 bg-success-soft/40"
            style={{ top: minOf(s.start) * PPM, height: Math.max(0, (minOf(s.end) - minOf(s.start)) * PPM) }}>
            {(s.end.getTime() - s.start.getTime()) / 60_000 >= 45 && <span className="absolute top-1 right-2 text-[10px] font-semibold text-success">Free · {minutesToHuman((s.end.getTime() - s.start.getTime()) / 60_000)}</span>}
          </div>
        ))}
        {laid.map(({ item, lane, lanes }) => (
          <TimelineBlock key={item.key} item={item} conflict={conflictKeys.has(item.key)} onOpen={onOpen}
            style={{ top: minOf(item.start) * PPM, height: Math.max(22, (minOf(item.end) - minOf(item.start)) * PPM - 2), left: `${(lane / lanes) * 100}%`, width: `calc(${100 / lanes}% - 4px)` }} />
        ))}
        {now && minOf(now) > 0 && minOf(now) < totalMin && (
          <div className="pointer-events-none absolute right-0 left-0 z-10 flex items-center" style={{ top: minOf(now) * PPM }}>
            <span className="-ml-1.5 h-3 w-3 rounded-full bg-danger" /><span className="h-0.5 flex-1 bg-danger" />
          </div>
        )}
      </div>
    </div>
  )
}

function Slot({ at, top, label }: { at: Date; top: number; label: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${at.getTime()}` })
  return (
    <div ref={setNodeRef} className={cn('absolute right-0 left-0 border-t', label ? 'border-line' : 'border-line/40 border-dashed', isOver && 'bg-primary-soft')} style={{ top, height: SLOT * PPM }}>
      {label && <span className="absolute -top-2 -left-14 w-12 text-right text-[10px] font-semibold text-subtle">{label}</span>}
    </div>
  )
}

function TimelineBlock({ item, conflict, style, onOpen }: { item: CalendarItem; conflict: boolean; style: React.CSSProperties; onOpen: (i: CalendarItem) => void }) {
  const { tz, h24 } = useAppData()
  const draggable = item.kind === 'task' || item.kind === 'meeting' || item.kind === 'event'
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.key, disabled: !draggable, data: { kind: item.kind, item } })
  const { toggle } = useTaskActions()
  const Icon = KIND_ICON[item.kind]
  return (
    <div ref={setNodeRef} style={{ ...style, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, background: `${item.color}1f`, borderColor: conflict ? 'var(--warning)' : item.color }}
      className={cn('absolute z-[5] overflow-hidden rounded-lg border-l-4 px-2 py-1 text-xs shadow-soft', isDragging && 'z-20 opacity-80 shadow-pop', conflict && 'ring-2 ring-warning/60', item.done && 'opacity-60')}>
      <div className="flex items-start gap-1.5">
        {item.kind === 'task' && <Checkbox size="sm" checked={!!item.done} onChange={() => toggle(item.row as Task)} label="Toggle complete" className="mt-0.5" />}
        <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(item)}>
          <div className={cn('flex items-center gap-1 truncate font-semibold', item.done && 'line-through')}><Icon className="h-3 w-3 shrink-0" style={{ color: item.color }} />{item.title}</div>
          <div className="truncate text-[10px] text-muted">{fmtRange(item.start, item.end, tz, h24)}</div>
        </button>
        {draggable && <span {...listeners} {...attributes} className="cursor-grab touch-none text-muted" aria-label={`Drag ${item.title}`}><GripVertical className="h-3.5 w-3.5" /></span>}
      </div>
    </div>
  )
}

function DraggableTask({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `task:${task.id}`, data: { kind: 'task', task } })
  return (
    <li ref={setNodeRef} style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }} className={cn('flex items-center gap-1 rounded-xl bg-surface', isDragging && 'relative z-30 shadow-pop')}>
      <span {...listeners} {...attributes} className="cursor-grab touch-none p-1 text-subtle" aria-label={`Drag ${task.title} to timeline`}><GripVertical className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1"><TaskItem task={task} /></div>
    </li>
  )
}

function useDayPlan(day: string, userId: string) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['day_plans', day],
    queryFn: async () => unwrap(await supabase.from('day_plans').select('*').eq('plan_date', day).maybeSingle()) as DayPlan | null,
  })
  const save = useMutation({
    meta: { silent: true },
    mutationFn: async (patch: Partial<DayPlan>) =>
      unwrap(await supabase.from('day_plans').upsert({ user_id: userId, plan_date: day, ...patch }, { onConflict: 'user_id,plan_date' }).select().single()) as DayPlan,
    onSuccess: (row) => qc.setQueryData(['day_plans', day], row),
  })
  return { plan: q.data, loading: q.isLoading, save }
}

function DailyPriorities({ day, userId }: { day: string; userId: string }) {
  const { plan, save } = useDayPlan(day, userId)
  const [draft, setDraft] = useState('')
  const items = plan?.priorities ?? []
  const set = (p: DayPlan['priorities']) => save.mutate({ priorities: p }, { onError: (e) => toast.error((e as Error).message) })
  return (
    <Card title="Daily priorities" icon={<Star className="h-4 w-4" />}>
      <ul className="space-y-1">
        {items.map((p, i) => (
          <li key={i} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
            <Checkbox checked={p.done} onChange={(v) => set(items.map((x, j) => (j === i ? { ...x, done: v } : x)))} label={p.text} />
            <span className={cn('flex-1 text-sm', p.done && 'text-muted line-through')}>{p.text}</span>
            <button className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => set(items.filter((_, j) => j !== i))} aria-label={`Remove ${p.text}`}><X className="h-4 w-4 text-muted" /></button>
          </li>
        ))}
      </ul>
      {items.length < 5 ? (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { set([...items, { text: draft.trim().slice(0, 200), done: false }]); setDraft('') } }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={items.length ? 'Add another (max 5)…' : 'What must happen today?'} aria-label="New priority" />
          <Button type="submit" variant="soft" size="icon" aria-label="Add priority"><Plus className="h-4 w-4" /></Button>
        </form>
      ) : <p className="mt-2 text-xs text-muted">Five is plenty. Focus on these.</p>}
    </Card>
  )
}

function QuickNotes({ day, userId }: { day: string; userId: string }) {
  const { plan, loading, save } = useDayPlan(day, userId)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const dirty = useRef(false)
  useEffect(() => { if (!loading) { setText(plan?.quick_notes ?? ''); dirty.current = false } }, [loading, day]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty.current) return
    setStatus('saving')
    const t = setTimeout(() => save.mutate({ quick_notes: text }, { onSuccess: () => setStatus('saved'), onError: () => setStatus('error') }), 800)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Quick notes" icon={<NotebookPen className="h-4 w-4" />} action={<span className={cn('text-[11px] font-semibold', status === 'error' ? 'text-danger' : 'text-subtle')}>{{ idle: '', saving: 'Saving…', saved: 'Saved', error: 'Not saved – retrying on next edit' }[status]}</span>}>
      <Textarea rows={5} value={text} onChange={(e) => { dirty.current = true; setText(e.target.value) }} placeholder="Thoughts, reminders, wins…" aria-label="Quick notes for the day" />
    </Card>
  )
}

export type { Meeting }
