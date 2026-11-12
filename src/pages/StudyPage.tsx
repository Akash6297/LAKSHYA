import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, GraduationCap, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge, Card, PageHeader, ProgressBar, ProgressRing } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { ColorPicker, ReminderPicker } from '@/components/ui/pickers'
import { EmptyState, ListSkeleton } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/Modal'
import { ChartCard, ChartTooltip, SERIES, axisProps, gridProps } from '@/components/charts'
import { addDaysKey, daysUntil, dowOfKey, fmt, fmtRange, fromInputDateTime, localDateKey, toInputDateTime, todayKey, zonedDayBounds } from '@/lib/dates'
import { cn, minutesToHuman, pct } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useCrud, useRows } from '@/services/resource'
import type { Chapter, Exam, StudySession, Subject } from '@/types/db'

const REVISION_STEPS = [1, 3, 7, 14, 30, 60]
const sessionMinutes = (s: StudySession) => s.actual_minutes ?? Math.round((new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 60_000)

export default function StudyPage() {
  const { tz, settings } = useAppData()
  const today = todayKey(tz)
  const subjects = useRows('subjects', ['all'], (q) => q.eq('archived', false).order('name'))
  const chapters = useRows('chapters', ['all'], (q) => q.order('sort_order').order('created_at'))
  const since = useMemo(() => zonedDayBounds(addDaysKey(today, -27), tz)[0].toISOString(), [today, tz])
  const sessions = useRows('study_sessions', ['recent', since], (q) => q.gte('start_at', since).order('start_at').limit(1000))
  const exams = useRows('exams', ['upcoming'], (q) => q.order('exam_at').limit(200))
  const [subjectModal, setSubjectModal] = useState<{ open: boolean; row?: Subject }>({ open: false })
  const [sessionModal, setSessionModal] = useState<{ open: boolean; row?: StudySession }>({ open: false })
  const [examModal, setExamModal] = useState<{ open: boolean; row?: Exam }>({ open: false })

  const subj = (subjects.data ?? []) as Subject[]
  const chaps = (chapters.data ?? []) as Chapter[]
  const sess = (sessions.data ?? []) as StudySession[]
  const ex = (exams.data ?? []) as Exam[]
  const subjectById = new Map(subj.map((s) => [s.id, s]))

  const done = sess.filter((s) => s.completed)
  const [tFrom, tTo] = zonedDayBounds(today, tz)
  const todayMin = done.filter((s) => new Date(s.start_at) >= tFrom && new Date(s.start_at) < tTo).reduce((a, s) => a + sessionMinutes(s), 0)
  const weekStart = addDaysKey(today, -((dowOfKey(today) - settings.week_starts_on + 7) % 7))
  const weekMin = done.filter((s) => localDateKey(new Date(s.start_at), tz) >= weekStart).reduce((a, s) => a + sessionMinutes(s), 0)
  const upcoming = sess.filter((s) => !s.completed && new Date(s.end_at) > new Date()).slice(0, 8)
  const upcomingExams = ex.filter((e) => new Date(e.exam_at) > new Date())
  const pastExams = ex.filter((e) => new Date(e.exam_at) <= new Date()).reverse()
  const dueRevision = chaps.filter((c) => c.next_revision_date && c.next_revision_date <= today)

  const daily = Array.from({ length: 14 }, (_, i) => {
    const k = addDaysKey(today, i - 13)
    return { day: fmt(k + 'T12:00:00Z', 'UTC', 'd MMM'), Minutes: done.filter((s) => localDateKey(new Date(s.start_at), tz) === k).reduce((a, s) => a + sessionMinutes(s), 0) }
  })
  const bySubject = subj.map((s, i) => ({
    subject: s.name,
    Hours: Math.round((done.filter((x) => x.subject_id === s.id).reduce((a, x) => a + sessionMinutes(x), 0) / 60) * 10) / 10,
    color: SERIES[i % 8],
  })).filter((r) => r.Hours > 0)

  return (
    <div>
      <PageHeader title="Study Planner" subtitle="Subjects, chapters, sessions, revisions and exams."
        actions={<>
          <Button variant="outline" onClick={() => setExamModal({ open: true })} icon={<GraduationCap className="h-4 w-4" />}>Exam</Button>
          <Button variant="outline" onClick={() => setSubjectModal({ open: true })} icon={<BookOpen className="h-4 w-4" />}>Subject</Button>
          <Button onClick={() => subj.length ? setSessionModal({ open: true }) : toast.info('Add a subject first')} icon={<Plus className="h-4 w-4" />}>Study session</Button>
        </>} />

      {upcomingExams.length > 0 && (
        <div className="scrollbar-none -mx-4 mb-5 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {upcomingExams.slice(0, 6).map((e) => {
            const d = daysUntil(localDateKey(new Date(e.exam_at), tz), tz)
            return (
              <button key={e.id} onClick={() => setExamModal({ open: true, row: e })} className={cn('card min-w-[180px] shrink-0 p-4 text-left', d <= 7 && 'border-danger/40')}>
                <div className="text-xs font-semibold text-muted">{e.kind === 'mock' ? 'Mock exam' : 'Exam'}{e.subject_id && ` · ${subjectById.get(e.subject_id)?.name ?? ''}`}</div>
                <div className="mt-1 truncate font-bold">{e.title}</div>
                <div className={cn('mt-2 text-3xl font-extrabold tabular-nums', d <= 7 ? 'text-danger' : 'text-primary')}>{d}<span className="ml-1 text-sm font-semibold text-muted">day{d === 1 ? '' : 's'}</span></div>
                <div className="text-xs text-muted">{fmt(e.exam_at, tz, 'EEE d MMM, h:mm a')}</div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <TargetCard label="Today's study target" value={todayMin} target={settings.daily_study_target_min} />
        <TargetCard label="This week's target" value={weekMin} target={settings.weekly_study_target_min} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Subjects & chapters" icon={<BookOpen className="h-4 w-4" />}>
            {subjects.isLoading ? <ListSkeleton /> : subj.length ? (
              <ul className="space-y-2">{subj.map((s) => <SubjectRow key={s.id} subject={s} chapters={chaps.filter((c) => c.subject_id === s.id)} onEdit={() => setSubjectModal({ open: true, row: s })} />)}</ul>
            ) : <EmptyState art="notes" title="No subjects yet" description="Add the subjects you're studying, then break them into chapters." action={<Button onClick={() => setSubjectModal({ open: true })}>Add subject</Button>} />}
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <ChartCard title="Study time · last 14 days" rows={daily} columns={[{ key: 'day', label: 'Day' }, { key: 'Minutes', label: 'Minutes' }]} empty={!daily.some((d) => d.Minutes)}>
              <div className="h-48">
                <ResponsiveContainer>
                  <BarChart data={daily} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="day" {...axisProps} interval={2} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip format={(v) => minutesToHuman(v)} />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="Minutes" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard title="Hours by subject · last 4 weeks" rows={bySubject.map(({ subject, Hours }) => ({ subject, Hours }))} columns={[{ key: 'subject', label: 'Subject' }, { key: 'Hours', label: 'Hours' }]} empty={!bySubject.length}>
              <div className="h-48">
                <ResponsiveContainer>
                  <BarChart data={bySubject} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid {...gridProps} horizontal={false} vertical />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="subject" {...axisProps} width={80} />
                    <Tooltip content={<ChartTooltip format={(v) => `${v} h`} />} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="Hours" radius={[0, 4, 4, 0]} maxBarSize={18}>{bySubject.map((r) => <Cell key={r.subject} fill={r.color} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>
        </div>

        <div className="space-y-5">
          <Card title="Upcoming sessions">
            {upcoming.length ? (
              <ul className="space-y-2">
                {upcoming.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                    <span className="h-8 w-1 rounded-full" style={{ background: subjectById.get(s.subject_id)?.color }} />
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSessionModal({ open: true, row: s })}>
                      <div className="truncate text-sm font-semibold">{s.title || subjectById.get(s.subject_id)?.name}</div>
                      <div className="text-xs text-muted">{fmt(s.start_at, tz, 'EEE d MMM')} · {fmtRange(s.start_at, s.end_at, tz)} · {s.kind}</div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact title="No sessions planned" description="Plan sessions – they appear on your calendar." />}
          </Card>
          <Card title={`Due for revision · ${dueRevision.length}`} icon={<RotateCcw className="h-4 w-4" />}>
            {dueRevision.length ? <ul className="space-y-1">{dueRevision.map((c) => <RevisionRow key={c.id} chapter={c} subject={subjectById.get(c.subject_id)} />)}</ul>
              : <EmptyState compact title="No revisions due" description="Completing a chapter schedules spaced revisions (1, 3, 7, 14, 30, 60 days)." />}
          </Card>
          <Card title="Exam results">
            {pastExams.length ? (
              <ul className="space-y-2">
                {pastExams.slice(0, 8).map((e) => (
                  <li key={e.id}><button onClick={() => setExamModal({ open: true, row: e })} className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{e.title}</span><span className="text-xs text-muted">{fmt(e.exam_at, tz, 'd MMM yyyy')} · {e.kind}</span></span>
                    {e.score != null && e.max_score ? <Badge color="#10B981">{e.score}/{e.max_score} · {pct(Number(e.score), Number(e.max_score))}%</Badge> : <Badge>Add score</Badge>}
                  </button></li>
                ))}
              </ul>
            ) : <EmptyState compact title="No past exams" />}
          </Card>
        </div>
      </div>

      <SubjectModal state={subjectModal} onClose={() => setSubjectModal({ open: false })} />
      <SessionModal state={sessionModal} subjects={subj} chapters={chaps} onClose={() => setSessionModal({ open: false })} />
      <ExamModal state={examModal} subjects={subj} onClose={() => setExamModal({ open: false })} />
    </div>
  )
}

function TargetCard({ label, value, target }: { label: string; value: number; target: number }) {
  const p = pct(value, target)
  return (
    <div className="card flex items-center gap-4 p-4">
      <ProgressRing value={Math.min(100, p)} size={60} stroke={7} color="var(--series-1)" />
      <div><div className="text-xs font-semibold text-muted">{label}</div><div className="text-lg font-extrabold">{minutesToHuman(value)} <span className="text-sm font-semibold text-muted">/ {minutesToHuman(target)}</span></div></div>
    </div>
  )
}

function SubjectRow({ subject, chapters, onEdit }: { subject: Subject; chapters: Chapter[]; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const { create } = useCrud('chapters')
  const done = chapters.filter((c) => c.status === 'completed').length
  return (
    <li className="rounded-xl border border-line">
      <div className="flex items-center gap-3 p-3">
        <button onClick={() => setOpen(!open)} className="text-muted" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        <span className="h-3 w-3 rounded-full" style={{ background: subject.color }} />
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}>
          <div className="truncate font-semibold">{subject.name}</div>
          <div className="mt-1 flex items-center gap-2"><ProgressBar value={pct(done, chapters.length)} color={subject.color} className="max-w-48" label={`${subject.name} chapters`} /><span className="text-xs text-muted">{done}/{chapters.length}</span></div>
        </button>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${subject.name}`}><Pencil className="h-4 w-4" /></Button>
      </div>
      {open && (
        <div className="border-t border-line p-3">
          <ul className="space-y-1">{chapters.map((c) => <ChapterRow key={c.id} chapter={c} />)}</ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { create.mutate({ subject_id: subject.id, title: draft.trim(), sort_order: chapters.length }); setDraft('') } }}>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add chapter…" aria-label="New chapter" />
            <Button type="submit" variant="soft" size="icon" aria-label="Add chapter"><Plus className="h-4 w-4" /></Button>
          </form>
        </div>
      )}
    </li>
  )
}

function ChapterRow({ chapter }: { chapter: Chapter }) {
  const { tz } = useAppData()
  const { update, remove } = useCrud('chapters')
  const setStatus = (done: boolean) => update.mutate({
    id: chapter.id, status: done ? 'completed' : 'in_progress',
    next_revision_date: done ? addDaysKey(todayKey(tz), REVISION_STEPS[0]) : null,
  })
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <Checkbox checked={chapter.status === 'completed'} onChange={setStatus} label={chapter.title} size="sm" />
      <span className={cn('flex-1 text-sm', chapter.status === 'completed' && 'text-muted')}>{chapter.title}</span>
      {chapter.status === 'in_progress' && <Badge color="#6366F1">In progress</Badge>}
      {chapter.revision_count > 0 && <span className="text-[11px] text-muted">↻ {chapter.revision_count}</span>}
      {chapter.status === 'not_started' && <button className="text-[11px] font-semibold text-primary opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => update.mutate({ id: chapter.id, status: 'in_progress' })}>Start</button>}
      <button className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove.mutate(chapter.id)} aria-label={`Delete ${chapter.title}`}><Trash2 className="h-3.5 w-3.5 text-muted" /></button>
    </li>
  )
}

function RevisionRow({ chapter, subject }: { chapter: Chapter; subject?: Subject }) {
  const { tz } = useAppData()
  const { update } = useCrud('chapters')
  const revise = () => {
    const n = chapter.revision_count + 1
    const step = REVISION_STEPS[Math.min(n, REVISION_STEPS.length - 1)]
    update.mutate({ id: chapter.id, revision_count: n, next_revision_date: addDaysKey(todayKey(tz), step) }, { onSuccess: () => toast.success(`Next revision in ${step} days`) })
  }
  return (
    <li className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
      <span className="h-2 w-2 rounded-full" style={{ background: subject?.color }} />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{chapter.title}</span><span className="text-xs text-muted">{subject?.name}</span></span>
      <Button size="sm" variant="soft" icon={<Check className="h-3.5 w-3.5" />} onClick={revise}>Revised</Button>
    </li>
  )
}

function SubjectModal({ state, onClose }: { state: { open: boolean; row?: Subject }; onClose: () => void }) {
  const { create, update } = useCrud('subjects')
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#0EA5E9')
  const [target, setTarget] = useState('')
  useEffect(() => { if (state.open) { setName(state.row?.name ?? ''); setColor(state.row?.color ?? '#0EA5E9'); setTarget(state.row?.target_hours?.toString() ?? '') } }, [state])
  const save = async () => {
    if (!name.trim()) return toast.error('Name is required')
    const payload = { name: name.trim(), color, target_hours: target ? Number(target) : null }
    if (state.row) await update.mutateAsync({ id: state.row.id, ...payload })
    else await create.mutateAsync(payload)
    onClose()
  }
  const archive = async () => {
    if (state.row && await confirm({ title: 'Archive subject?', message: 'It will be hidden from the planner. Sessions and history are kept.', confirmLabel: 'Archive' })) {
      await update.mutateAsync({ id: state.row.id, archived: true })
      onClose()
    }
  }
  return (
    <Modal open={state.open} onClose={onClose} title={state.row ? 'Edit subject' : 'New subject'} size="sm"
      footer={<>{state.row && <Button variant="ghost" className="mr-auto" onClick={() => void archive()}>Archive</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name" htmlFor="sb-n"><Input id="sb-n" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Target hours (optional)" htmlFor="sb-t"><Input id="sb-t" type="number" min={0} value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="Color"><ColorPicker value={color} onChange={setColor} /></Field>
      </div>
    </Modal>
  )
}

function SessionModal({ state, subjects, chapters, onClose }: { state: { open: boolean; row?: StudySession }; subjects: Subject[]; chapters: Chapter[]; onClose: () => void }) {
  const { tz } = useAppData()
  const { create, update, remove } = useCrud('study_sessions')
  const [v, setV] = useState({ subject_id: '', chapter_id: '', title: '', kind: 'study', start: '', end: '', completed: false, actual: '', notes: '' })
  const [reminders, setReminders] = useState<number[]>([15])
  useEffect(() => {
    if (!state.open) return
    const r = state.row
    const s = r ? new Date(r.start_at) : new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000)
    setV({
      subject_id: r?.subject_id ?? subjects[0]?.id ?? '', chapter_id: r?.chapter_id ?? '', title: r?.title ?? '', kind: r?.kind ?? 'study',
      start: toInputDateTime(s, tz), end: toInputDateTime(r ? new Date(r.end_at) : new Date(s.getTime() + 3_600_000), tz),
      completed: r?.completed ?? false, actual: r?.actual_minutes?.toString() ?? '', notes: r?.notes ?? '',
    })
    setReminders(r?.reminder_minutes ?? [15])
  }, [state, subjects, tz])
  const save = async () => {
    if (!v.subject_id || !v.start || !v.end) return toast.error('Choose a subject and times')
    if (v.end <= v.start) return toast.error('End must be after start')
    const payload = {
      subject_id: v.subject_id, chapter_id: v.chapter_id || null, title: v.title.trim() || null, kind: v.kind as StudySession['kind'],
      start_at: fromInputDateTime(v.start, tz)!, end_at: fromInputDateTime(v.end, tz)!, completed: v.completed,
      actual_minutes: v.actual ? Math.min(1440, Number(v.actual)) : null, notes: v.notes.trim() || null, reminder_minutes: reminders,
    }
    if (state.row) await update.mutateAsync({ id: state.row.id, ...payload })
    else await create.mutateAsync(payload)
    onClose()
  }
  return (
    <Modal open={state.open} onClose={onClose} title={state.row ? 'Edit study session' : 'Plan study session'}
      footer={<>{state.row && <Button variant="ghost" size="icon-sm" className="mr-auto" onClick={() => { remove.mutate(state.row!.id); onClose() }} aria-label="Delete session"><Trash2 className="h-4 w-4 text-danger" /></Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subject" htmlFor="ss-s"><Select id="ss-s" value={v.subject_id} onChange={(e) => setV({ ...v, subject_id: e.target.value, chapter_id: '' })}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Chapter" htmlFor="ss-c"><Select id="ss-c" value={v.chapter_id} onChange={(e) => setV({ ...v, chapter_id: e.target.value })}><option value="">Any</option>{chapters.filter((c) => c.subject_id === v.subject_id).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
        <Field label="Title (optional)" htmlFor="ss-t"><Input id="ss-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Type" htmlFor="ss-k"><Select id="ss-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="study">Study</option><option value="revision">Revision</option><option value="practice">Practice</option></Select></Field>
        <Field label="Starts" htmlFor="ss-st"><Input id="ss-st" type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
        <Field label="Ends" htmlFor="ss-en"><Input id="ss-en" type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /></Field>
        <div className="flex items-center gap-2 sm:col-span-2"><Checkbox checked={v.completed} onChange={(c) => setV({ ...v, completed: c })} label="Completed" /><span className="text-sm font-semibold">Completed</span></div>
        {v.completed && <Field label="Actual minutes studied" hint="Leave empty to use the planned duration" htmlFor="ss-a"><Input id="ss-a" type="number" min={0} max={1440} value={v.actual} onChange={(e) => setV({ ...v, actual: e.target.value })} /></Field>}
        <Field label="Reminders" className="sm:col-span-2"><ReminderPicker value={reminders} onChange={setReminders} /></Field>
        <Field label="Notes" className="sm:col-span-2" htmlFor="ss-n"><Textarea id="ss-n" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function ExamModal({ state, subjects, onClose }: { state: { open: boolean; row?: Exam }; subjects: Subject[]; onClose: () => void }) {
  const { tz } = useAppData()
  const { create, update, remove } = useCrud('exams')
  const [v, setV] = useState({ title: '', kind: 'exam', subject_id: '', at: '', duration: '180', location: '', score: '', max: '', notes: '' })
  const [reminders, setReminders] = useState<number[]>([1440, 180])
  useEffect(() => {
    if (!state.open) return
    const r = state.row
    setV({ title: r?.title ?? '', kind: r?.kind ?? 'exam', subject_id: r?.subject_id ?? '', at: toInputDateTime(r?.exam_at ?? null, tz), duration: String(r?.duration_minutes ?? 180),
      location: r?.location ?? '', score: r?.score?.toString() ?? '', max: r?.max_score?.toString() ?? '', notes: r?.notes ?? '' })
    setReminders(r?.reminder_minutes ?? [1440, 180])
  }, [state, tz])
  const save = async () => {
    if (!v.title.trim() || !v.at) return toast.error('Title and date are required')
    const payload = { title: v.title.trim(), kind: v.kind as Exam['kind'], subject_id: v.subject_id || null, exam_at: fromInputDateTime(v.at, tz)!,
      duration_minutes: Math.max(1, Number(v.duration) || 180), location: v.location.trim() || null, score: v.score ? Number(v.score) : null,
      max_score: v.max ? Number(v.max) : null, notes: v.notes.trim() || null, reminder_minutes: reminders }
    if (state.row) await update.mutateAsync({ id: state.row.id, ...payload })
    else await create.mutateAsync(payload)
    onClose()
  }
  return (
    <Modal open={state.open} onClose={onClose} title={state.row ? 'Edit exam' : 'Add exam'}
      footer={<>{state.row && <Button variant="ghost" size="icon-sm" className="mr-auto" onClick={() => { remove.mutate(state.row!.id); onClose() }} aria-label="Delete exam"><Trash2 className="h-4 w-4 text-danger" /></Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2" htmlFor="ex-t"><Input id="ex-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} autoFocus /></Field>
        <Field label="Type" htmlFor="ex-k"><Select id="ex-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="exam">Exam</option><option value="mock">Mock exam</option></Select></Field>
        <Field label="Subject" htmlFor="ex-s"><Select id="ex-s" value={v.subject_id} onChange={(e) => setV({ ...v, subject_id: e.target.value })}><option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Date & time" htmlFor="ex-a"><Input id="ex-a" type="datetime-local" value={v.at} onChange={(e) => setV({ ...v, at: e.target.value })} /></Field>
        <Field label="Duration (min)" htmlFor="ex-d"><Input id="ex-d" type="number" min={1} value={v.duration} onChange={(e) => setV({ ...v, duration: e.target.value })} /></Field>
        <Field label="Location" className="sm:col-span-2" htmlFor="ex-l"><Input id="ex-l" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} /></Field>
        <Field label="Score" htmlFor="ex-sc"><Input id="ex-sc" type="number" value={v.score} onChange={(e) => setV({ ...v, score: e.target.value })} /></Field>
        <Field label="Out of" htmlFor="ex-m"><Input id="ex-m" type="number" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></Field>
        <Field label="Reminders" className="sm:col-span-2"><ReminderPicker value={reminders} onChange={setReminders} /></Field>
        <Field label="Notes" className="sm:col-span-2" htmlFor="ex-n"><Textarea id="ex-n" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
