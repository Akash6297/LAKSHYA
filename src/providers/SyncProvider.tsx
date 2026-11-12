import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { listConflicts, listQueue, removeConflict, type Conflict } from '@/offline/db'
import { processQueue } from '@/offline/sync'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthProvider'

interface SyncCtx {
  online: boolean
  pending: number
  syncing: boolean
  conflicts: Conflict[]
  refresh: () => Promise<void>
  syncNow: () => Promise<void>
  resolveConflict: (c: Conflict, keep: 'local' | 'server') => Promise<void>
}

const Ctx = createContext<SyncCtx | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [conflicts, setConflicts] = useState<Conflict[]>([])

  const refresh = useCallback(async () => {
    setPending((await listQueue()).length)
    setConflicts(await listConflicts())
  }, [])

  const syncNow = useCallback(async () => {
    if (!user || !navigator.onLine) return
    if ((await listQueue()).length === 0) return refresh()
    setSyncing(true)
    try {
      const r = await processQueue()
      if (r.synced) toast.success(`Synced ${r.synced} offline change${r.synced === 1 ? '' : 's'}`)
      if (r.conflicts) toast.warning(`${r.conflicts} change${r.conflicts === 1 ? '' : 's'} need your review`, { description: 'Open Tasks to resolve sync conflicts.' })
      await qc.invalidateQueries({ queryKey: ['tasks'] })
      await qc.invalidateQueries({ queryKey: ['task_subtasks'] })
    } finally {
      setSyncing(false)
      await refresh()
    }
  }, [user, qc, refresh])

  useEffect(() => {
    const on = () => {
      setOnline(true)
      void syncNow()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const onQueue = () => void refresh()
    window.addEventListener('lakshya:queue', onQueue)
    void refresh().then(syncNow)
    const t = setInterval(() => void syncNow(), 60_000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('lakshya:queue', onQueue)
      clearInterval(t)
    }
  }, [refresh, syncNow])

  const resolveConflict = useCallback(async (c: Conflict, keep: 'local' | 'server') => {
    if (keep === 'local') {
      const { id: _id, user_id: _u, created_at: _c, updated_at: _up, ...payload } = c.local as Record<string, unknown>
      const res = c.server
        ? await supabase.from(c.table).update(payload as never).eq('id', c.rowId)
        : await supabase.from(c.table).insert({ ...payload, id: c.rowId } as never)
      if (res.error) {
        toast.error(res.error.message)
        return
      }
    }
    await removeConflict(c.id)
    await qc.invalidateQueries({ queryKey: [c.table] })
    await refresh()
  }, [qc, refresh])

  return <Ctx.Provider value={{ online, pending, syncing, conflicts, refresh, syncNow, resolveConflict }}>{children}</Ctx.Provider>
}

export function useSync() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSync outside SyncProvider')
  return c
}
