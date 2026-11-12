import { useMemo } from 'react'
import { useRows } from '@/services/resource'
import { useTasks } from '@/services/tasks'
import type { Project, Task, TaskDependency } from '@/types/db'

/** All open tasks + dependency map, used by dashboards and focus ranking. */
export function useOpenTasks() {
  const tasks = useTasks(['open'], (q) => q.not('status', 'in', '(completed,cancelled)').order('due_at', { ascending: true, nullsFirst: false }).limit(1000))
  const deps = useRows('task_dependencies', ['all'], (q) => q.limit(2000))
  const blocked = useMemo(() => {
    const open = new Set((tasks.data ?? []).map((t) => t.id))
    return new Set(((deps.data ?? []) as TaskDependency[]).filter((d) => open.has(d.depends_on_task_id)).map((d) => d.task_id))
  }, [tasks.data, deps.data])
  return { ...tasks, blocked }
}

export function useProjectNames() {
  const q = useRows('projects', ['names'], undefined, { select: 'id,title,color,status' })
  return useMemo(() => new Map(((q.data ?? []) as Pick<Project, 'id' | 'title' | 'color'>[]).map((p) => [p.id, p.title])), [q.data])
}

export type { Task }
