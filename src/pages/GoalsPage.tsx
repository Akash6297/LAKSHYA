import { useEffect, useMemo, useState } from 'react'
import { Flame, Minus, Pencil, Plus, Target, Trash2, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge, Card, PageHeader, ProgressBar, Segmented } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { ColorPicker } from '@/components/ui/pickers'
import { EmptyState, ListSkeleton } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/Modal'
import { GOAL_TYPES } from '@/lib/constants'
import { addDaysKey, daysUntil, dowOfKey, fmt, todayKey } from '@/lib/dates'
import { habitStreak } from '@/lib/planning'
import { cn, pct } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useCrud, useRows } from '@/services/resource'
import type { Goal, GoalMilestone, GoalStatus, GoalType, Habit, HabitLog } from '@/types/db'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function GoalsPage() {
  const [tab, setTab] = useState<'goals' | 'habits'>('goals')
  const [goalModal, setGoalModal] = useState<{ open: boolean; row?: Goal }>({ open: false })
  const [habitModal, setHabitModal] = useState<{ open: boolean; row?: Habit }>({ open: false })
  return (
    <div>
      <PageHeader title="Goals & Habits" subtitle="Long-term direction, daily consistency."
        actions={tab === 'goals' ? <Button onClick={() => setGoalModal({ open: true })} icon={<Plus className="h-4 w-4" />}>New goal</Button> : <Button onClick={() => setHabitModal({ open: true })} icon={<Plus className="h-4 w-4" />}>New habit</Button>} />
      <Segmented className="mb-4" value={tab} onChange={setTab} options={[{ value: 'goals', label: 'Goals', icon: <Target className="h-4 w-4" /> }, { value: 'habits', label: 'Habits', icon: <Flame className="h-4 w-4" /> }]} />
      {tab === 'goals' ? <Goals onEdit={(g) => setGoalModal({ open: true, row: g })} onNew={() => setGoalModal({ open: true })} /> : <Habits onEdit={(h) => setHabitModal({ open: true, row: h })} onNew={() => setHabitModal({ open: true })} />}
      <GoalModal state={goalModal} onClose={() => setGoalModal({ open: false })} />
      <HabitModal state={habitModal} onClose={() => setHabitModal({ open: false })} />
    </div>
  )
}

function goalProgress(g: Goal, ms: GoalMilestone[]): number {
  if (g.status === 'completed') return 100
  if (g.target_value) return Math.min(100, pct(Number(g.current_value), Number(g.target_value)))
  return pct(ms.filter((m) => m.is_done).length, ms.length)
}

function Goals({ onEdit, onNew }: { onEdit: (g: Goal) => void; onNew: () => void }) {
  const { tz } = useAppData()
  const [status, setStatus] = useState<GoalStatus | 'all'>('active')
  const goals = useRows('goals', ['list', status], (q) => (status === 'all' ? q : q.eq('status', status)).order('target_date', { nullsFirst: false }))
  const milestones = useRows('goal_milestones', ['all'], (q) => q.order('sort_order').order('created_at'))
  const { update } = useCrud('goals')
  const ms = (milestones.data ?? []) as GoalMilestone[]
  const rows = (goals.data ?? []) as Goal[]
  return (
    <>
      <Segmented size="sm" className="mb-4" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'paused', label: 'Paused' }, { value: 'all', label: 'All' }]} />
      {goals.isLoading ? <ListSkeleton /> : rows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((g) => {
            const gm = ms.filter((m) => m.goal_id === g.id)
            const p = goalProgress(g, gm)
            const d = g.target_date ? daysUntil(g.target_date, tz) : null
            return (
              <div key={g.id} className="card p-5">
                <div className="mb-2 flex items-center gap-2"><Badge color="#6366F1">{g.goal_type}</Badge>{g.status !== 'active' && <Badge>{g.status}</Badge>}
                  <button className="ml-auto text-muted hover:text-fg" onClick={() => onEdit(g)} aria-label={`Edit ${g.title}`}><Pencil className="h-4 w-4" /></button></div>
                <h3 className="font-bold">{g.title}</h3>
                {g.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{g.description}</p>}
                <div className="mt-4 mb-1.5 flex justify-between text-xs"><span className="text-muted">{g.target_value ? `${Number(g.current_value)} / ${Number(g.target_value)} ${g.unit ?? ''}` : `${gm.filter((m) => m.is_done).length}/${gm.length} milestones`}</span><span className="font-bold">{p}%</span></div>
                <ProgressBar value={p} color={p >= 100 ? 'var(--success)' : 'var(--primary)'} label={`${g.title} progress`} />
                {d !== null && g.status === 'active' && <div className={cn('mt-2 text-xs font-semibold', d < 0 ? 'text-danger' : 'text-muted')}>{d < 0 ? `${-d} days past target` : `${d} days left`} · {fmt(g.target_date + 'T12:00:00Z', 'UTC', 'd MMM yyyy')}</div>}
                {g.target_value && g.status === 'active' && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" icon={<Minus className="h-3.5 w-3.5" />} onClick={() => update.mutate({ id: g.id, current_value: Math.max(0, Number(g.current_value) - 1) })} aria-label="Decrease">1</Button>
                    <Button size="sm" variant="soft" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => {
                      const v = Number(g.current_value) + 1
                      update.mutate({ id: g.id, current_value: v, ...(v >= Number(g.target_value) ? { status: 'completed' as const } : {}) }, { onSuccess: () => v >= Number(g.target_value) && toast.success('Goal achieved! 🎯') })
                    }}>1</Button>
                  </div>
                )}
                {gm.length > 0 && !g.target_value && <MilestoneChecks items={gm} />}
              </div>
            )
          })}
        </div>
      ) : <EmptyState art="target" title="No goals here" description="Set a goal with a target value or break it into milestones." action={<Button onClick={onNew}>Create a goal</Button>} />}
    </>
  )
}

function MilestoneChecks({ items }: { items: GoalMilestone[] }) {
  const { update } = useCrud('goal_milestones')
  return (
    <ul className="mt-3 space-y-1">
      {items.map((m) => (
        <li key={m.id} className="flex items-center gap-2 text-sm">
          <Checkbox size="sm" checked={m.is_done} onChange={(v) => update.mutate({ id: m.id, is_done: v })} label={m.title} />
          <span className={cn(m.is_done && 'text-muted line-through')}>{m.title}</span>
        </li>
      ))}
    </ul>
  )
}

function GoalModal({ state, onClose }: { state: { open: boolean; row?: Goal }; onClose: () => void }) {
  const { tz } = useAppData()
  const confirm = useConfirm()
  const { create, update, remove } = useCrud('goals')
  const msCrud = useCrud('goal_milestones')
  const existing = useRows('goal_milestones', [state.row?.id], (q) => q.eq('goal_id', state.row!.id).order('sort_order'), { enabled: !!state.row })
  const [v, setV] = useState({ title: '', description: '', goal_type: 'monthly', status: 'active', start_date: '', target_date: '', target_value: '', current_value: '0', unit: '', notes: '' })
  const [draftMs, setDraftMs] = useState('')
  useEffect(() => {
    if (!state.open) return
    const g = state.row
    setV({ title: g?.title ?? '', description: g?.description ?? '', goal_type: g?.goal_type ?? 'monthly', status: g?.status ?? 'active', start_date: g?.start_date ?? todayKey(tz),
      target_date: g?.target_date ?? '', target_value: g?.target_value?.toString() ?? '', current_value: g?.current_value?.toString() ?? '0', unit: g?.unit ?? '', notes: g?.notes ?? '' })
  }, [state, tz])
  const save = async () => {
    if (!v.title.trim()) return toast.error('Title is required')
    if (v.target_date && v.target_date < v.start_date) return toast.error('Target date must be after start')
    const payload = { title: v.title.trim(), description: v.description.trim() || null, goal_type: v.goal_type as GoalType, status: v.status as GoalStatus, start_date: v.start_date,
      target_date: v.target_date || null, target_value: v.target_value ? Number(v.target_value) : null, current_value: Number(v.current_value) || 0, unit: v.unit.trim() || null, notes: v.notes.trim() || null }
    if (state.row) await update.mutateAsync({ id: state.row.id, ...payload })
    else await create.mutateAsync(payload)
    onClose()
  }
  const ms = (existing.data ?? []) as GoalMilestone[]
  return (
    <Modal open={state.open} onClose={onClose} title={state.row ? 'Edit goal' : 'New goal'} size="lg"
      footer={<>{state.row && <Button variant="ghost" size="icon-sm" className="mr-auto" aria-label="Delete goal" onClick={async () => { if (await confirm({ title: 'Delete goal?', danger: true, confirmLabel: 'Delete' })) { remove.mutate(state.row!.id); onClose() } }}><Trash2 className="h-4 w-4 text-danger" /></Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Goal" className="sm:col-span-2" htmlFor="g-t"><Input id="g-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} autoFocus placeholder="Read 12 books" /></Field>
        <Field label="Type" htmlFor="g-ty"><Select id="g-ty" value={v.goal_type} onChange={(e) => setV({ ...v, goal_type: e.target.value })}>{GOAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
        <Field label="Status" htmlFor="g-s"><Select id="g-s" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="active">Active</option><option value="completed">Completed</option><option value="paused">Paused</option><option value="abandoned">Abandoned</option></Select></Field>
        <Field label="Start" htmlFor="g-sd"><Input id="g-sd" type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></Field>
        <Field label="Target date" htmlFor="g-td"><Input id="g-td" type="date" value={v.target_date} onChange={(e) => setV({ ...v, target_date: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          <Field label="Current" htmlFor="g-cv"><Input id="g-cv" type="number" min={0} value={v.current_value} onChange={(e) => setV({ ...v, current_value: e.target.value })} /></Field>
          <Field label="Target value" hint="Optional" htmlFor="g-tv"><Input id="g-tv" type="number" min={0} value={v.target_value} onChange={(e) => setV({ ...v, target_value: e.target.value })} /></Field>
          <Field label="Unit" htmlFor="g-u"><Input id="g-u" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} placeholder="books" /></Field>
        </div>
        <Field label="Description" className="sm:col-span-2" htmlFor="g-d"><Textarea id="g-d" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        {state.row && (
          <Field label="Milestones" className="sm:col-span-2">
            <ul className="mb-2 space-y-1">{ms.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm"><Checkbox size="sm" checked={m.is_done} onChange={(c) => msCrud.update.mutate({ id: m.id, is_done: c })} label={m.title} /><span className="flex-1">{m.title}</span><button onClick={() => msCrud.remove.mutate(m.id)} aria-label={`Remove ${m.title}`}><X className="h-4 w-4 text-muted" /></button></li>
            ))}</ul>
            <div className="flex gap-2"><Input value={draftMs} onChange={(e) => setDraftMs(e.target.value)} placeholder="Add milestone" aria-label="New milestone" />
              <Button variant="soft" onClick={() => { if (draftMs.trim()) { msCrud.create.mutate({ goal_id: state.row!.id, title: draftMs.trim(), sort_order: ms.length }); setDraftMs('') } }}>Add</Button></div>
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2" htmlFor="g-n"><Textarea id="g-n" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function Habits({ onEdit, onNew }: { onEdit: (h: Habit) => void; onNew: () => void }) {
  const { tz } = useAppData()
  const today = todayKey(tz)
  const habits = useRows('habits', ['active'], (q) => q.eq('archived', false).order('created_at'))
  const since = addDaysKey(today, -400)
  const logs = useRows('habit_logs', ['since', since], (q) => q.gte('log_date', since).limit(20000))
  const { create, remove } = useCrud('habit_logs')
  const byHabit = useMemo(() => {
    const m = new Map<string, Map<string, string>>()
    for (const l of (logs.data ?? []) as HabitLog[]) { if (!m.has(l.habit_id)) m.set(l.habit_id, new Map()); m.get(l.habit_id)!.set(l.log_date, l.id) }
    return m
  }, [logs.data])
  const week = Array.from({ length: 7 }, (_, i) => addDaysKey(today, i - 6))
  const rows = (habits.data ?? []) as Habit[]
  const toggle = (h: Habit, day: string) => {
    const id = byHabit.get(h.id)?.get(day)
    if (id) remove.mutate(id)
    else create.mutate({ habit_id: h.id, log_date: day })
  }
  if (habits.isLoading) return <ListSkeleton />
  if (!rows.length) return <EmptyState art="sparkle" title="No habits yet" description="Small daily actions compound. Track a habit and build a streak." action={<Button onClick={onNew}>Create a habit</Button>} />
  return (
    <div className="space-y-4">
      {rows.map((h) => {
        const done = new Set(byHabit.get(h.id)?.keys() ?? [])
        const { current, longest } = habitStreak(done, h.days_of_week, today)
        const scheduledThisWeek = week.filter((d) => h.days_of_week.includes(dowOfKey(d)))
        const doneThisWeek = scheduledThisWeek.filter((d) => done.has(d)).length
        return (
          <Card key={h.id}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: h.color }} /><h3 className="font-bold">{h.title}</h3>
                  <button onClick={() => onEdit(h)} className="text-muted hover:text-fg" aria-label={`Edit ${h.title}`}><Pencil className="h-3.5 w-3.5" /></button></div>
                <div className="mt-1 flex gap-4 text-xs text-muted">
                  <span className="inline-flex items-center gap-1 font-semibold text-warning"><Flame className="h-3.5 w-3.5" />{current} day streak</span>
                  <span className="inline-flex items-center gap-1"><Trophy className="h-3.5 w-3.5" />Best {longest}</span>
                  <span>{doneThisWeek}/{scheduledThisWeek.length} this week</span>
                </div>
              </div>
              <div className="flex gap-1.5">
                {week.map((d) => {
                  const scheduled = h.days_of_week.includes(dowOfKey(d))
                  const on = done.has(d)
                  return (
                    <button key={d} onClick={() => toggle(h, d)} disabled={d > today} aria-pressed={on} aria-label={`${h.title} on ${d}`}
                      className={cn('grid h-10 w-9 place-items-center rounded-xl border text-[10px] font-bold transition', on ? 'border-transparent text-white' : scheduled ? 'border-line hover:border-primary' : 'border-dashed border-line opacity-50', d === today && !on && 'ring-2 ring-ring')}
                      style={on ? { background: h.color } : undefined}>
                      <span>{DOW[dowOfKey(d)]}</span><span className="text-[11px]">{Number(d.slice(8))}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <Heatmap done={done} today={today} color={h.color} />
          </Card>
        )
      })}
    </div>
  )
}

function Heatmap({ done, today, color }: { done: Set<string>; today: string; color: string }) {
  const weeks = 20
  const end = addDaysKey(today, 6 - dowOfKey(today))
  const start = addDaysKey(end, -(weeks * 7 - 1))
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label={`Completion over the last ${weeks} weeks: ${[...done].filter((d) => d >= start).length} days`}>
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const k = addDaysKey(start, i)
          return <span key={k} title={`${fmt(k + 'T12:00:00Z', 'UTC', 'EEE d MMM')}${done.has(k) ? ' · done' : ''}`} className="h-3 w-3 rounded-[3px]"
            style={{ background: k > today ? 'transparent' : done.has(k) ? color : 'var(--surface-3)' }} />
        })}
      </div>
    </div>
  )
}

function HabitModal({ state, onClose }: { state: { open: boolean; row?: Habit }; onClose: () => void }) {
  const confirm = useConfirm()
  const { create, update } = useCrud('habits')
  const [v, setV] = useState({ title: '', description: '', frequency: 'daily', days: [0, 1, 2, 3, 4, 5, 6], color: '#10B981' })
  useEffect(() => {
    if (state.open) setV({ title: state.row?.title ?? '', description: state.row?.description ?? '', frequency: state.row?.frequency ?? 'daily', days: state.row?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6], color: state.row?.color ?? '#10B981' })
  }, [state])
  const save = async () => {
    if (!v.title.trim()) return toast.error('Title is required')
    if (!v.days.length) return toast.error('Pick at least one day')
    const payload = { title: v.title.trim(), description: v.description.trim() || null, frequency: v.frequency as Habit['frequency'], days_of_week: v.days, target_per_week: v.days.length, color: v.color }
    if (state.row) await update.mutateAsync({ id: state.row.id, ...payload })
    else await create.mutateAsync(payload)
    onClose()
  }
  const setFreq = (f: string) => setV({ ...v, frequency: f, days: f === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : f === 'weekly' ? [1] : v.days })
  return (
    <Modal open={state.open} onClose={onClose} title={state.row ? 'Edit habit' : 'New habit'} size="sm"
      footer={<>{state.row && <Button variant="ghost" className="mr-auto" onClick={async () => { if (await confirm({ title: 'Archive habit?', message: 'Your history is kept.', confirmLabel: 'Archive' })) { await update.mutateAsync({ id: state.row!.id, archived: true }); onClose() } }}>Archive</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Habit" htmlFor="h-t"><Input id="h-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} autoFocus placeholder="Meditate 10 minutes" /></Field>
        <Field label="Schedule" htmlFor="h-f"><Select id="h-f" value={v.frequency} onChange={(e) => setFreq(e.target.value)}><option value="daily">Every day</option><option value="weekly">Once a week</option><option value="custom">Custom days</option></Select></Field>
        <div className="flex gap-1.5">
          {DOW.map((d, i) => (
            <button key={i} type="button" aria-pressed={v.days.includes(i)} onClick={() => setV({ ...v, frequency: 'custom', days: v.days.includes(i) ? v.days.filter((x) => x !== i) : [...v.days, i].sort() })}
              className={cn('h-9 w-9 rounded-full border text-xs font-bold', v.days.includes(i) ? 'border-transparent bg-primary text-primary-fg' : 'border-line text-muted')}>{d}</button>
          ))}
        </div>
        <Field label="Color"><ColorPicker value={v.color} onChange={(c) => setV({ ...v, color: c })} /></Field>
        <Field label="Description" htmlFor="h-d"><Textarea id="h-d" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
