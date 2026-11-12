// Full data export / restore. Export pages through every user table (RLS
// guarantees only the caller's rows). Restore remaps every id to a fresh UUID
// so a backup can be restored into any account without collisions, then
// inserts everything in ONE database transaction via the import_backup RPC.
import { supabase, unwrap } from './supabase'

export const BACKUP_TABLES = [
  'categories', 'projects', 'project_milestones', 'meetings', 'meeting_participants', 'events', 'tasks', 'task_subtasks',
  'task_dependencies', 'subjects', 'chapters', 'study_sessions', 'exams', 'time_off', 'work_checklist_items', 'notes',
  'goals', 'goal_milestones', 'habits', 'habit_logs', 'focus_sessions', 'day_plans',
] as const

export interface Backup {
  app: 'lakshya'
  version: 1
  exported_at: string
  settings?: Record<string, unknown> | null
  tables: Partial<Record<(typeof BACKUP_TABLES)[number], Record<string, unknown>[]>>
}

async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const rows = unwrap(await supabase.from(table).select('*').order('created_at').range(from, from + 999)) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export async function exportAll(onProgress?: (t: string) => void): Promise<Backup> {
  const tables: Backup['tables'] = {}
  for (const t of BACKUP_TABLES) {
    onProgress?.(t)
    tables[t] = await fetchAll(t)
  }
  const settings = unwrap(await supabase.from('user_settings').select('*').maybeSingle()) as Record<string, unknown> | null
  return { app: 'lakshya', version: 1, exported_at: new Date().toISOString(), settings, tables }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Replace every row id (and every reference to it) with a new UUID. Pure. */
export function remapIds(b: Backup, gen: () => string = () => crypto.randomUUID()): Backup['tables'] {
  const map = new Map<string, string>()
  for (const rows of Object.values(b.tables)) for (const r of rows ?? []) if (typeof r.id === 'string') map.set(r.id, gen())
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string' && UUID_RE.test(v)) return map.get(v) ?? v
    if (Array.isArray(v)) return v.map(swap)
    return v
  }
  const out: Backup['tables'] = {}
  for (const [t, rows] of Object.entries(b.tables) as [keyof Backup['tables'], Record<string, unknown>[]][]) {
    out[t] = (rows ?? []).map((r) => {
      const n: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) {
        if (k === 'user_id' || k === 'client_key') continue
        n[k] = k.endsWith('_id') || k === 'id' ? swap(v) : v
      }
      return n
    })
  }
  return out
}

export function validateBackup(data: unknown): Backup {
  const b = data as Backup
  if (!b || b.app !== 'lakshya' || b.version !== 1 || typeof b.tables !== 'object') throw new Error('This is not a LAKSHYA backup file.')
  for (const [t, rows] of Object.entries(b.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(t)) throw new Error(`Unknown table in backup: ${t}`)
    if (!Array.isArray(rows)) throw new Error(`Malformed table: ${t}`)
  }
  return b
}

/**
 * Restore into the current account. Categories that already exist (same slug)
 * are merged so the defaults are not duplicated.
 */
export async function restoreBackup(b: Backup): Promise<Record<string, number>> {
  const existing = unwrap(await supabase.from('categories').select('id,slug')) as { id: string; slug: string }[]
  const bySlug = new Map(existing.map((c) => [c.slug, c.id]))
  const tables = remapIds(b)
  // point references at existing categories instead of inserting duplicates
  const catMap = new Map<string, string>()
  tables.categories = (tables.categories ?? []).filter((c) => {
    const ex = bySlug.get(String(c.slug))
    if (ex) { catMap.set(String(c.id), ex); return false }
    return true
  })
  for (const rows of Object.values(tables)) for (const r of rows ?? []) if (typeof r.category_id === 'string' && catMap.has(r.category_id)) r.category_id = catMap.get(r.category_id)
  return unwrap(await supabase.rpc('import_backup', { p: tables })) as Record<string, number>
}

function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n')
}
