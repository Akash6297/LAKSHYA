import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { CalendarDays, CheckSquare, Columns3, GanttChart, History, List, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/form'
import { Badge, PageHeader, Segmented, StatusBadge } from '@/components/ui/display'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/Modal'
import { TaskItem } from '@/features/tasks/TaskItem'
import { TimelineView } from '@/features/calendar/TimelineView'
import { useProjectNames } from '@/features/tasks/hooks'
import { PRIORITIES, TASK_STATUSES, priorityMeta } from '@/lib/constants'
import { addDaysKey, fmt, localDateKey, todayKey, zonedInstant } from '@/lib/dates'
import { isOverdue } from '@/lib/planning'
import { cn } from '@/lib/utils'
import { supabase, unwrap } from '@/lib/supabase'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useSync } from '@/providers/SyncProvider'
import { useTaskActions, useTasks } from '@/services/tasks'
import type { CalendarItem } from '@/services/calendar'
import type { Priority, Task, TaskStatus } from '@/types/db'

type View = 'list' | 'kanban' | 'calendar' | 'timeline' | 'history'
type Due = 'all' | 'overdue' | 'today' | 'week' | 'none'
type Sort = 'due' | 'priority' | 'created' | 'title'

export default function TasksPage() {
  const { tz, categories } = useAppData()
  const { openTask } = useQuickCreate()
  const { update } = useTaskActions()
  const confirm = useConfirm()
  const projects = useProjectNames()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>('list')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'open' | TaskStatus | 'all'>('open')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [category, setCategory] = useState('')
  const [project, setProject] = useState('')
  const [due, setDue] = useState<Due>('all')
  const [sort, setSort] = useState<Sort>('due')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showConflicts, setShowConflicts] = useState(params.get('conflicts') === '1')

  const since = useMemo(() => new Date(Date.now() - 30 * 86_400_000).toISOString(), [])
  const tasksQ = useTasks(['page', since], (qb) => qb.or(`status.not.in.(completed,cancelled),updated_at.gte.${since}`).order('sort_order').limit(1500))

  // deep links
  useEffect(() => {
    const id = params.get('task')
    if (params.get('new') === '1') { openTask(); setParams({}, { replace: true }) }
    if (!id) return
    void (async () => {
      const { data } = await supabase.from('tasks').select('*').eq('id', id).maybeSingle()
      if (data) openTask(data as Task)
      setParams({}, { replace: true })
    })()
  }, [params, setParams, openTask])

  const today = todayKey(tz)
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const weekEnd = addDaysKey(today, 7)
    const rows = (tasksQ.data ?? []).filter((t) => {
      if (status === 'open' ? t.status === 'completed' || t.status === 'cancelled' : status !== 'all' && t.status !== status) return false
      if (priority && t.priority !== priority) return false
      if (category && t.category_id !== category) return false
      if (project && (project === 'none' ? t.project_id : t.project_id !== project)) return false
      if (term && !`${t.title} ${t.description ?? ''} ${t.tags.join(' ')}`.toLowerCase().includes(term.replace(/^#/, ''))) return false
      if (due === 'overdue' && !isOverdue(t)) return false
      if (due === 'today' && t.due_date !== today) return false
      if (due === 'week' && !(t.due_date && t.due_date >= today && t.due_date <= weekEnd)) return false
      if (due === 'none' && t.due_date) return false
      return true
    })
    const w = (p: Priority) => priorityMeta(p).weight
    return rows.sort((a, b) => {
      if (sort === 'priority') return w(b.priority) - w(a.priority) || (a.due_at ?? '9').localeCompare(b.due_at ?? '9')
      if (sort === 'created') return b.created_at.localeCompare(a.created_at)
      if (sort === 'title') return a.title.localeCompare(b.title)
      return (a.due_at ?? '9').localeCompare(b.due_at ?? '9') || w(b.priority) - w(a.priority)
    })
  }, [tasksQ.data, q, status, priority, category, project, due, sort, today])

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const bulk = async (patch: Partial<Task>) => {
    const ids = [...selected]
    try {
      unwrap(await supabase.from('tasks').update(patch).in('id', ids))
      toast.success(`Updated ${ids.length} task${ids.length > 1 ? 's' : ''}`)
      setSelected(new Set())
      void tasksQ.refetch()
    } catch (e) { toast.error((e as Error).message) }
  }
  const bulkDelete = async () => {
    if (!(await confirm({ title: `Delete ${selected.size} tasks?`, message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' }))) return
    try {
      unwrap(await supabase.from('tasks').delete().in('id', [...selected]))
      setSelected(new Set())
      void tasksQ.refetch()
    } catch (e) { toast.error((e as Error).message) }
  }

  const overdueCount = (tasksQ.data ?? []).filter((t) => isOverdue(t)).length

  return (
    <div>
      <PageHeader title="Tasks" subtitle={`${(tasksQ.data ?? []).filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length} open${overdueCount ? ` · ${overdueCount} overdue` : ''}`}
        actions={<Button onClick={() => openTask()} icon={<Plus className="h-4 w-4" />}>New task</Button>} />

      <div className="mb-4 flex flex-col gap-3">
        <Segmented value={view} onChange={setView} options={[
          { value: 'list', label: 'List', icon: <List className="h-4 w-4" /> },
          { value: 'kanban', label: 'Kanban', icon: <Columns3 className="h-4 w-4" /> },
          { value: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-4 w-4" /> },
          { value: 'timeline', label: 'Timeline', icon: <GanttChart className="h-4 w-4" /> },
          { value: 'history', label: 'Completed', icon: <History className="h-4 w-4" /> },
        ]} />
        {view !== 'history' && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <div className="relative col-span-2"><Search className="absolute top-3 left-3 h-4 w-4 text-subtle" /><Input className="pl-9" placeholder="Search or #tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tasks" /></div>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status filter">
              <option value="open">Open</option><option value="all">All statuses</option>
              {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <Select value={due} onChange={(e) => setDue(e.target.value as Due)} aria-label="Due filter">
              <option value="all">Any date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">No due date</option>
            </Select>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority | '')} aria-label="Priority filter">
              <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter">
              <option value="">Any category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project filter">
              <option value="">Any project</option><option value="none">No project</option>{[...projects].map(([id, t]) => <option key={id} value={id}>{t}</option>)}
            </Select>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary-soft p-2.5 shadow-card">
          <span className="px-2 text-sm font-bold text-primary-soft-fg">{selected.size} selected</span>
          <Button size="sm" variant="secondary" onClick={() => void bulk({ status: 'completed' })}>Complete</Button>
          <Select className="h-8 w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && void bulk({ status: e.target.value as TaskStatus })} aria-label="Set status"><option value="">Status…</option>{TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
          <Select className="h-8 w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && void bulk({ priority: e.target.value as Priority })} aria-label="Set priority"><option value="">Priority…</option>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          <Select className="h-8 w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && void bulk({ project_id: e.target.value === 'none' ? null : e.target.value })} aria-label="Move to project"><option value="">Project…</option><option value="none">No project</option>{[...projects].map(([id, t]) => <option key={id} value={id}>{t}</option>)}</Select>
          <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void bulkDelete()}>Delete</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X className="h-4 w-4" /></Button>
        </div>
      )}

      {tasksQ.error ? <ErrorState error={tasksQ.error} onRetry={() => tasksQ.refetch()} /> : tasksQ.isLoading ? <div className="card p-4"><ListSkeleton rows={6} /></div> : (
        <>
          {view === 'list' && (
            <div className="card p-2 sm:p-3">
              <div className="mb-1 flex items-center justify-between px-2 text-xs text-muted">
                <label className="flex items-center gap-2"><input type="checkbox" checked={filtered.length > 0 && filtered.every((t) => selected.has(t.id))} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((t) => t.id)) : new Set())} /> Select all</label>
                <Select className="h-8 w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort tasks">
                  <option value="due">Sort: Due date</option><option value="priority">Sort: Priority</option><option value="created">Sort: Newest</option><option value="title">Sort: Title</option>
                </Select>
              </div>
              {filtered.length ? (
                <ul>
                  {filtered.map((t) => (
                    <li key={t.id} className="flex items-center gap-1">
                      <input type="checkbox" className="ml-2 shrink-0" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)} aria-label={`Select ${t.title}`} />
                      <div className="min-w-0 flex-1"><TaskItem task={t} projectName={t.project_id ? projects.get(t.project_id) : undefined} /></div>
                      <span className="hidden pr-2 sm:block"><StatusBadge status={t.status} /></span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState art="tasks" title="No tasks match" description="Adjust the filters or create a new task." action={<Button size="sm" onClick={() => openTask()}>New task</Button>} />}
            </div>
          )}
          {view === 'kanban' && <Kanban tasks={filtered.filter((t) => t.status !== 'cancelled')} allStatuses={status === 'open'} onMove={(t, s) => update.mutate({ id: t.id, base: t, patch: { status: s } })} projects={projects} />}
          {view === 'calendar' && <TaskMonth tasks={filtered} />}
          {view === 'timeline' && <TimelineView items={toItems(filtered, tz)} startKey={today} days={14} />}
          {view === 'history' && <CompletionHistory />}
        </>
      )}
      <ConflictsModal open={showConflicts} onClose={() => { setShowConflicts(false); setParams({}, { replace: true }) }} />
    </div>
  )
}

function toItems(tasks: Task[], tz: string): CalendarItem[] {
  return tasks.filter((t) => t.start_date || t.due_date).map((t) => {
    const s = zonedInstant(t.start_date ?? t.due_date!, '00:00', tz)
    const e = zonedInstant(addDaysKey(t.due_date ?? t.start_date!, 1), '00:00', tz)
    return { key: t.id, kind: 'task', id: t.id, title: t.title, start: s, end: e, allDay: true, color: priorityMeta(t.priority).color, done: t.status === 'completed', row: t }
  })
}

const KANBAN: TaskStatus[] = ['not_started', 'in_progress', 'pending', 'completed']

function Kanban({ tasks, onMove, projects }: { tasks: Task[]; allStatuses: boolean; onMove: (t: Task, s: TaskStatus) => void; projects: Map<string, string> }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }))
  const done = useTasks(['kanban-done'], (q) => q.eq('status', 'completed').order('completed_at', { ascending: false }).limit(20))
  const byStatus = (s: TaskStatus) => (s === 'completed' ? [...tasks.filter((t) => t.status === 'completed'), ...(done.data ?? []).filter((d) => !tasks.some((t) => t.id === d.id))].slice(0, 30) : tasks.filter((t) => t.status === s))
  const onDragEnd = (e: DragEndEvent) => {
    const t = e.active.data.current?.task as Task | undefined
    const s = e.over?.id as TaskStatus | undefined
    if (t && s && t.status !== s) onMove(t, s)
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0">
        {KANBAN.map((s) => <KanbanColumn key={s} status={s} tasks={byStatus(s)} projects={projects} />)}
      </div>
    </DndContext>
  )
}

function KanbanColumn({ status, tasks, projects }: { status: TaskStatus; tasks: Task[]; projects: Map<string, string> }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const meta = TASK_STATUSES.find((s) => s.value === status)!
  return (
    <div ref={setNodeRef} className={cn('w-[82vw] max-w-xs shrink-0 snap-start rounded-2xl border border-line bg-surface-2/60 p-2 transition sm:w-72 lg:w-auto lg:max-w-none', isOver && 'border-primary bg-primary-soft')}>
      <div className="mb-2 flex items-center gap-2 px-2 pt-1 text-sm font-bold"><span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />{meta.label}<span className="ml-auto text-xs text-muted">{tasks.length}</span></div>
      <div className="min-h-24 space-y-2">
        {tasks.map((t) => <KanbanCard key={t.id} task={t} projectName={t.project_id ? projects.get(t.project_id) : undefined} />)}
      </div>
    </div>
  )
}

function KanbanCard({ task, projectName }: { task: Task; projectName?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { task } })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      className={cn('card touch-none cursor-grab p-1.5', isDragging && 'relative z-20 rotate-1 shadow-pop')}>
      <TaskItem task={task} projectName={projectName} />
    </div>
  )
}

function TaskMonth({ tasks }: { tasks: Task[] }) {
  const { tz, settings } = useAppData()
  const { openTask } = useQuickCreate()
  const [month, setMonth] = useState(() => todayKey(tz).slice(0, 7))
  const first = new Date(month + '-01T00:00:00Z')
  const offset = (first.getUTCDay() - settings.week_starts_on + 7) % 7
  const start = addDaysKey(month + '-01', -offset)
  const days = Array.from({ length: 42 }, (_, i) => addDaysKey(start, i))
  const byDay = new Map<string, Task[]>()
  for (const t of tasks) { const k = t.due_date ?? (t.start_at ? localDateKey(new Date(t.start_at), tz) : null); if (k) byDay.set(k, [...(byDay.get(k) ?? []), t]) }
  const today = todayKey(tz)
  const shift = (n: number) => { const d = new Date(first); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)) }
  return (
    <div className="card p-3">
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shift(-1)} aria-label="Previous month">‹</Button>
        <div className="flex-1 text-center font-bold">{fmt(first, 'UTC', 'MMMM yyyy')}</div>
        <Button size="sm" variant="outline" onClick={() => shift(1)} aria-label="Next month">›</Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted">
        {Array.from({ length: 7 }, (_, i) => fmt(addDaysKey(start, i) + 'T12:00:00Z', 'UTC', 'EEE')).map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div key={d} className={cn('min-h-20 rounded-lg border border-line p-1 sm:min-h-24', d.slice(0, 7) !== month && 'opacity-40', d === today && 'border-primary')}>
            <div className={cn('mb-1 text-right text-[11px] font-semibold', d === today ? 'text-primary' : 'text-muted')}>{Number(d.slice(8))}</div>
            {(byDay.get(d) ?? []).slice(0, 3).map((t) => (
              <button key={t.id} onClick={() => openTask(t)} className={cn('mb-0.5 block w-full truncate rounded px-1 text-left text-[10px] font-semibold text-white', t.status === 'completed' && 'line-through opacity-60')} style={{ background: priorityMeta(t.priority).color }}>{t.title}</button>
            ))}
            {(byDay.get(d)?.length ?? 0) > 3 && <div className="text-[10px] text-muted">+{byDay.get(d)!.length - 3}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function CompletionHistory() {
  const { tz } = useAppData()
  const [page, setPage] = useState(0)
  const q = useTasks(['history', page], (qb) => qb.eq('status', 'completed').order('completed_at', { ascending: false }).range(page * 50, page * 50 + 49))
  const rows = q.data ?? []
  let last = ''
  return (
    <div className="card p-3">
      {q.isLoading ? <ListSkeleton /> : rows.length ? (
        <ul>
          {rows.map((t) => {
            const day = t.completed_at ? localDateKey(new Date(t.completed_at), tz) : ''
            const header = day !== last ? ((last = day), day) : null
            return (
              <li key={t.id}>
                {header && <div className="mt-3 mb-1 px-2 text-xs font-bold text-subtle uppercase">{fmt(header + 'T12:00:00Z', 'UTC', 'EEEE, d MMM yyyy')}</div>}
                <TaskItem task={t} />
              </li>
            )
          })}
        </ul>
      ) : <EmptyState art="tasks" title="No completed tasks yet" description="Completed tasks are kept here as your history." />}
      <div className="mt-3 flex justify-between">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
        <Button size="sm" variant="outline" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Older</Button>
      </div>
    </div>
  )
}

function ConflictsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { conflicts, resolveConflict } = useSync()
  return (
    <Modal open={open} onClose={onClose} title="Sync conflicts" description="These offline edits were not applied because the server copy changed or rejected them. Nothing was overwritten." size="lg">
      {conflicts.length === 0 ? <EmptyState compact art="sparkle" title="All synced" /> : (
        <ul className="space-y-3">
          {conflicts.map((c) => (
            <li key={c.id} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-primary" />
                <span className="font-semibold">{String((c.server as { title?: string })?.title ?? (c.local as { title?: string }).title ?? 'Task')}</span>
                <Badge color={c.reason === 'server_newer' ? '#F59E0B' : '#EF4444'}>{c.reason === 'server_newer' ? 'Changed on another device' : c.reason === 'deleted_on_server' ? 'Deleted elsewhere' : 'Rejected'}</Badge>
              </div>
              {c.message && <p className="mb-2 text-xs text-danger">{c.message}</p>}
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <pre className="overflow-x-auto rounded-lg bg-surface-2 p-2"><b>Your offline change</b>{'\n'}{JSON.stringify(c.local, null, 1).slice(0, 600)}</pre>
                <pre className="overflow-x-auto rounded-lg bg-surface-2 p-2"><b>Server version</b>{'\n'}{c.server ? JSON.stringify(pick(c.server, Object.keys(c.local)), null, 1).slice(0, 600) : '(none)'}</pre>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => void resolveConflict(c, 'server')}>Keep server</Button>
                {c.reason !== 'rejected' && <Button size="sm" onClick={() => void resolveConflict(c, 'local')}>Apply mine</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))
