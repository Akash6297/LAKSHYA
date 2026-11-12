// Replays the offline queue against Supabase. Rules:
//  • inserts use client-generated ids → replaying twice is harmless (idempotent)
//  • updates check the server's updated_at first; if the server changed after the
//    local edit was made, we DO NOT overwrite – a conflict is recorded for the user
//  • network failures stop the run and keep the queue intact
import { supabase } from '@/lib/supabase'
import { addConflict, listQueue, putOp, removeOp, type QueuedOp } from './db'

export type SyncResult = { synced: number; conflicts: number; failed: number; offline: boolean }

const isNetworkError = (e: unknown) =>
  !navigator.onLine || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(String((e as Error)?.message ?? e))

let running: Promise<SyncResult> | null = null

export function processQueue(): Promise<SyncResult> {
  running ??= run().finally(() => (running = null))
  return running
}

async function run(): Promise<SyncResult> {
  const r: SyncResult = { synced: 0, conflicts: 0, failed: 0, offline: false }
  for (const op of await listQueue()) {
    try {
      const outcome = await apply(op)
      if (outcome === 'conflict') r.conflicts++
      else r.synced++
      await removeOp(op.id)
    } catch (e) {
      if (isNetworkError(e)) {
        r.offline = true
        break
      }
      const attempts = op.attempts + 1
      if (attempts >= 5) {
        await addConflict({ table: op.table, rowId: op.rowId, local: op.payload, server: null, reason: 'rejected', message: (e as Error).message })
        await removeOp(op.id)
        r.conflicts++
      } else {
        await putOp({ ...op, attempts, lastError: (e as Error).message })
        r.failed++
      }
    }
  }
  return r
}

async function apply(op: QueuedOp): Promise<'ok' | 'conflict'> {
  const t = supabase.from(op.table)
  if (op.op === 'insert') {
    const { error } = await t.upsert({ ...op.payload, id: op.rowId } as never, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
    return 'ok'
  }
  if (op.op === 'delete') {
    const { error } = await t.delete().eq('id', op.rowId)
    if (error) throw new Error(error.message)
    return 'ok'
  }
  // update with optimistic-concurrency check
  const { data: server, error: readErr } = await t.select('*').eq('id', op.rowId).maybeSingle()
  if (readErr) throw new Error(readErr.message)
  if (!server) {
    await addConflict({ table: op.table, rowId: op.rowId, local: op.payload, server: null, reason: 'deleted_on_server' })
    return 'conflict'
  }
  const serverUpdated = (server as { updated_at?: string }).updated_at
  if (op.baseUpdatedAt && serverUpdated && new Date(serverUpdated) > new Date(op.baseUpdatedAt)) {
    await addConflict({ table: op.table, rowId: op.rowId, local: op.payload, server, reason: 'server_newer' })
    return 'conflict'
  }
  const { error } = await t.update(op.payload as never).eq('id', op.rowId)
  if (error) throw new Error(error.message)
  return 'ok'
}
