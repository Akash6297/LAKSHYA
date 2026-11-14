import { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, Building2, CalendarOff, Home, ListChecks, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge, Card, PageHeader } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form'
import { EmptyState } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/Modal'
import { TaskItem } from '@/features/tasks/TaskItem'
import { AgendaList } from '@/features/calendar/AgendaList'
import { addDaysKey, dowOfKey, fmt, todayKey, zonedDayBounds } from '@/lib/dates'
import { cn, minutesToHuman } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useCalendarFeed } from '@/services/calendar'
import { useCrud, useRows } from '@/services/resource'
import { useTasks } from '@/services/tasks'
import type { ChecklistItem, TimeOff, WorkDay } from '@/types/db'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }

export default function WorkPage() {
  const { tz, settings, updateSettings, categories, categoryById } = useAppData()
  const today = todayKey(tz)
  const weekStart = addDaysKey(today, -((dowOfKey(today) - settings.week_starts_on + 7) % 7))
  const [from, to] = useMemo(() => [zonedDayBounds(weekStart, tz)[0], zonedDayBounds(addDaysKey(weekStart, 6), tz)[1]], [weekStart, tz])
  const feed = useCalendarFeed(from, to, { tz, categories: categoryById, kinds: ['meeting', 'timeoff', 'event'] })
  const office = categories.find((c) => c.slug === 'office')
  const workTasks = useTasks(['work', office?.id], (q) => q.eq('category_id', office!.id).not('status', 'in', '(completed,cancelled)').order('due_at', { nullsFirst: false }).limit(50), { enabled: !!office })

  const [hours, setHours] = useState<Record<string, WorkDay>>(settings.working_hours)
  const [editing, setEditing] = useState(false)
  useEffect(() => setHours(settings.working_hours), [settings.working_hours])

  const weekly = Object.values(hours).filter((d) => d?.enabled).reduce((a, d) => a + Math.max(0, hm(d.end) - hm(d.start)), 0)
  const saveHours = async () => {
    for (const [k, d] of Object.entries(hours)) if (d.enabled && hm(d.end) <= hm(d.start)) return toast.error(`${DAYS[+k]}: end time must be after start`)
    try { await updateSettings({ working_hours: hours }); toast.success('Working hours saved'); setEditing(false) } catch (e) { toast.error((e as Error).message) }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i))
  const meetings = feed.items.filter((i) => i.kind === 'meeting')
  const leaves = feed.items.filter((i) => i.kind === 'timeoff')

  return (
    <div>
      <PageHeader title="Work" subtitle={`This week: ${minutesToHuman(weekly)} scheduled across ${Object.values(hours).filter((d) => d?.enabled).length} working days`} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Weekly work overview" icon={<BriefcaseBusiness className="h-4 w-4" />} action={<Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit hours</Button>}>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {days.map((k) => {
                const d = hours[String(dowOfKey(k))]
                const onLeave = leaves.some((l) => fmt(l.start, tz, 'yyyy-MM-dd') <= k && fmt(new Date(l.end.getTime() - 1), tz, 'yyyy-MM-dd') >= k)
                const mt = meetings.filter((m) => fmt(m.start, tz, 'yyyy-MM-dd') === k).length
                return (
                  <div key={k} className={cn('min-w-0 rounded-lg border px-0.5 py-2 text-center sm:rounded-xl sm:p-2', k === today ? 'border-primary bg-primary-soft' : 'border-line', !d?.enabled && 'opacity-50')}>
                    <div className="text-[10px] font-bold text-muted uppercase sm:text-[11px]"><span className="sm:hidden">{DAYS[dowOfKey(k)].slice(0, 2)}</span><span className="hidden sm:inline">{DAYS[dowOfKey(k)].slice(0, 3)}</span></div>
                    <div className="text-base font-extrabold sm:text-lg">{Number(k.slice(8))}</div>
                    {onLeave ? <Badge color="#F59E0B" className="max-w-full truncate px-1 text-[9px] sm:px-2 sm:text-xs">Leave</Badge> : d?.enabled ? (
                      <>
                        <div className="mt-1 flex justify-center" title={d.mode === 'office' ? 'Office' : 'Work from home'}>{d.mode === 'office' ? <Building2 className="h-4 w-4 text-primary" /> : <Home className="h-4 w-4 text-success" />}</div>
                        <div className="mt-1 hidden text-[10px] text-muted sm:block">{d.start}–{d.end}</div>
                        {mt > 0 && <div className="mt-1 text-[10px] font-semibold text-muted">{mt} mtg</div>}
                      </>
                    ) : <div className="mt-2 text-[10px] text-muted">Off</div>}
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-muted"><span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-primary" /> Office</span><span className="flex items-center gap-1"><Home className="h-3.5 w-3.5 text-success" /> Work from home</span></div>
          </Card>

          <DailyChecklist />

          <Card title="Work deadlines & office tasks" icon={<ListChecks className="h-4 w-4" />}>
            {!office ? <p className="text-sm text-muted">Create an “Office” category to group work tasks.</p> : (workTasks.data ?? []).length ? (
              <ul>{(workTasks.data ?? []).map((t) => <li key={t.id}><TaskItem task={t} /></li>)}</ul>
            ) : <EmptyState compact art="tasks" title="No open office tasks" description="Tasks in the Office category appear here." />}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Meetings this week"><AgendaList groupByDay items={meetings} empty={<EmptyState compact title="No meetings this week" />} /></Card>
          <TimeOffPanel />
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Working hours" description="Your schedule is never hard-coded – set each day." size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button onClick={() => void saveHours()}>Save</Button></>}>
        <div className="space-y-2">
          {DAYS.map((name, i) => {
            const d = hours[String(i)] ?? { enabled: false, start: '09:00', end: '17:00', mode: 'office' as const }
            const set = (p: Partial<WorkDay>) => setHours({ ...hours, [String(i)]: { ...d, ...p } })
            return (
              <div key={name} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-line p-3 sm:grid-cols-[140px_1fr_1fr_1fr]">
                <Switch checked={d.enabled} onChange={(v) => set({ enabled: v })} label={name} />
                <Input type="time" value={d.start} disabled={!d.enabled} onChange={(e) => set({ start: e.target.value })} aria-label={`${name} start`} className="col-span-1" />
                <Input type="time" value={d.end} disabled={!d.enabled} onChange={(e) => set({ end: e.target.value })} aria-label={`${name} end`} />
                <Select value={d.mode} disabled={!d.enabled} onChange={(e) => set({ mode: e.target.value as WorkDay['mode'] })} aria-label={`${name} location`}>
                  <option value="office">Office</option><option value="wfh">Work from home</option>
                </Select>
              </div>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}

function DailyChecklist() {
  const { tz } = useAppData()
  const [day, setDay] = useState(() => todayKey(tz))
  const items = useRows('work_checklist_items', [day], (q) => q.eq('item_date', day).order('sort_order').order('created_at'))
  const prev = useRows('work_checklist_items', ['prev', day], (q) => q.lt('item_date', day).eq('is_done', false).order('item_date', { ascending: false }).limit(20))
  const { create, createMany, update, remove } = useCrud('work_checklist_items')
  const [draft, setDraft] = useState('')
  const rows = (items.data ?? []) as ChecklistItem[]
  const carry = ((prev.data ?? []) as ChecklistItem[]).filter((p) => !rows.some((r) => r.title === p.title))
  return (
    <Card title="Daily work checklist" icon={<ListChecks className="h-4 w-4" />} action={<Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-8 w-36 py-1 text-xs sm:w-40" aria-label="Checklist date" />}>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
            <Checkbox checked={r.is_done} onChange={(v) => update.mutate({ id: r.id, is_done: v })} label={r.title} />
            <span className={cn('flex-1 text-sm', r.is_done && 'text-muted line-through')}>{r.title}</span>
            <button className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove.mutate(r.id)} aria-label={`Delete ${r.title}`}><X className="h-4 w-4 text-muted" /></button>
          </li>
        ))}
        {!rows.length && <li className="px-2 text-sm text-subtle">Nothing on the checklist for this day.</li>}
      </ul>
      {carry.length > 0 && (
        <button className="mt-2 text-xs font-semibold text-primary" onClick={() => createMany.mutate(carry.map((c, i) => ({ item_date: day, title: c.title, sort_order: rows.length + i })))}>
          Copy {carry.length} unfinished item{carry.length > 1 ? 's' : ''} from earlier days
        </button>
      )}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { create.mutate({ item_date: day, title: draft.trim(), sort_order: rows.length }); setDraft('') } }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add checklist item…" aria-label="New checklist item" />
        <Button type="submit" variant="soft" size="icon" aria-label="Add"><Plus className="h-4 w-4" /></Button>
      </form>
    </Card>
  )
}

function TimeOffPanel() {
  const { tz } = useAppData()
  const confirm = useConfirm()
  const rows = useRows('time_off', ['upcoming'], (q) => q.gte('end_date', addDaysKey(todayKey(tz), -30)).order('start_date'))
  const { create, update, remove } = useCrud('time_off')
  const [form, setForm] = useState<{ open: boolean; row?: TimeOff }>({ open: false })
  const [v, setV] = useState({ title: '', kind: 'leave', start_date: '', end_date: '', status: 'planned' })
  useEffect(() => {
    if (form.open) setV(form.row ? { title: form.row.title, kind: form.row.kind, start_date: form.row.start_date, end_date: form.row.end_date, status: form.row.status } : { title: '', kind: 'leave', start_date: todayKey(tz), end_date: todayKey(tz), status: 'planned' })
  }, [form, tz])
  const save = async () => {
    if (!v.title.trim() || !v.start_date || !v.end_date) return toast.error('Fill in title and dates')
    if (v.end_date < v.start_date) return toast.error('End date must be after start')
    const payload = { ...v, title: v.title.trim(), kind: v.kind as TimeOff['kind'], status: v.status as TimeOff['status'] }
    if (form.row) await update.mutateAsync({ id: form.row.id, ...payload })
    else await create.mutateAsync(payload)
    setForm({ open: false })
  }
  const list = (rows.data ?? []) as TimeOff[]
  const days = (r: TimeOff) => (new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86_400_000 + 1
  return (
    <Card title="Leave & holidays" icon={<CalendarOff className="h-4 w-4" />} action={<Button size="sm" variant="soft" onClick={() => setForm({ open: true })}>Plan</Button>}>
      {list.length ? (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className={cn('flex items-center gap-3 rounded-xl border border-line p-2.5', r.status === 'cancelled' && 'opacity-50')}>
              <button className="min-w-0 flex-1 text-left" onClick={() => setForm({ open: true, row: r })}>
                <div className="truncate text-sm font-semibold">{r.title}</div>
                <div className="text-xs text-muted">{fmt(r.start_date + 'T12:00:00Z', 'UTC', 'd MMM')} – {fmt(r.end_date + 'T12:00:00Z', 'UTC', 'd MMM yyyy')} · {days(r)} day{days(r) > 1 ? 's' : ''}</div>
              </button>
              <Badge>{r.kind}</Badge>
              <button onClick={async () => { if (await confirm({ title: 'Delete this entry?', danger: true, confirmLabel: 'Delete' })) remove.mutate(r.id) }} aria-label={`Delete ${r.title}`}><Trash2 className="h-4 w-4 text-muted" /></button>
            </li>
          ))}
        </ul>
      ) : <EmptyState compact title="No leave planned" description="Plan leave and holidays – they show on your calendar." />}
      <Modal open={form.open} onClose={() => setForm({ open: false })} title={form.row ? 'Edit time off' : 'Plan time off'} size="sm"
        footer={<><Button variant="ghost" onClick={() => setForm({ open: false })}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
        <div className="grid gap-3">
          <Field label="Title" htmlFor="to-t"><Input id="to-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Diwali break" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type" htmlFor="to-k"><Select id="to-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="leave">Leave</option><option value="holiday">Holiday</option><option value="sick">Sick</option><option value="other">Other</option></Select></Field>
            <Field label="Status" htmlFor="to-s"><Select id="to-s" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="planned">Planned</option><option value="approved">Approved</option><option value="taken">Taken</option><option value="cancelled">Cancelled</option></Select></Field>
            <Field label="From" htmlFor="to-f"><Input id="to-f" type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></Field>
            <Field label="To" htmlFor="to-e"><Input id="to-e" type="date" value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
