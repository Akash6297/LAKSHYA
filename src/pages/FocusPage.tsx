import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Coffee, Maximize2, Pause, Play, RotateCcw, SkipForward, Target, Timer } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader, ProgressBar, Segmented } from '@/components/ui/display'
import { Select } from '@/components/ui/form'
import { EmptyState } from '@/components/ui/feedback'
import { ChartCard, ChartTooltip, axisProps, gridProps } from '@/components/charts'
import { useOpenTasks } from '@/features/tasks/hooks'
import { addDaysKey, fmt, fmtTime, localDateKey, todayKey, zonedDayBounds } from '@/lib/dates'
import { cn, minutesToHuman, pct } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useFocus, type FocusMode } from '@/providers/FocusProvider'
import { useRows } from '@/services/resource'
import type { FocusSession } from '@/types/db'

export default function FocusPage() {
  const { tz, h24, settings } = useAppData()
  const f = useFocus()
  const [params, setParams] = useSearchParams()
  const open = useOpenTasks()
  const panel = useRef<HTMLDivElement>(null)
  const today = todayKey(tz)
  const since = useMemo(() => zonedDayBounds(addDaysKey(today, -6), tz)[0].toISOString(), [today, tz])
  const history = useRows('focus_sessions', ['since', since], (q) => q.gte('started_at', since).order('started_at', { ascending: false }).limit(500))
  const sessions = (history.data ?? []) as FocusSession[]
  const taskById = new Map((open.data ?? []).map((t) => [t.id, t]))

  useEffect(() => {
    const t = params.get('task')
    if (t && !f.running) { f.setTask(t); setParams({}, { replace: true }) }
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const mm = String(Math.floor(f.remainingMs / 60_000)).padStart(2, '0')
    const ss = String(Math.floor((f.remainingMs % 60_000) / 1000)).padStart(2, '0')
    document.title = f.running ? `${mm}:${ss} · ${f.mode === 'focus' ? 'Focus' : 'Break'} · LAKSHYA` : 'LAKSHYA · लक्ष्य'
    return () => { document.title = 'LAKSHYA · लक्ष्य' }
  }, [f.remainingMs, f.running, f.mode])

  const total = f.durationMin * 60_000
  const progress = total ? 100 - (f.remainingMs / total) * 100 : 0
  const mm = String(Math.floor(f.remainingMs / 60_000)).padStart(2, '0')
  const ss = String(Math.floor((f.remainingMs % 60_000) / 1000)).padStart(2, '0')
  const focusSessions = sessions.filter((s) => s.kind === 'focus')
  const todayMin = focusSessions.filter((s) => localDateKey(new Date(s.started_at), tz) === today).reduce((a, s) => a + s.actual_minutes, 0)
  const days = Array.from({ length: 7 }, (_, i) => {
    const k = addDaysKey(today, i - 6)
    return { day: fmt(k + 'T12:00:00Z', 'UTC', 'EEE'), Minutes: focusSessions.filter((s) => localDateKey(new Date(s.started_at), tz) === k).reduce((a, s) => a + s.actual_minutes, 0) }
  })
  const R = 120, C = 2 * Math.PI * R
  const color = f.mode === 'focus' ? 'var(--primary)' : 'var(--success)'

  return (
    <div>
      <PageHeader title="Focus" subtitle="One task. Full attention." />
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div ref={panel} className="card flex flex-col items-center gap-6 p-6 sm:p-10 [&:fullscreen]:justify-center [&:fullscreen]:rounded-none [&:fullscreen]:bg-bg">
          <Segmented value={f.mode} onChange={(m: FocusMode) => f.setMode(m)} options={[
            { value: 'focus', label: 'Focus', icon: <Target className="h-4 w-4" /> },
            { value: 'short_break', label: 'Short break', icon: <Coffee className="h-4 w-4" /> },
            { value: 'long_break', label: 'Long break' },
          ]} />
          <div className="relative grid place-items-center" style={{ width: 280, height: 280 }} role="timer" aria-live="off" aria-label={`${mm} minutes ${ss} seconds remaining`}>
            <svg width="280" height="280" className="-rotate-90">
              <circle cx="140" cy="140" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
              <circle cx="140" cy="140" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C - (progress / 100) * C} style={{ transition: 'stroke-dashoffset .3s linear' }} />
            </svg>
            <div className="absolute text-center">
              <div className="text-6xl font-extrabold tracking-tight tabular-nums">{mm}:{ss}</div>
              <div className="mt-1 text-sm font-semibold text-muted">{f.mode === 'focus' ? `Session ${f.completedFocus + 1}` : 'Recharge'}</div>
            </div>
          </div>
          <div className="w-full max-w-sm">
            <Select value={f.taskId ?? ''} onChange={(e) => f.setTask(e.target.value || null)} disabled={f.running} aria-label="Task to focus on">
              <option value="">No specific task</option>
              {(open.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={f.reset} aria-label="Reset"><RotateCcw className="h-5 w-5" /></Button>
            {f.running
              ? <Button size="lg" className="w-36" onClick={f.pause} icon={<Pause className="h-5 w-5" />}>Pause</Button>
              : <Button size="lg" className="w-36" onClick={() => f.start()} icon={<Play className="h-5 w-5" />}>{f.startedAt ? 'Resume' : 'Start'}</Button>}
            <Button variant="outline" size="icon" onClick={f.skip} aria-label="Skip to next"><SkipForward className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" onClick={() => document.fullscreenElement ? void document.exitFullscreen() : void panel.current?.requestFullscreen?.()} aria-label="Distraction-free fullscreen"><Maximize2 className="h-5 w-5" /></Button>
          </div>
          <p className="text-center text-xs text-subtle">{settings.focus_minutes}/{settings.short_break_minutes}/{settings.long_break_minutes} min · long break every 4 sessions · change durations in Settings. Allow notifications to get an alert when the timer ends.</p>
        </div>

        <div className="space-y-5">
          <Card title="Daily focus target" icon={<Timer className="h-4 w-4" />}>
            <div className="mb-2 flex justify-between text-sm"><span className="font-bold">{minutesToHuman(todayMin)}</span><span className="text-muted">of {minutesToHuman(settings.daily_focus_target_min)}</span></div>
            <ProgressBar value={pct(todayMin, settings.daily_focus_target_min)} label="Daily focus progress" />
          </Card>
          <ChartCard title="Focus minutes · last 7 days" rows={days} columns={[{ key: 'day', label: 'Day' }, { key: 'Minutes', label: 'Minutes' }]} empty={!days.some((d) => d.Minutes)}>
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={days} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="day" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip format={(v) => minutesToHuman(v)} />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="Minutes" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
          <Card title="Session history">
            {focusSessions.length ? (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {focusSessions.slice(0, 30).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                    <span className={cn('h-2 w-2 rounded-full', s.completed ? 'bg-success' : 'bg-line-strong')} title={s.completed ? 'Completed' : 'Stopped early'} />
                    <span className="min-w-0 flex-1 truncate">{s.task_id ? taskById.get(s.task_id)?.title ?? 'Task' : 'Focus session'}</span>
                    <span className="text-xs text-muted tabular-nums">{fmt(s.started_at, tz, 'EEE')} {fmtTime(s.started_at, tz, h24)} · {s.actual_minutes}m</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact title="No focus sessions yet" description="Start the timer – completed sessions are saved automatically." />}
          </Card>
        </div>
      </div>
    </div>
  )
}
