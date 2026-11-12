import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export type OfflineTable = 'tasks' | 'task_subtasks'

export interface QueuedOp {
  id: string
  table: OfflineTable
  op: 'insert' | 'update' | 'delete'
  rowId: string
  payload: Record<string, unknown>
  /** server updated_at the local edit was based on – used for conflict detection */
  baseUpdatedAt: string | null
  createdAt: number
  attempts: number
  lastError?: string
}

export interface Conflict {
  id: string
  table: OfflineTable
  rowId: string
  local: Record<string, unknown>
  server: Record<string, unknown> | null
  reason: 'server_newer' | 'deleted_on_server' | 'rejected'
  message?: string
  createdAt: number
}

interface LakshyaDB extends DBSchema {
  cache: { key: string; value: { key: string; data: unknown; savedAt: number } }
  queue: { key: string; value: QueuedOp; indexes: { byCreated: number } }
  conflicts: { key: string; value: Conflict }
}

let dbp: Promise<IDBPDatabase<LakshyaDB>> | null = null

export function getDB() {
  dbp ??= openDB<LakshyaDB>('lakshya', 1, {
    upgrade(db) {
      db.createObjectStore('cache', { keyPath: 'key' })
      db.createObjectStore('queue', { keyPath: 'id' }).createIndex('byCreated', 'createdAt')
      db.createObjectStore('conflicts', { keyPath: 'id' })
    },
  })
  return dbp
}

export async function cacheSet(key: string, data: unknown) {
  try {
    await (await getDB()).put('cache', { key, data, savedAt: Date.now() })
  } catch {
    /* quota / private mode – offline cache is best-effort */
  }
}

export async function cacheGet<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  try {
    const v = await (await getDB()).get('cache', key)
    return v ? { data: v.data as T, savedAt: v.savedAt } : null
  } catch {
    return null
  }
}

export async function listQueue(): Promise<QueuedOp[]> {
  return (await getDB()).getAllFromIndex('queue', 'byCreated')
}

/**
 * Enqueue with coalescing so the server sees the minimum set of operations:
 * insert+update → insert(merged); insert+delete → nothing; update+update → merged update.
 */
export async function enqueue(op: Omit<QueuedOp, 'id' | 'createdAt' | 'attempts'>) {
  const db = await getDB()
  const tx = db.transaction('queue', 'readwrite')
  const all = await tx.store.getAll()
  const existing = all.filter((o) => o.table === op.table && o.rowId === op.rowId)
  const pendingInsert = existing.find((o) => o.op === 'insert')
  const pendingUpdate = existing.find((o) => o.op === 'update')

  if (op.op === 'update' && pendingInsert) {
    await tx.store.put({ ...pendingInsert, payload: { ...pendingInsert.payload, ...op.payload } })
  } else if (op.op === 'update' && pendingUpdate) {
    await tx.store.put({ ...pendingUpdate, payload: { ...pendingUpdate.payload, ...op.payload } })
  } else if (op.op === 'delete' && pendingInsert) {
    for (const o of existing) await tx.store.delete(o.id)
  } else {
    if (op.op === 'delete') for (const o of existing) await tx.store.delete(o.id)
    await tx.store.put({ ...op, id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0 })
  }
  await tx.done
}

export async function removeOp(id: string) {
  await (await getDB()).delete('queue', id)
}

export async function putOp(op: QueuedOp) {
  await (await getDB()).put('queue', op)
}

export async function addConflict(c: Omit<Conflict, 'id' | 'createdAt'>) {
  await (await getDB()).put('conflicts', { ...c, id: crypto.randomUUID(), createdAt: Date.now() })
}

export async function listConflicts(): Promise<Conflict[]> {
  return (await getDB()).getAll('conflicts')
}

export async function removeConflict(id: string) {
  await (await getDB()).delete('conflicts', id)
}

export async function clearOfflineData() {
  try {
    const db = await getDB()
    await Promise.all([db.clear('cache'), db.clear('queue'), db.clear('conflicts')])
  } catch {
    /* nothing to clear */
  }
}
