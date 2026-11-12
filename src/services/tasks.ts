// Tasks are the offline-capable entity: reads fall back to IndexedDB, writes
// are queued when the network is unavailable and replayed by SyncProvider.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase, unwrap } from '@/lib/supabase'
import { cacheGet, cacheSet, enqueue, listQueue } from '@/offline/db'
import type { Builder } from './resource'
import type { Task } from '@/types/db'

export const isNetworkError = (e: unknown) =>
  !navigator.onLine || /Failed to fetch|NetworkError|Load failed|Network error|fetch failed/i.test(String((e as Error)?.message ?? e))

const notifyQueue = () => window.dispatchEvent(new Event('lakshya:queue'))

async function overlayQueue(rows: Task[]): Promise<Task[]> {
  const ops = (await listQueue()).filter((o) => o.table === 'tasks')
  let out = [...rows]
  for (const op of ops) {
    if (op.op === 'insert') {
      if (!out.some((t) => t.id === op.rowId)) out.unshift({ ...(op.payload as unknown as Task), id: op.rowId })
    } else if (op.op === 'update') {
      out = out.map((t) => (t.id === op.rowId ? { ...t, ...(op.payload as Partial<Task>) } : t))
    } else {
      out = out.filter((t) => t.id !== op.rowId)
    }
  }
  return out
}

export function useTasks(key: unknown[], build?: Builder, opts: { enabled?: boolean } = {}) {
  const cacheKey = `tasks:${JSON.stringify(key)}`
  return useQuery({
    queryKey: ['tasks', ...key],
    enabled: opts.enabled ?? true,
    networkMode: 'always',
    queryFn: async () => {
      try {
        if (!navigator.onLine) throw new TypeError('Failed to fetch')
        let q = supabase.from('tasks').select('*')
        if (build) q = build(q)
        const rows = unwrap(await q) as Task[]
        void cacheSet(cacheKey, rows)
        return overlayQueue(rows)
      } catch (e) {
        if (isNetworkError(e)) {
          const cached = await cacheGet<Task[]>(cacheKey)
          if (cached) return overlayQueue(cached.data)
        }
        throw e
      }
    },
  })
}

export type TaskInput = Partial<Omit<Task, 'id' | 'user_id' | 'created_at' | 'updated_at'>> & { title: string }

function patchCaches(qc: ReturnType<typeof useQueryClient>, fn: (rows: Task[]) => Task[]) {
  qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) => (Array.isArray(old) ? fn(old) : old))
}

export function useTaskActions() {
  const qc = useQueryClient()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] })
    void qc.invalidateQueries({ queryKey: ['projects'] })
    void qc.invalidateQueries({ queryKey: ['activity_logs'] })
  }

  const create = useMutation({
    meta: { silent: true },
    mutationFn: async (input: TaskInput): Promise<Task> => {
      const id = crypto.randomUUID()
      const row = { ...input, id, client_key: id }
      try {
        if (!navigator.onLine) throw new TypeError('Failed to fetch')
        return unwrap(await supabase.from('tasks').insert(row as never).select().single()) as Task
      } catch (e) {
        if (!isNetworkError(e)) throw e
        await enqueue({ table: 'tasks', op: 'insert', rowId: id, payload: row, baseUpdatedAt: null })
        notifyQueue()
        const now = new Date().toISOString()
        const local = { status: 'not_started', priority: 'medium', tags: [], reminder_minutes: [], ...row, created_at: now, updated_at: now } as unknown as Task
        patchCaches(qc, (rows) => [local, ...rows])
        toast.info('Saved offline – will sync when you reconnect')
        return local
      }
    },
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  })

  const update = useMutation({
    meta: { silent: true },
    mutationFn: async ({ id, patch, base }: { id: string; patch: Partial<Task>; base?: Pick<Task, 'updated_at'> }) => {
      try {
        if (!navigator.onLine) throw new TypeError('Failed to fetch')
        return unwrap(await supabase.from('tasks').update(patch as never).eq('id', id).select().single()) as Task
      } catch (e) {
        if (!isNetworkError(e)) throw e
        await enqueue({ table: 'tasks', op: 'update', rowId: id, payload: patch, baseUpdatedAt: base?.updated_at ?? null })
        notifyQueue()
        return null
      }
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const snapshot = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      patchCaches(qc, (rows) => rows.map((t) => (t.id === id ? { ...t, ...patch } : t)))
      return { snapshot }
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshot.forEach(([k, v]) => qc.setQueryData(k, v))
      toast.error((e as Error).message)
    },
    onSettled: (data) => {
      if (data !== null) invalidate()
    },
  })

  const remove = useMutation({
    meta: { silent: true },
    mutationFn: async (id: string) => {
      try {
        if (!navigator.onLine) throw new TypeError('Failed to fetch')
        unwrap(await supabase.from('tasks').delete().eq('id', id))
      } catch (e) {
        if (!isNetworkError(e)) throw e
        await enqueue({ table: 'tasks', op: 'delete', rowId: id, payload: {}, baseUpdatedAt: null })
        notifyQueue()
      }
      return id
    },
    onMutate: async (id) => {
      const snapshot = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      patchCaches(qc, (rows) => rows.filter((t) => t.id !== id))
      return { snapshot }
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshot.forEach(([k, v]) => qc.setQueryData(k, v))
      toast.error((e as Error).message)
    },
    onSettled: invalidate,
  })

  const toggle = (t: Task) => {
    const done = t.status === 'completed'
    update.mutate(
      { id: t.id, patch: { status: done ? 'not_started' : 'completed', completed_at: done ? null : new Date().toISOString() }, base: t },
      {
        onSuccess: () => {
          if (!done) {
            toast.success('Task completed', {
              description: t.recurrence ? 'Next occurrence created.' : undefined,
              action: { label: 'Undo', onClick: () => update.mutate({ id: t.id, patch: { status: t.status, completed_at: null } }) },
            })
          }
        },
      },
    )
  }

  return { create, update, remove, toggle }
}
