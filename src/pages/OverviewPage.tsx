import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, BookOpen, CalendarPlus, CheckCircle2, CheckSquare, Clock, FolderPlus, Info, ListTodo, Sparkles, StickyNote, Target, Timer, Users } from 'lucide-react'
import { Card, ProgressBar, ProgressRing, Stat } from '@/components/ui/display'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback'
import { Button } from '@/components/ui/Button'
import { AgendaList } from '@/features/calendar/AgendaList'
import { TaskItem } from '@/features/tasks/TaskItem'
import { RescheduleQueue } from '@/features/tasks/RescheduleQueue'
import { useOpenTasks, useProjectNames } from '@/features/tasks/hooks'
import { addDaysKey, fmt, greeting, todayKey, zonedDayBounds } from '@/lib/dates'
import { isOverdue, topFocusTasks } from '@/lib/planning'
import { minutesToHuman, pct } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useCalendarFeed } from '@/services/calendar'
import { useCount, useRows } from '@/services/resource'
import type { FocusSession, Goal, Project } from '@/types/db'

export default function OverviewPage() {
  const { tz, profile, categoryById, h24 } = useAppData()
  const quick = useQuickCreate()
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const today = todayKey(tz)
  const [dayStart, dayEnd] = useMemo(() => zonedDayBounds(today, tz), [today, tz])
  const weekEnd = useMemo(() => zonedDayBounds(addDaysKey(today, 7), tz)[1], [today, tz])

  const open = useOpenTasks()
  const projects = useProjectNames()
  const todayFeed = useCalendarFeed(dayStart, dayEnd, { tz, categories: categoryById })
  const weekFeed = useCalendarFeed(dayEnd, weekEnd, { tz, categories: categoryById, kinds: ['event', 'meeting', 'exam', 'deadline', 'task', 'timeoff'] })
  const doneToday = useCount('tasks', ['done-today', today], (q) => q.gte('completed_at', dayStart.toISOString()).lt('completed_at', dayEnd.toISOString()))
  const focus = useRows('focus_sessions', ['today', today], (q) => q.eq('kind', 'focus').gte('started_at', dayStart.toISOString()))
  const activeProjects = useRows('projects', ['active'], (q) => q.in('status', ['active', 'planning']).order('deadline', { ascending: true, nullsFirst: false }).limit(5))
  const goals = useRows('goals', ['active'], (q) => q.eq('status', 'active').order('target_date', { ascending: true, nullsFirst: false }).limit(4))

  const tasks = open.data ?? []
  const overdue = tasks.filter((t) => isOverdue(t, now))
  const dueToday = tasks.filter((t) => t.due_date === today || (t.start_at && t.start_at >= dayStart.toISOString() && t.start_at < dayEnd.toISOString()))
  const focusTop = topFocusTasks(tasks, now, open.blocked, today)
  const totalToday = dueToday.length + (doneToday.data ?? 0)
  const progress = pct(doneToday.data ?? 0, totalToday)
  const focusMin = ((focus.data ?? []) as FocusSession[]).reduce((a, f) => a + f.actual_minutes, 0)
  const meetingsToday = todayFeed.items.filter((i) => i.kind === 'meeting')
  const studyToday = todayFeed.items.filter((i) => i.kind === 'study')
  const upcomingMeetings = weekFeed.items.filter((i) => i.kind === 'meeting').slice(0, 4)
  const name = profile?.full_name?.split(' ')[0]

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="card relative overflow-hidden p-5 sm:p-7">
        <div className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-muted">{fmt(now, tz, 'EEEE, d MMMM yyyy')} · <span className="tabular-nums">{fmt(now, tz, h24 ? 'HH:mm' : 'h:mm a')}</span></div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{greeting(tz)}{name ? `, ${name}` : ''}.</h1>
            <p className="mt-1 text-muted">
              {open.isLoading ? 'Loading your day…' : totalToday === 0 && !todayFeed.items.length
                ? 'Your day is open. Plan something meaningful.'
                : `${todayFeed.items.filter((i) => !i.allDay && i.kind !== 'task').length} scheduled items and ${dueToday.length} tasks left today${overdue.length ? ` · ${overdue.length} overdue` : ''}.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => quick.openTask()} icon={<CheckSquare className="h-4 w-4" />}>Add task</Button>
              <Button size="sm" variant="secondary" onClick={() => quick.openEvent()} icon={<CalendarPlus className="h-4 w-4" />}>Event</Button>
              <Button size="sm" variant="secondary" onClick={() => quick.openMeeting()} icon={<Users className="h-4 w-4" />}>Meeting</Button>
              <Button size="sm" variant="secondary" onClick={() => quick.openProject()} icon={<FolderPlus className="h-4 w-4" />}>Project</Button>
              <Button size="sm" variant="secondary" onClick={() => void quick.newNote()} icon={<StickyNote className="h-4 w-4" />}>Note</Button>
              <Link to="/focus"><Button size="sm" variant="soft" icon={<Timer className="h-4 w-4" />}>Focus</Button></Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ProgressRing value={progress} size={104} stroke={10}>
              <div><div className="text-2xl font-extrabold">{progress}%</div><div className="text-[10px] font-semibold text-muted uppercase">today</div></div>
            </ProgressRing>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pending tasks" value={open.isLoading ? '–' : tasks.length} icon={<ListTodo className="h-5 w-5" />} />
        <Stat label="Overdue" value={open.isLoading ? '–' : overdue.length} icon={<AlertTriangle className="h-5 w-5" />} tone={overdue.length ? 'danger' : 'success'} />
        <Stat label="Completed today" value={doneToday.data ?? '–'} icon={<CheckCircle2 className="h-5 w-5" />} tone="success" />
        <Stat label="Focus today" value={minutesToHuman(focusMin)} icon={<Timer className="h-5 w-5" />} tone="warning" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Today's Focus" icon={<Sparkles className="h-4 w-4" />}
            action={<span className="group relative">
              <Info className="h-4 w-4 cursor-help text-subtle" tabIndex={0} aria-label="How focus is ranked" />
              <span className="pointer-events-none absolute right-0 z-10 mt-2 hidden w-72 rounded-xl border border-line bg-surface p-3 text-xs text-muted shadow-pop group-focus-within:block group-hover:block">
                Ranked by a transparent score: priority (critical 40, high 28, medium 16, low 6) + urgency (overdue 45, due ≤24h 30, ≤3 days 18, ≤7 days 8) + 10 if in progress + 6 if planned for today − 25 if blocked by a dependency.
              </span>
            </span>}>
            {open.isLoading ? <ListSkeleton rows={3} /> : open.error ? <ErrorState error={open.error} onRetry={() => open.refetch()} /> : focusTop.length ? (
              <ol className="space-y-1">
                {focusTop.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-fg">{i + 1}</span>
                    <div className="min-w-0 flex-1"><TaskItem task={t} projectName={t.project_id ? projects.get(t.project_id) : undefined} blocked={open.blocked.has(t.id)} /></div>
                  </li>
                ))}
              </ol>
            ) : <EmptyState compact title="Nothing pressing" description="Add a task and LAKSHYA will surface what matters most." action={<Button size="sm" onClick={() => quick.openTask()}>Add task</Button>} />}
          </Card>

          <Card title="Today's schedule" icon={<Clock className="h-4 w-4" />} action={<Link to="/my-day" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">Plan day <ArrowRight className="h-3 w-3" /></Link>}>
            {todayFeed.loading ? <ListSkeleton rows={3} /> : (
              <AgendaList items={todayFeed.items} empty={<EmptyState compact title="No events today" description="Time-block your tasks in My Day." />} />
            )}
          </Card>

          <Card title="Upcoming 7 days" icon={<CalendarPlus className="h-4 w-4" />} action={<Link to="/calendar" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">Calendar <ArrowRight className="h-3 w-3" /></Link>}>
            {weekFeed.loading ? <ListSkeleton rows={4} /> : (
              <AgendaList groupByDay items={weekFeed.items.filter((i) => !i.done).slice(0, 25)} empty={<EmptyState compact title="A clear week ahead" />} />
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {overdue.length > 0 && <RescheduleQueue tasks={overdue} />}

          <Card title="Upcoming meetings" icon={<Users className="h-4 w-4" />} action={<Link to="/meetings" className="text-xs font-semibold text-primary">All</Link>}>
            <AgendaList items={[...new Map([...meetingsToday.filter((m) => m.end > now), ...upcomingMeetings].map((m) => [m.key, m])).values()].slice(0, 5)} empty={<EmptyState compact title="No meetings scheduled" />} />
          </Card>

          <Card title="Active projects" icon={<FolderPlus className="h-4 w-4" />} action={<Link to="/projects" className="text-xs font-semibold text-primary">All</Link>}>
            {activeProjects.isLoading ? <ListSkeleton rows={2} /> : ((activeProjects.data ?? []) as Project[]).length ? (
              <ul className="space-y-3">
                {((activeProjects.data ?? []) as Project[]).map((p) => (
                  <li key={p.id}>
                    <Link to={`/projects/${p.id}`} className="block rounded-xl p-1 hover:bg-surface-2">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} /><span className="truncate">{p.title}</span></span>
                        <span className="text-xs font-bold text-muted">{p.progress}%</span>
                      </div>
                      <ProgressBar value={p.progress} color={p.color} label={`${p.title} progress`} />
                      {p.deadline && <div className="mt-1 text-[11px] text-subtle">Due {fmt(p.deadline + 'T12:00:00Z', 'UTC', 'd MMM yyyy')}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact title="No active projects" action={<Button size="sm" variant="soft" onClick={() => quick.openProject()}>Create project</Button>} />}
          </Card>

          <Card title="Study today" icon={<BookOpen className="h-4 w-4" />} action={<Link to="/study" className="text-xs font-semibold text-primary">Planner</Link>}>
            <AgendaList items={studyToday} empty={<EmptyState compact title="No study sessions today" />} />
          </Card>

          <Card title="Goal progress" icon={<Target className="h-4 w-4" />} action={<Link to="/goals" className="text-xs font-semibold text-primary">Goals</Link>}>
            {((goals.data ?? []) as Goal[]).length ? (
              <ul className="space-y-3">
                {((goals.data ?? []) as Goal[]).map((g) => {
                  const v = g.target_value ? pct(Number(g.current_value), Number(g.target_value)) : 0
                  return (
                    <li key={g.id}>
                      <div className="mb-1 flex justify-between text-sm"><span className="truncate font-semibold">{g.title}</span><span className="text-xs text-muted">{g.target_value ? `${v}%` : g.goal_type}</span></div>
                      {g.target_value ? <ProgressBar value={v} color="var(--success)" label={`${g.title} progress`} /> : null}
                    </li>
                  )
                })}
              </ul>
            ) : <EmptyState compact title="No active goals" />}
          </Card>
        </div>
      </div>
    </div>
  )
}
