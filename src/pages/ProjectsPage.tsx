import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, FolderKanban, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader, PriorityBadge, ProgressBar, ProjectStatusBadge, Segmented } from '@/components/ui/display'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { daysUntil } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useRows } from '@/services/resource'
import type { Project, ProjectStatus, Task } from '@/types/db'

export default function ProjectsPage() {
  const { tz } = useAppData()
  const { openProject } = useQuickCreate()
  const [filter, setFilter] = useState<'current' | ProjectStatus | 'all'>('current')
  const projects = useRows('projects', ['list'], (q) => q.order('updated_at', { ascending: false }).limit(500))
  const counts = useRows('tasks', ['project-counts'], (q) => q.not('project_id', 'is', null).limit(5000), { select: 'project_id,status' })

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>()
    for (const t of (counts.data ?? []) as Pick<Task, 'project_id' | 'status'>[]) {
      if (!t.project_id || t.status === 'cancelled') continue
      const s = m.get(t.project_id) ?? { total: 0, done: 0 }
      s.total++
      if (t.status === 'completed') s.done++
      m.set(t.project_id, s)
    }
    return m
  }, [counts.data])

  const rows = ((projects.data ?? []) as Project[]).filter((p) => filter === 'all' || (filter === 'current' ? ['planning', 'active', 'on_hold'].includes(p.status) : p.status === filter))

  return (
    <div>
      <PageHeader title="Projects" subtitle="Plan, track and finish what matters." actions={<Button onClick={() => openProject()} icon={<Plus className="h-4 w-4" />}>New project</Button>} />
      <Segmented className="mb-4" value={filter} onChange={setFilter} size="sm" options={[
        { value: 'current', label: 'Current' }, { value: 'active', label: 'Active' }, { value: 'planning', label: 'Planning' },
        { value: 'on_hold', label: 'On hold' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' },
      ]} />
      {projects.error ? <ErrorState error={projects.error} onRetry={() => projects.refetch()} /> : projects.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card space-y-3 p-5"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3" /><Skeleton className="h-2" /></div>)}</div>
      ) : rows.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const s = stats.get(p.id) ?? { total: 0, done: 0 }
            const d = p.deadline ? daysUntil(p.deadline, tz) : null
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="card group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: p.color }} />
                <div className="mb-2 flex items-center gap-2"><ProjectStatusBadge status={p.status} />{p.priority !== 'medium' && <PriorityBadge priority={p.priority} />}</div>
                <h3 className="truncate text-base font-bold group-hover:text-primary">{p.title}</h3>
                {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p>}
                <div className="mt-4 mb-1.5 flex justify-between text-xs"><span className="text-muted">{s.done}/{s.total} tasks</span><span className="font-bold">{p.progress}%</span></div>
                <ProgressBar value={p.progress} color={p.color} label={`${p.title} progress`} />
                {d !== null && p.status !== 'completed' && (
                  <div className={cn('mt-3 inline-flex items-center gap-1 text-xs font-semibold', d < 0 ? 'text-danger' : d <= 7 ? 'text-warning' : 'text-muted')}>
                    <CalendarClock className="h-3.5 w-3.5" />{d < 0 ? `${-d} days overdue` : d === 0 ? 'Due today' : `${d} days left`}
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      ) : <EmptyState art="target" title="No projects here" description="Projects group tasks, milestones and notes around one outcome." action={<Button onClick={() => openProject()} icon={<FolderKanban className="h-4 w-4" />}>Create a project</Button>} />}
    </div>
  )
}
