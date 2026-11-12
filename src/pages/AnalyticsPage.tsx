import { useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, BriefcaseBusiness, CheckCircle2, FolderCheck, Info, ListTodo, Target, Timer, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, PageHeader, Segmented, Stat } from '@/components/ui/display'
import { Input } from '@/components/ui/form'
import { ChartCard, ChartTooltip, Legend, SERIES, axisProps, gridProps } from '@/components/charts'
import { addDaysKey, dowOfKey, fmt, localDateKey, todayKey, zonedDayBounds } from '@/lib/dates'
import { isOverdue } from '@/lib/planning'
import { minutesToHuman, pct } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useRows } from '@/services/resource'
import { useTasks } from '@/services/tasks'
import type { ActivityLog, FocusSession, Goal, Meeting, Project, StudySession, TimeOff } from '@/types/db'

type Preset = '7' | '30' | '90' | 'month' | 'custom'
const mins = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000))
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }

export default function AnalyticsPage() {
  const { tz, settings, categoryById } = useAppData()
  const today = todayKey(tz)
  const [preset, setPreset] = useState<Preset>('30')
  const [custom, setCustom] = useState({ from: addDaysKey(today, -29), to: today })
  const range = useMemo(() => {
    if (preset === 'custom') return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }
    if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today }
    return { from: addDaysKey(today, -(Number(preset) - 1)), to: today }
  }, [preset, custom, today])
  const F = zonedDayBounds(range.from, tz)[0].toISOString()
  const T = zonedDayBounds(range.to, tz)[1].toISOString()
  const dayKeys = useMemo(() => {
    const out: string[] = []
    for (let k = range.from; k <= range.to && out.length < 400; k = addDaysKey(k, 1)) out.push(k)
    return out
  }, [range])

  const completed = useTasks(['analytics-done', F, T], (q) => q.gte('completed_at', F).lt('completed_at', T).limit(5000))
  const created = useTasks(['analytics-created', F, T], (q) => q.gte('created_at', F).lt('created_at', T).limit(5000))
  const open = useTasks(['open'], (q) => q.not('status', 'in', '(completed,cancelled)').limit(5000))
  const projects = useRows('projects', ['analytics'], (q) => q.limit(500))
  const study = useRows('study_sessions', ['analytics', F, T], (q) => q.eq('completed', true).gte('start_at', F).lt('start_at', T).limit(5000))
  const meetings = useRows('meetings', ['analytics', F, T], (q) => q.gte('start_at', F).lt('start_at', T).limit(5000))
  const focus = useRows('focus_sessions', ['analytics', F, T], (q) => q.eq('kind', 'focus').gte('started_at', F).lt('started_at', T).limit(5000))
  const goals = useRows('goals', ['analytics'], (q) => q.limit(500))
  const activity = useRows('activity_logs', ['analytics', F, T], (q) => q.gte('created_at', F).lt('created_at', T).limit(10000), { select: 'created_at' })
  const leave = useRows('time_off', ['analytics', range.from, range.to], (q) => q.lte('start_date', range.to).gte('end_date', range.from).neq('status', 'cancelled'))

  const done = completed.data ?? []
  const nowOpen = open.data ?? []
  const dueInRangeOpen = nowOpen.filter((t) => t.due_date && t.due_date >= range.from && t.due_date <= range.to)
  const dueInRangeDone = done.filter((t) => t.due_date && t.due_date >= range.from && t.due_date <= range.to)
  const completionRate = pct(dueInRangeDone.length, dueInRangeDone.length + dueInRangeOpen.length)
  const onTime = done.filter((t) => t.due_at && t.completed_at && t.completed_at <= t.due_at).length
  const withDue = done.filter((t) => t.due_at).length
  const projs = (projects.data ?? []) as Project[]
  const projDone = projs.filter((p) => p.completed_at && p.completed_at >= F && p.completed_at < T).length
  const activeProjs = projs.filter((p) => p.status === 'active' || p.status === 'planning')
  const studyMin = ((study.data ?? []) as StudySession[]).reduce((a, s) => a + (s.actual_minutes ?? mins(s.start_at, s.end_at)), 0)
  const mts = (meetings.data ?? []) as Meeting[]
  const meetingMin = mts.reduce((a, m) => a + mins(m.start_at, m.end_at), 0)
  const focusMin = ((focus.data ?? []) as FocusSession[]).reduce((a, f) => a + f.actual_minutes, 0)
  const gl = (goals.data ?? []) as Goal[]
  const goalsDone = gl.filter((g) => g.completed_at && g.completed_at >= F && g.completed_at < T).length
  const leaveDays = new Set<string>()
  for (const l of (leave.data ?? []) as TimeOff[]) for (let k = l.start_date; k <= l.end_date; k = addDaysKey(k, 1)) leaveDays.add(k)
  const workMin = dayKeys.reduce((a, k) => {
    const d = settings.working_hours?.[String(dowOfKey(k))]
    return a + (d?.enabled && !leaveDays.has(k) ? Math.max(0, hm(d.end) - hm(d.start)) : 0)
  }, 0)

  // ---- series ----
  const byDay = (rows: { at: string | null }[]) => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.at) { const k = localDateKey(new Date(r.at), tz); m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }
  const doneByDay = byDay(done.map((t) => ({ at: t.completed_at })))
  const createdByDay = byDay((created.data ?? []).map((t) => ({ at: t.created_at })))
  const daily = dayKeys.map((k) => ({ day: fmt(k + 'T12:00:00Z', 'UTC', 'd MMM'), Completed: doneByDay.get(k) ?? 0, Created: createdByDay.get(k) ?? 0 }))

  const weekly = useMemo(() => {
    const m = new Map<string, { Completed: number; 'Focus h': number }>()
    const wk = (k: string) => addDaysKey(k, -((dowOfKey(k) - settings.week_starts_on + 7) % 7))
    for (const k of dayKeys) m.set(wk(k), { Completed: 0, 'Focus h': 0 })
    for (const t of done) { const k = wk(localDateKey(new Date(t.completed_at!), tz)); const v = m.get(k); if (v) v.Completed++ }
    return [...m.entries()].map(([k, v]) => ({ week: `Wk of ${fmt(k + 'T12:00:00Z', 'UTC', 'd MMM')}`, ...v }))
  }, [dayKeys, done, settings.week_starts_on, tz])

  const monthly = useMemo(() => {
    const m = new Map<string, { Completed: number; Created: number }>()
    for (const k of dayKeys) m.set(k.slice(0, 7), { Completed: 0, Created: 0 })
    for (const t of done) { const v = m.get(localDateKey(new Date(t.completed_at!), tz).slice(0, 7)); if (v) v.Completed++ }
    for (const t of created.data ?? []) { const v = m.get(localDateKey(new Date(t.created_at), tz).slice(0, 7)); if (v) v.Created++ }
    return [...m.entries()].map(([k, v]) => ({ month: fmt(k + '-15T12:00:00Z', 'UTC', 'MMM yyyy'), ...v }))
  }, [dayKeys, done, created.data, tz])

  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of done) { const name = (t.category_id && categoryById.get(t.category_id)?.name) || 'Uncategorised'; m.set(name, (m.get(name) ?? 0) + 1) }
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1])
    // fixed palette order; beyond 7 categories fold into "Other" (never generate a hue)
    const top = sorted.slice(0, 7)
    const rest = sorted.slice(7).reduce((a, [, v]) => a + v, 0)
    return [...top, ...(rest ? [['Other', rest] as [string, number]] : [])].map(([name, Tasks], i) => ({ name, Tasks, color: SERIES[i] }))
  }, [done, categoryById])

  const studyDaily = dayKeys.map((k) => ({
    day: fmt(k + 'T12:00:00Z', 'UTC', 'd MMM'),
    Minutes: ((study.data ?? []) as StudySession[]).filter((s) => localDateKey(new Date(s.start_at), tz) === k).reduce((a, s) => a + (s.actual_minutes ?? mins(s.start_at, s.end_at)), 0),
  }))

  const heat = byDay(((activity.data ?? []) as Pick<ActivityLog, 'created_at'>[]).map((a) => ({ at: a.created_at })))
  const maxHeat = Math.max(1, ...heat.values())

  const showDaily = dayKeys.length <= 45
  return (
    <div>
      <PageHeader title="Analytics" subtitle={`${fmt(range.from + 'T12:00:00Z', 'UTC', 'd MMM yyyy')} – ${fmt(range.to + 'T12:00:00Z', 'UTC', 'd MMM yyyy')}`} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={preset} onChange={setPreset} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'month', label: 'This month' }, { value: 'custom', label: 'Custom' }]} />
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" className="h-9 w-40 py-1" value={custom.from} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="From date" />
            <span className="text-muted">–</span>
            <Input type="date" className="h-9 w-40 py-1" value={custom.to} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="To date" />
          </div>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tasks completed" value={done.length} icon={<CheckCircle2 className="h-5 w-5" />} tone="success" />
        <Stat label="Pending now" value={nowOpen.length} icon={<ListTodo className="h-5 w-5" />} />
        <Stat label="Overdue now" value={nowOpen.filter((t) => isOverdue(t)).length} icon={<AlertTriangle className="h-5 w-5" />} tone="danger" />
        <Stat label="Projects completed" value={projDone} hint={`${activeProjs.length} active`} icon={<FolderCheck className="h-5 w-5" />} />
        <Stat label="Working hours (scheduled)" value={minutesToHuman(workMin)} hint={`${leaveDays.size} leave days excluded`} icon={<BriefcaseBusiness className="h-5 w-5" />} />
        <Stat label="Study time" value={minutesToHuman(studyMin)} icon={<BookOpen className="h-5 w-5" />} tone="warning" />
        <Stat label="Meetings" value={mts.length} hint={`${minutesToHuman(meetingMin)} · ${mts.filter((m) => m.attended).length} marked attended`} icon={<Users className="h-5 w-5" />} />
        <Stat label="Goals completed" value={goalsDone} hint={`Focus ${minutesToHuman(focusMin)}`} icon={<Target className="h-5 w-5" />} />
      </div>

      <Card className="mb-5" title="How these numbers are calculated" icon={<Info className="h-4 w-4" />}>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-2xl font-extrabold">{completionRate}% <span className="text-sm font-semibold text-muted">deadline completion</span></div>
            <p className="text-xs text-muted">Tasks due in this period that are completed ({dueInRangeDone.length}) ÷ all tasks due in this period that are completed or still open ({dueInRangeDone.length + dueInRangeOpen.length}). Cancelled tasks are excluded. Tasks without a due date are not counted.</p>
          </div>
          <div>
            <div className="text-2xl font-extrabold">{pct(onTime, withDue)}% <span className="text-sm font-semibold text-muted">on time</span></div>
            <p className="text-xs text-muted">Of the {withDue} tasks completed in this period that had a deadline, {onTime} were completed before it. LAKSHYA does not compute a single “productivity score” – it would hide more than it shows.</p>
          </div>
          <p className="text-xs text-muted sm:col-span-2">Working hours = your configured working hours for each working day in the range, minus planned leave. It reflects your schedule, not tracked time. Study time = completed study sessions (actual minutes if entered, else planned duration).</p>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {showDaily ? (
          <ChartCard title="Daily task completion" subtitle="Tasks completed vs created per day" rows={daily} columns={[{ key: 'day', label: 'Day' }, { key: 'Completed', label: 'Completed' }, { key: 'Created', label: 'Created' }]} empty={!done.length && !(created.data ?? []).length}>
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={daily} margin={{ top: 8, right: 4, left: -24, bottom: 0 }} barGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="day" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="Completed" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="Created" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{ label: 'Completed', color: SERIES[0] }, { label: 'Created', color: SERIES[1] }]} />
          </ChartCard>
        ) : (
          <ChartCard title="Monthly trend" subtitle="Tasks completed vs created per month" rows={monthly} columns={[{ key: 'month', label: 'Month' }, { key: 'Completed', label: 'Completed' }, { key: 'Created', label: 'Created' }]} empty={!done.length}>
            <div className="h-60">
              <ResponsiveContainer>
                <LineChart data={monthly} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--line-strong)' }} />
                  <Line dataKey="Completed" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} />
                  <Line dataKey="Created" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{ label: 'Completed', color: SERIES[0] }, { label: 'Created', color: SERIES[1] }]} />
          </ChartCard>
        )}

        <ChartCard title="Weekly productivity" subtitle="Tasks completed per week" rows={weekly.map(({ week, Completed }) => ({ week, Completed }))} columns={[{ key: 'week', label: 'Week' }, { key: 'Completed', label: 'Completed' }]} empty={!done.length}>
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={weekly} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="week" {...axisProps} minTickGap={12} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="Completed" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Category distribution" subtitle="Completed tasks by category" rows={byCategory.map(({ name, Tasks }) => ({ name, Tasks }))} columns={[{ key: 'name', label: 'Category' }, { key: 'Tasks', label: 'Tasks' }]} empty={!byCategory.length}>
          <ul className="space-y-2.5">
            {byCategory.map((c) => (
              <li key={c.name} className="group">
                <div className="mb-1 flex justify-between text-xs"><span className="flex items-center gap-1.5 font-semibold"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />{c.name}</span><span className="text-muted tabular-nums">{c.Tasks} · {pct(c.Tasks, done.length)}%</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${pct(c.Tasks, byCategory[0].Tasks)}%`, background: c.color }} /></div>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard title="Project progress" subtitle="Active and planning projects" rows={activeProjs.map((p) => ({ project: p.title, progress: `${p.progress}%` }))} columns={[{ key: 'project', label: 'Project' }, { key: 'progress', label: 'Progress' }]} empty={!activeProjs.length}>
          <ul className="space-y-2.5">
            {activeProjs.slice(0, 10).map((p) => (
              <li key={p.id}>
                <div className="mb-1 flex justify-between text-xs"><span className="truncate font-semibold">{p.title}</span><span className="text-muted tabular-nums">{p.progress}%</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full" style={{ width: `${p.progress}%`, background: SERIES[0] }} /></div>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard title="Study time" subtitle="Completed study minutes per day" rows={studyDaily} columns={[{ key: 'day', label: 'Day' }, { key: 'Minutes', label: 'Minutes' }]} empty={!studyMin}>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={studyDaily} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" {...axisProps} minTickGap={16} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip content={<ChartTooltip format={(v) => minutesToHuman(v)} />} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="Minutes" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Activity heatmap" subtitle="Changes you made per day (create, edit, complete)" rows={dayKeys.map((k) => ({ day: k, Actions: heat.get(k) ?? 0 }))} columns={[{ key: 'day', label: 'Day' }, { key: 'Actions', label: 'Actions' }]} empty={!heat.size}>
          <div className="overflow-x-auto">
            <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
              {Array.from({ length: (dowOfKey(range.from) - settings.week_starts_on + 7) % 7 }).map((_, i) => <span key={`pad${i}`} className="h-4 w-4" />)}
              {dayKeys.map((k) => {
                const v = heat.get(k) ?? 0
                const step = v === 0 ? 0 : Math.min(6, Math.ceil((v / maxHeat) * 6))
                return <span key={k} className="h-4 w-4 rounded-[4px]" title={`${fmt(k + 'T12:00:00Z', 'UTC', 'EEE d MMM')}: ${v} actions`} style={{ background: step ? `var(--seq-${step})` : 'var(--surface-3)' }} />
              })}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-[11px] text-muted">Less{[0, 1, 2, 3, 4, 5, 6].map((s) => <span key={s} className="h-3 w-3 rounded-[3px]" style={{ background: s ? `var(--seq-${s})` : 'var(--surface-3)' }} />)}More</div>
        </ChartCard>
      </div>
      <p className="mt-4 flex items-center gap-1 text-xs text-subtle"><Timer className="h-3 w-3" /> All times shown in {tz}.</p>
    </div>
  )
}
