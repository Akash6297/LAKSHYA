import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, ExternalLink, Flag, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader, PriorityBadge, ProgressRing, ProjectStatusBadge, Segmented } from '@/components/ui/display'
import { Checkbox, Input } from '@/components/ui/form'
import { EmptyState, ErrorState, FullPageLoader, ListSkeleton } from '@/components/ui/feedback'
import { ChartCard, ChartTooltip, axisProps, gridProps } from '@/components/charts'
import { TaskItem } from '@/features/tasks/TaskItem'
import { TaskHistory } from '@/features/tasks/TaskFormModal'
import { TimelineView } from '@/features/calendar/TimelineView'
import { Attachments } from '@/features/attachments/Attachments'
import { addDaysKey, daysUntil, fmt, localDateKey, todayKey, zonedInstant } from '@/lib/dates'
import { cn, pct, safeUrl } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useCrud, useRow, useRows } from '@/services/resource'
import { useTasks } from '@/services/tasks'
import type { CalendarItem } from '@/services/calendar'
import type { Milestone, Note, Project, TaskStatus } from '@/types/db'
import { TASK_STATUSES } from '@/lib/constants'

type Tab = 'overview' | 'board' | 'timeline' | 'calendar' | 'notes' | 'files' | 'history'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { tz } = useAppData()
  const { openProject, openTask, newNote } = useQuickCreate()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('overview')
  const project = useRow('projects', id)
  const tasks = useTasks(['project', id], (q) => q.eq('project_id', id).order('sort_order').order('created_at'))
  const milestones = useRows('project_milestones', [id], (q) => q.eq('project_id', id).order('sort_order').order('due_date', { nullsFirst: false }))
  const { remove } = useCrud('projects')

  const p = project.data as Project | null | undefined
  if (project.isLoading) return <FullPageLoader />
  if (project.error) return <ErrorState error={project.error} onRetry={() => project.refetch()} />
  if (!p) return <EmptyState title="Project not found" action={<Link to="/projects"><Button>Back to projects</Button></Link>} />

  const all = (tasks.data ?? []).filter((t) => t.status !== 'cancelled')
  const done = all.filter((t) => t.status === 'completed').length
  const ms = (milestones.data ?? []) as Milestone[]
  const d = p.deadline ? daysUntil(p.deadline, tz) : null

  const onDelete = async () => {
    if (await confirm({ title: 'Delete project?', message: 'Milestones are deleted. Tasks are kept but unlinked from the project.', danger: true, confirmLabel: 'Delete project', typeToConfirm: p.title.slice(0, 40) })) {
      await remove.mutateAsync(p.id)
      navigate('/projects')
    }
  }

  return (
    <div>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Projects</Link>
      <PageHeader
        title={<span className="flex items-center gap-3"><span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: p.color }} />{p.title}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-2"><ProjectStatusBadge status={p.status} /><PriorityBadge priority={p.priority} />
          {p.deadline && <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', d! < 0 && p.status !== 'completed' ? 'text-danger' : 'text-muted')}><CalendarClock className="h-3.5 w-3.5" />Deadline {fmt(p.deadline + 'T12:00:00Z', 'UTC', 'd MMM yyyy')}{p.status !== 'completed' && ` · ${d! < 0 ? `${-d!}d overdue` : `${d}d left`}`}</span>}</span>}
        actions={<>
          <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => openProject(p)}>Edit</Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete project"><Trash2 className="h-4 w-4 text-danger" /></Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => openTask(null, { project_id: p.id, category_id: p.category_id })}>Task</Button>
        </>} />

      <Segmented className="mb-4" value={tab} onChange={setTab} size="sm" options={[
        { value: 'overview', label: 'Overview' }, { value: 'board', label: 'Kanban' }, { value: 'timeline', label: 'Timeline' }, { value: 'calendar', label: 'Calendar' },
        { value: 'notes', label: 'Notes' }, { value: 'files', label: 'Files' }, { value: 'history', label: 'History' },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <div className="flex flex-wrap items-center gap-6">
                <ProgressRing value={p.progress} size={96} stroke={9} color={p.color} />
                <div className="grid flex-1 grid-cols-3 gap-3 text-center">
                  <div><div className="text-2xl font-extrabold">{all.length}</div><div className="text-xs text-muted">Tasks</div></div>
                  <div><div className="text-2xl font-extrabold text-success">{done}</div><div className="text-xs text-muted">Done</div></div>
                  <div><div className="text-2xl font-extrabold">{ms.filter((m) => m.is_done).length}/{ms.length}</div><div className="text-xs text-muted">Milestones</div></div>
                </div>
              </div>
              <p className="mt-3 text-xs text-subtle">{p.progress_mode === 'auto' ? 'Progress = completed tasks ÷ all non-cancelled tasks.' : 'Progress is set manually.'}</p>
              {p.description && <p className="mt-4 text-sm whitespace-pre-wrap text-muted">{p.description}</p>}
              {p.links.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {p.links.map((l) => safeUrl(l.url) && <a key={l.url} href={safeUrl(l.url)!} target="_blank" rel="noopener noreferrer" className="chip bg-surface-2 py-1 text-fg hover:text-primary"><ExternalLink className="h-3 w-3" />{l.label}</a>)}
                </div>
              )}
            </Card>
            <BurnUp tasks={all} color={p.color} />
            <Card title="Tasks" action={<Button size="sm" variant="soft" onClick={() => openTask(null, { project_id: p.id })}>Add</Button>}>
              {tasks.isLoading ? <ListSkeleton /> : all.length ? <ul>{all.map((t) => <li key={t.id}><TaskItem task={t} showProject={false} /></li>)}</ul> : <EmptyState compact title="No tasks yet" />}
            </Card>
          </div>
          <Milestones projectId={p.id} milestones={ms} />
        </div>
      )}
      {tab === 'board' && <ProjectBoard tasks={all} />}
      {tab === 'timeline' && <TimelineView items={projectItems(p, all, ms, tz)} startKey={addDaysKey(todayKey(tz), -3)} days={21} />}
      {tab === 'calendar' && <ProjectCalendar items={projectItems(p, all, ms, tz)} />}
      {tab === 'notes' && <ProjectNotes projectId={p.id} onNew={() => void newNote({ project_id: p.id, kind: 'project' })} />}
      {tab === 'files' && <Card><Attachments entityType="project" entityId={p.id} /></Card>}
      {tab === 'history' && <Card><TaskHistory taskId={p.id} entity="project" /></Card>}
    </div>
  )
}

function projectItems(p: Project, tasks: ReturnType<typeof useTasks>['data'] & object, ms: Milestone[], tz: string): CalendarItem[] {
  const day = (k: string) => [zonedInstant(k, '00:00', tz), zonedInstant(addDaysKey(k, 1), '00:00', tz)] as const
  const out: CalendarItem[] = []
  for (const t of tasks) {
    const s = t.start_date ?? t.due_date
    const e = t.due_date ?? t.start_date
    if (!s || !e) continue
    out.push({ key: t.id, kind: 'task', id: t.id, title: t.title, start: day(s)[0], end: day(e)[1], allDay: true, color: p.color, done: t.status === 'completed', row: t })
  }
  for (const m of ms) if (m.due_date) out.push({ key: m.id, kind: 'deadline', id: p.id, title: `◆ ${m.title}`, start: day(m.due_date)[0], end: day(m.due_date)[1], allDay: true, color: 'var(--series-2)', done: m.is_done, row: p })
  if (p.deadline) out.push({ key: 'deadline', kind: 'deadline', id: p.id, title: '⚑ Project deadline', start: day(p.deadline)[0], end: day(p.deadline)[1], allDay: true, color: 'var(--series-8)', row: p })
  return out
}

function BurnUp({ tasks, color }: { tasks: { created_at: string; completed_at: string | null }[]; color: string }) {
  const { tz } = useAppData()
  const data = useMemo(() => {
    if (!tasks.length) return []
    const today = todayKey(tz)
    const first = tasks.reduce((m, t) => (t.created_at < m ? t.created_at : m), tasks[0].created_at)
    let start = localDateKey(new Date(first), tz)
    const span = Math.min(90, Math.max(1, (new Date(today).getTime() - new Date(start).getTime()) / 86_400_000))
    start = addDaysKey(today, -span)
    return Array.from({ length: span + 1 }, (_, i) => {
      const k = addDaysKey(start, i)
      const end = zonedInstant(addDaysKey(k, 1), '00:00', tz).toISOString()
      return {
        day: fmt(k + 'T12:00:00Z', 'UTC', 'd MMM'),
        Scope: tasks.filter((t) => t.created_at < end).length,
        Completed: tasks.filter((t) => t.completed_at && t.completed_at < end).length,
      }
    })
  }, [tasks, tz])
  return (
    <ChartCard title="Progress over time" subtitle="Total tasks in scope vs completed (last 90 days)" rows={data} empty={!data.length}
      columns={[{ key: 'day', label: 'Day' }, { key: 'Scope', label: 'Scope' }, { key: 'Completed', label: 'Completed' }]}>
      <div className="h-56">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="day" {...axisProps} minTickGap={24} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--line-strong)' }} />
            <Area type="monotone" dataKey="Scope" stroke="var(--chart-axis)" strokeWidth={2} fill="transparent" strokeDasharray="4 3" />
            <Area type="monotone" dataKey="Completed" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.15} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted"><span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--chart-axis)' }} />Scope</span><span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: color }} />Completed</span></div>
    </ChartCard>
  )
}

function Milestones({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const { tz } = useAppData()
  const { create, update, remove } = useCrud('project_milestones', ['projects'])
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const done = milestones.filter((m) => m.is_done).length
  return (
    <Card title={`Milestones · ${pct(done, milestones.length)}%`} icon={<Flag className="h-4 w-4" />}>
      <ol className="relative space-y-1 border-l-2 border-line pl-4">
        {milestones.map((m) => {
          const overdue = !m.is_done && m.due_date && m.due_date < todayKey(tz)
          return (
            <li key={m.id} className="group relative flex items-start gap-2 py-1.5">
              <span className={cn('absolute -left-[23px] mt-1 h-3 w-3 rotate-45 rounded-[2px] border-2', m.is_done ? 'border-success bg-success' : 'border-line-strong bg-surface')} />
              <Checkbox checked={m.is_done} onChange={(v) => update.mutate({ id: m.id, is_done: v })} label={m.title} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-semibold', m.is_done && 'text-muted line-through')}>{m.title}</div>
                {m.due_date && <div className={cn('text-xs', overdue ? 'text-danger' : 'text-muted')}>{fmt(m.due_date + 'T12:00:00Z', 'UTC', 'd MMM yyyy')}{m.done_at && ` · done ${fmt(m.done_at, tz, 'd MMM')}`}</div>}
              </div>
              <button className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove.mutate(m.id)} aria-label={`Delete milestone ${m.title}`}><X className="h-4 w-4 text-muted" /></button>
            </li>
          )
        })}
        {!milestones.length && <li className="text-sm text-subtle">No milestones yet.</li>}
      </ol>
      <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; create.mutate({ project_id: projectId, title: title.trim(), due_date: due || null, sort_order: milestones.length }); setTitle(''); setDue('') }}>
        <Input placeholder="New milestone" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Milestone title" />
        <div className="flex gap-2"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Milestone date" /><Button type="submit" variant="soft">Add</Button></div>
      </form>
    </Card>
  )
}

function ProjectBoard({ tasks }: { tasks: { id: string; status: TaskStatus }[] & object }) {
  const cols: TaskStatus[] = ['not_started', 'in_progress', 'pending', 'completed']
  const typed = tasks as Parameters<typeof TaskItem>[0]['task'][]
  return (
    <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0">
      {cols.map((s) => {
        const meta = TASK_STATUSES.find((x) => x.value === s)!
        const items = typed.filter((t) => t.status === s)
        return (
          <div key={s} className="w-[80vw] max-w-xs shrink-0 snap-start rounded-2xl border border-line bg-surface-2/60 p-2 sm:w-72 lg:w-auto lg:max-w-none">
            <div className="mb-2 flex items-center gap-2 px-2 pt-1 text-sm font-bold"><span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />{meta.label}<span className="ml-auto text-xs text-muted">{items.length}</span></div>
            <div className="space-y-2">{items.map((t) => <div key={t.id} className="card p-1.5"><TaskItem task={t} showProject={false} /></div>)}</div>
          </div>
        )
      })}
      <p className="col-span-full hidden text-xs text-muted lg:block">Tip: drag cards between columns on the Tasks → Kanban view (filter by this project).</p>
    </div>
  )
}

function ProjectCalendar({ items }: { items: CalendarItem[] }) {
  const { tz, settings } = useAppData()
  const [month, setMonth] = useState(() => todayKey(tz).slice(0, 7))
  const first = new Date(month + '-01T00:00:00Z')
  const offset = (first.getUTCDay() - settings.week_starts_on + 7) % 7
  const start = addDaysKey(month + '-01', -offset)
  const days = Array.from({ length: 42 }, (_, i) => addDaysKey(start, i))
  const shift = (n: number) => { const d = new Date(first); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)) }
  const on = (k: string) => items.filter((i) => localDateKey(i.start, tz) <= k && localDateKey(new Date(i.end.getTime() - 1), tz) >= k)
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shift(-1)} aria-label="Previous month">‹</Button>
        <div className="flex-1 text-center font-bold">{fmt(first, 'UTC', 'MMMM yyyy')}</div>
        <Button size="sm" variant="outline" onClick={() => shift(1)} aria-label="Next month">›</Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div key={d} className={cn('min-h-20 rounded-lg border border-line p-1', d.slice(0, 7) !== month && 'opacity-40')}>
            <div className="text-right text-[11px] text-muted">{Number(d.slice(8))}</div>
            {on(d).slice(0, 3).map((i) => <div key={i.key} className={cn('mb-0.5 truncate rounded px-1 text-[10px] font-semibold text-white', i.done && 'opacity-50')} style={{ background: i.color }}>{i.title}</div>)}
          </div>
        ))}
      </div>
    </Card>
  )
}

function ProjectNotes({ projectId, onNew }: { projectId: string; onNew: () => void }) {
  const { tz } = useAppData()
  const notes = useRows('notes', ['project', projectId], (q) => q.eq('project_id', projectId).order('updated_at', { ascending: false }))
  const rows = (notes.data ?? []) as Note[]
  return (
    <Card title="Project notes" icon={<StickyNote className="h-4 w-4" />} action={<Button size="sm" variant="soft" onClick={onNew}>New note</Button>}>
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((n) => <li key={n.id}><Link to={`/notes/${n.id}`} className="block py-2.5 hover:text-primary"><div className="font-semibold">{n.title}</div><div className="truncate text-xs text-muted">{n.content_text.slice(0, 120) || 'Empty'} · {fmt(n.updated_at, tz, 'd MMM')}</div></Link></li>)}
        </ul>
      ) : <EmptyState compact art="notes" title="No notes for this project" />}
    </Card>
  )
}
