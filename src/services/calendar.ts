// Unified, date-range-scoped calendar feed. Only rows overlapping the visible
// range are fetched (plus recurring masters, which are expanded client-side).
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { expandOccurrences, untilBefore, withUntil } from '@shared/recurrence.ts'
import { addDaysKey, localDateKey, zonedInstant } from '@/lib/dates'
import type { EventRow, Exam, Meeting, Project, StudySession, Subject, Task, TimeOff, Category } from '@/types/db'

export type ItemKind = 'event' | 'task' | 'meeting' | 'study' | 'exam' | 'deadline' | 'timeoff'

export interface CalendarItem {
  key: string
  kind: ItemKind
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  color: string
  done?: boolean
  /** for recurring events: the master row and the instance identity */
  master?: EventRow
  originalStart?: Date
  row: EventRow | Task | Meeting | StudySession | Exam | Project | TimeOff
}

const KIND_COLORS: Record<ItemKind, string> = {
  event: '#6366F1', task: '#8B5CF6', meeting: '#14B8A6', study: '#0EA5E9', exam: '#EF4444', deadline: '#F43F5E', timeoff: '#F59E0B',
}
export const kindColor = (k: ItemKind) => KIND_COLORS[k]

const iso = (d: Date) => d.toISOString()

export function useCalendarFeed(from: Date, to: Date, opts: { tz: string; categories: Map<string, Category>; kinds?: ItemKind[] }) {
  const F = iso(from), T = iso(to)
  const fromKey = localDateKey(from, opts.tz), toKey = localDateKey(to, opts.tz)
  const want = (k: ItemKind) => !opts.kinds || opts.kinds.includes(k)

  const results = useQueries({
    queries: [
      { queryKey: ['events', 'range', F, T], enabled: want('event'), queryFn: async () => {
        const [single, masters] = await Promise.all([
          supabase.from('events').select('*').is('rrule', null).lt('start_at', T).gt('end_at', F),
          supabase.from('events').select('*').not('rrule', 'is', null).lt('start_at', T),
        ])
        const rows = [...(unwrap(single) ?? []), ...(unwrap(masters) ?? [])] as EventRow[]
        return [...new Map(rows.map((r) => [r.id, r])).values()]
      } },
      { queryKey: ['tasks', 'range', F, T], enabled: want('task'), queryFn: async () => unwrap(await supabase.from('tasks').select('*')
          .neq('status', 'cancelled')
          .or(`and(start_at.lt.${T},end_at.gt.${F}),and(due_date.gte.${fromKey},due_date.lte.${toKey},start_at.is.null)`)) as Task[] },
      { queryKey: ['meetings', 'range', F, T], enabled: want('meeting'), queryFn: async () => unwrap(await supabase.from('meetings').select('*').lt('start_at', T).gt('end_at', F)) as Meeting[] },
      { queryKey: ['study_sessions', 'range', F, T], enabled: want('study'), queryFn: async () => unwrap(await supabase.from('study_sessions').select('*').lt('start_at', T).gt('end_at', F)) as StudySession[] },
      { queryKey: ['exams', 'range', F, T], enabled: want('exam'), queryFn: async () => unwrap(await supabase.from('exams').select('*').gte('exam_at', F).lt('exam_at', T)) as Exam[] },
      { queryKey: ['projects', 'deadlines', fromKey, toKey], enabled: want('deadline'), queryFn: async () => unwrap(await supabase.from('projects').select('*').gte('deadline', fromKey).lte('deadline', toKey)) as Project[] },
      { queryKey: ['time_off', 'range', fromKey, toKey], enabled: want('timeoff'), queryFn: async () => unwrap(await supabase.from('time_off').select('*').lte('start_date', toKey).gte('end_date', fromKey).neq('status', 'cancelled')) as TimeOff[] },
      { queryKey: ['subjects'], enabled: want('study') || want('exam'), queryFn: async () => unwrap(await supabase.from('subjects').select('*')) as Subject[] },
    ],
  })

  const [ev, tk, mt, st, ex, pj, to_, sb] = results
  const loading = results.some((r) => r.isLoading)
  const error = results.find((r) => r.error)?.error ?? null
  const subjects = new Map(((sb.data as Subject[] | undefined) ?? []).map((s) => [s.id, s]))
  const catColor = (id: string | null, fallback: string) => (id && opts.categories.get(id)?.color) || fallback

  const items: CalendarItem[] = []
  const events = (ev.data as EventRow[] | undefined) ?? []
  const overridden = new Map<string, Set<string>>()
  for (const e of events) {
    if (e.recurring_event_id && e.original_start) {
      const s = overridden.get(e.recurring_event_id) ?? new Set<string>()
      s.add(new Date(e.original_start).toISOString())
      overridden.set(e.recurring_event_id, s)
    }
  }
  for (const e of events) {
    const color = catColor(e.category_id, KIND_COLORS.event)
    if (e.rrule) {
      for (const o of expandOccurrences(e, from, to, overridden.get(e.id))) {
        items.push({ key: `e:${e.id}:${o.originalStart.toISOString()}`, kind: 'event', id: e.id, title: e.title, start: o.start, end: o.end, allDay: e.all_day, color, master: e, originalStart: o.originalStart, row: e })
      }
    } else {
      items.push({ key: `e:${e.id}`, kind: 'event', id: e.id, title: e.title, start: new Date(e.start_at), end: new Date(e.end_at), allDay: e.all_day, color, row: e,
        originalStart: e.original_start ? new Date(e.original_start) : undefined })
    }
  }
  for (const t of (tk.data as Task[] | undefined) ?? []) {
    const done = t.status === 'completed'
    const color = catColor(t.category_id, KIND_COLORS.task)
    if (t.start_at && t.end_at) items.push({ key: `t:${t.id}`, kind: 'task', id: t.id, title: t.title, start: new Date(t.start_at), end: new Date(t.end_at), allDay: false, color, done, row: t })
    else if (t.due_date) {
      const s = zonedInstant(t.due_date, '00:00', opts.tz)
      items.push({ key: `t:${t.id}`, kind: 'task', id: t.id, title: `☐ ${t.title}`, start: s, end: zonedInstant(addDaysKey(t.due_date, 1), '00:00', opts.tz), allDay: true, color, done, row: t })
    }
  }
  for (const m of (mt.data as Meeting[] | undefined) ?? [])
    items.push({ key: `m:${m.id}`, kind: 'meeting', id: m.id, title: m.title, start: new Date(m.start_at), end: new Date(m.end_at), allDay: false, color: KIND_COLORS.meeting, row: m })
  for (const s of (st.data as StudySession[] | undefined) ?? [])
    items.push({ key: `s:${s.id}`, kind: 'study', id: s.id, title: s.title || subjects.get(s.subject_id)?.name || 'Study', start: new Date(s.start_at), end: new Date(s.end_at), allDay: false,
      color: subjects.get(s.subject_id)?.color ?? KIND_COLORS.study, done: s.completed, row: s })
  for (const x of (ex.data as Exam[] | undefined) ?? []) {
    const s = new Date(x.exam_at)
    items.push({ key: `x:${x.id}`, kind: 'exam', id: x.id, title: `${x.kind === 'mock' ? 'Mock: ' : 'Exam: '}${x.title}`, start: s, end: new Date(s.getTime() + x.duration_minutes * 60_000), allDay: false, color: KIND_COLORS.exam, row: x })
  }
  for (const p of (pj.data as Project[] | undefined) ?? []) {
    if (!p.deadline) continue
    items.push({ key: `p:${p.id}`, kind: 'deadline', id: p.id, title: `⚑ ${p.title}`, start: zonedInstant(p.deadline, '00:00', opts.tz), end: zonedInstant(addDaysKey(p.deadline, 1), '00:00', opts.tz), allDay: true, color: p.color, done: p.status === 'completed', row: p })
  }
  for (const o of (to_.data as TimeOff[] | undefined) ?? [])
    items.push({ key: `o:${o.id}`, kind: 'timeoff', id: o.id, title: `🌴 ${o.title}`, start: zonedInstant(o.start_date, '00:00', opts.tz), end: zonedInstant(addDaysKey(o.end_date, 1), '00:00', opts.tz), allDay: true, color: KIND_COLORS.timeoff, row: o })

  items.sort((a, b) => a.start.getTime() - b.start.getTime())
  return { items, loading, error, refetch: () => results.forEach((r) => r.refetch()) }
}

// ---------------------------------------------------------------------------
// Event writes with recurring-series semantics
// ---------------------------------------------------------------------------
export type EditScope = 'this' | 'following' | 'all'
export type EventValues = Partial<Omit<EventRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>>

const ev = () => supabase.from('events')

export async function createEvent(values: EventValues): Promise<EventRow> {
  const client_key = values.client_key ?? crypto.randomUUID()
  // unique (user_id, client_key) makes double-submits harmless
  const res = await ev().upsert({ ...values, client_key } as never, { onConflict: 'user_id,client_key', ignoreDuplicates: false }).select().single()
  return unwrap(res) as EventRow
}

/**
 * Save edits to an item. For recurring series `scope` decides whether the
 * change applies to one occurrence, this-and-following, or the whole series.
 */
export async function updateEvent(item: { row: EventRow; master?: EventRow; originalStart?: Date }, values: EventValues, scope: EditScope = 'all') {
  const { row, master, originalStart } = item
  if (!master || !originalStart) {
    // single event or an existing exception row
    unwrap(await ev().update(values as never).eq('id', row.id))
    return
  }
  const isFirst = new Date(master.start_at).getTime() === originalStart.getTime()
  if (scope === 'this') {
    const { rrule: _r, exdates: _x, client_key: _c, ...rest } = values
    unwrap(await ev().insert({
      ...stripMeta(master), ...rest, rrule: null, exdates: [], client_key: null,
      recurring_event_id: master.id, original_start: originalStart.toISOString(),
    } as never))
    return
  }
  if (scope === 'following' && !isFirst) {
    const until = untilBefore(originalStart, master.timezone)
    unwrap(await ev().update({ rrule: withUntil(master.rrule!, until) }).eq('id', master.id))
    unwrap(await ev().delete().eq('recurring_event_id', master.id).gte('original_start', originalStart.toISOString()))
    unwrap(await ev().insert({ ...stripMeta(master), ...values, client_key: crypto.randomUUID(), exdates: [] } as never))
    return
  }
  // whole series: shift the master by the same delta the occurrence moved
  const patch: EventValues = { ...values }
  if (values.start_at && values.end_at) {
    const delta = new Date(values.start_at).getTime() - originalStart.getTime()
    const dur = new Date(values.end_at).getTime() - new Date(values.start_at).getTime()
    const ns = new Date(new Date(master.start_at).getTime() + delta)
    patch.start_at = ns.toISOString()
    patch.end_at = new Date(ns.getTime() + dur).toISOString()
    if (delta !== 0) patch.exdates = []
  }
  unwrap(await ev().update(patch as never).eq('id', master.id))
}

export async function deleteEvent(item: { row: EventRow; master?: EventRow; originalStart?: Date }, scope: EditScope = 'all') {
  const { row, master, originalStart } = item
  // an exception row: remove it and suppress the master instance it replaced
  if (row.recurring_event_id && row.original_start) {
    if (scope === 'this') {
      const { data } = await ev().select('exdates').eq('id', row.recurring_event_id).single()
      unwrap(await ev().update({ exdates: [...(data?.exdates ?? []), row.original_start] }).eq('id', row.recurring_event_id))
      unwrap(await ev().delete().eq('id', row.id))
      return
    }
    const masterRow = unwrap(await ev().select('*').eq('id', row.recurring_event_id).single()) as EventRow
    return deleteEvent({ row: masterRow, master: masterRow, originalStart: new Date(row.original_start) }, scope)
  }
  if (!master || !originalStart || scope === 'all') {
    unwrap(await ev().delete().eq('id', (master ?? row).id))
    return
  }
  if (scope === 'this') {
    unwrap(await ev().update({ exdates: [...(master.exdates ?? []), originalStart.toISOString()] }).eq('id', master.id))
    return
  }
  if (new Date(master.start_at).getTime() === originalStart.getTime()) {
    unwrap(await ev().delete().eq('id', master.id))
    return
  }
  unwrap(await ev().update({ rrule: withUntil(master.rrule!, untilBefore(originalStart, master.timezone)) }).eq('id', master.id))
  unwrap(await ev().delete().eq('recurring_event_id', master.id).gte('original_start', originalStart.toISOString()))
}

export async function duplicateEvent(row: EventRow): Promise<EventRow> {
  return createEvent({ ...stripMeta(row), title: `${row.title} (copy)`, recurring_event_id: null, original_start: null, client_key: crypto.randomUUID() })
}

function stripMeta(r: EventRow): EventValues {
  const { id: _i, user_id: _u, created_at: _c, updated_at: _up, ...rest } = r
  return rest
}

export function useInvalidateCalendar() {
  const qc = useQueryClient()
  return () => Promise.all(['events', 'tasks', 'meetings', 'study_sessions', 'exams', 'projects', 'time_off', 'activity_logs'].map((t) => qc.invalidateQueries({ queryKey: [t] })))
}
