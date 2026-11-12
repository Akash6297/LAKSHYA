import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Copy, GitBranch, History, ListChecks, Plus, Timer, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { CategorySelect, ReminderPicker, TagInput } from '@/components/ui/pickers'
import { Segmented } from '@/components/ui/display'
import { PRIORITIES, TASK_RECURRENCES, TASK_STATUSES } from '@/lib/constants'
import { fmt, fmtTime, taskDueAt, zonedInstant } from '@/lib/dates'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useCrud, useRows } from '@/services/resource'
import { useTaskActions, useTasks } from '@/services/tasks'
import type { Priority, Project, Subtask, Task, TaskDependency, TaskRecurrence, TaskStatus, ActivityLog } from '@/types/db'
import { WhatsAppShare } from '@/features/notifications/WhatsAppShare'

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().max(10000).optional(),
  notes: z.string().max(20000).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  status: z.enum(['not_started', 'in_progress', 'pending', 'completed', 'cancelled']),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  due_time: z.string().optional(),
  block_start: z.string().optional(),
  block_end: z.string().optional(),
  recurrence: z.string().optional(),
}).refine((v) => !v.start_date || !v.due_date || v.due_date >= v.start_date, { message: 'Due date must be on or after the start date', path: ['due_date'] })
  .refine((v) => !v.block_start || !v.block_end || v.block_end > v.block_start, { message: 'End time must be after start time', path: ['block_end'] })
  .refine((v) => !v.due_time || !!v.due_date, { message: 'Pick a due date for this time', path: ['due_time'] })

type FormValues = z.infer<typeof schema>

export interface TaskDefaults {
  project_id?: string | null
  meeting_id?: string | null
  due_date?: string
  start_date?: string
  block_start?: string
  block_end?: string
  title?: string
  category_id?: string | null
}

export function TaskFormModal({ open, onClose, task, defaults }: { open: boolean; onClose: () => void; task?: Task | null; defaults?: TaskDefaults }) {
  const { tz, settings, prefs } = useAppData()
  const { create, update, remove } = useTaskActions()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'details' | 'subtasks' | 'deps' | 'history'>('details')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [reminders, setReminders] = useState<number[]>([])
  const projects = useRows('projects', ['options'], (q) => q.not('status', 'in', '(completed,cancelled)').order('title'), { select: 'id,title,status' })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    setTab('details')
    const t = task
    reset({
      title: t?.title ?? defaults?.title ?? '',
      description: t?.description ?? '',
      notes: t?.notes ?? '',
      priority: t?.priority ?? 'medium',
      status: t?.status ?? 'not_started',
      start_date: t?.start_date ?? defaults?.start_date ?? '',
      due_date: t?.due_date ?? defaults?.due_date ?? '',
      due_time: t?.due_at && t.has_due_time ? fmt(t.due_at, tz, 'HH:mm') : '',
      block_start: t?.start_at ? fmt(t.start_at, tz, 'HH:mm') : defaults?.block_start ?? '',
      block_end: t?.end_at ? fmt(t.end_at, tz, 'HH:mm') : defaults?.block_end ?? '',
      recurrence: t?.recurrence ?? '',
    })
    setCategoryId(t?.category_id ?? defaults?.category_id ?? null)
    setProjectId(t?.project_id ?? defaults?.project_id ?? null)
    setTags(t?.tags ?? [])
    setReminders(t?.reminder_minutes ?? prefs?.task_default_reminders ?? [])
  }, [open, task, defaults, reset, tz, prefs])

  const onSubmit = handleSubmit(async (v) => {
    const blockDate = v.start_date || v.due_date || (v.block_start ? fmt(new Date(), tz, 'yyyy-MM-dd') : '')
    const payload = {
      title: v.title.trim(),
      description: v.description?.trim() || null,
      notes: v.notes?.trim() || null,
      priority: v.priority as Priority,
      status: v.status as TaskStatus,
      start_date: v.start_date || null,
      due_date: v.due_date || null,
      due_at: taskDueAt(v.due_date || null, v.due_time || null, tz),
      has_due_time: !!v.due_time,
      start_at: v.block_start && blockDate ? zonedInstant(blockDate, v.block_start, tz).toISOString() : null,
      end_at: v.block_start && blockDate ? zonedInstant(blockDate, v.block_end || addMinutes(v.block_start, 30), tz).toISOString() : null,
      recurrence: (v.recurrence || null) as TaskRecurrence | null,
      category_id: categoryId,
      project_id: projectId,
      meeting_id: task?.meeting_id ?? defaults?.meeting_id ?? null,
      tags,
      reminder_minutes: reminders,
    }
    if (task) await update.mutateAsync({ id: task.id, patch: payload, base: task })
    else await create.mutateAsync(payload)
    onClose()
  })

  const onDelete = async () => {
    if (!task) return
    if (await confirm({ title: 'Delete task?', message: `"${task.title}" and its subtasks will be permanently deleted.`, confirmLabel: 'Delete', danger: true })) {
      remove.mutate(task.id)
      onClose()
    }
  }

  const onDuplicate = async () => {
    if (!task) return
    const { id: _i, user_id: _u, created_at: _c, updated_at: _up, completed_at: _ca, client_key: _ck, recurrence_parent_id: _rp, ...rest } = task
    await create.mutateAsync({ ...rest, title: `${task.title} (copy)`, status: 'not_started' })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={task ? 'Edit task' : 'New task'}
      footer={
        <>
          {task && (
            <div className="mr-auto flex gap-1">
              <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete task" title="Delete"><Trash2 className="h-4 w-4 text-danger" /></Button>
              <Button variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label="Duplicate task" title="Duplicate"><Copy className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon-sm" onClick={() => { onClose(); navigate(`/focus?task=${task.id}`) }} aria-label="Start focus session" title="Focus on this"><Timer className="h-4 w-4" /></Button>
              <WhatsAppShare text={`Reminder: ${task.title}${task.due_at ? ` (due ${fmt(task.due_at, tz, 'd MMM, h:mm a')})` : ''}`} number={settings.whatsapp_number} iconOnly />
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting} disabled={tab !== 'details' && !task}>{task ? 'Save' : 'Create task'}</Button>
        </>
      }>
      {task && (
        <Segmented className="mb-4" size="sm" value={tab} onChange={setTab} options={[
          { value: 'details', label: 'Details' },
          { value: 'subtasks', label: 'Subtasks', icon: <ListChecks className="h-3.5 w-3.5" /> },
          { value: 'deps', label: 'Dependencies', icon: <GitBranch className="h-3.5 w-3.5" /> },
          { value: 'history', label: 'History', icon: <History className="h-3.5 w-3.5" /> },
        ]} />
      )}
      {tab === 'details' && (
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <button type="submit" hidden />
          <Field label="Title" error={errors.title?.message} className="sm:col-span-2" htmlFor="t-title">
            <Input id="t-title" autoFocus placeholder="What needs to be done?" {...register('title')} invalid={!!errors.title} />
          </Field>
          <Field label="Priority" htmlFor="t-pri">
            <Select id="t-pri" {...register('priority')}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          </Field>
          <Field label="Status" htmlFor="t-status">
            <Select id="t-status" {...register('status')}>{TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
          </Field>
          <Field label="Category" htmlFor="t-cat"><CategorySelect id="t-cat" value={categoryId} onChange={setCategoryId} /></Field>
          <Field label="Project" htmlFor="t-proj">
            <Select id="t-proj" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
              <option value="">No project</option>
              {(projects.data as Pick<Project, 'id' | 'title'>[] | undefined)?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="t-sd"><Input id="t-sd" type="date" {...register('start_date')} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Due date" error={errors.due_date?.message} htmlFor="t-dd"><Input id="t-dd" type="date" {...register('due_date')} /></Field>
            <Field label="Due time" error={errors.due_time?.message} htmlFor="t-dt"><Input id="t-dt" type="time" {...register('due_time')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <Field label="Block start time" hint="Schedules the task on your timeline" htmlFor="t-bs"><Input id="t-bs" type="time" {...register('block_start')} /></Field>
            <Field label="Block end time" error={errors.block_end?.message} htmlFor="t-be"><Input id="t-be" type="time" {...register('block_end')} /></Field>
          </div>
          <Field label="Repeat" hint="Next occurrence is created when you complete this one" htmlFor="t-rep">
            <Select id="t-rep" {...register('recurrence')}>{TASK_RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
          </Field>
          <Field label="Tags"><TagInput value={tags} onChange={setTags} /></Field>
          <Field label="Reminders" className="sm:col-span-2" hint="Relative to the scheduled block, or the due time">
            <ReminderPicker value={reminders} onChange={setReminders} />
          </Field>
          <Field label="Description" className="sm:col-span-2" htmlFor="t-desc"><Textarea id="t-desc" rows={3} {...register('description')} /></Field>
          <Field label="Notes" className="sm:col-span-2" htmlFor="t-notes"><Textarea id="t-notes" rows={2} {...register('notes')} /></Field>
        </form>
      )}
      {tab === 'subtasks' && task && <SubtaskList taskId={task.id} />}
      {tab === 'deps' && task && <Dependencies task={task} />}
      {tab === 'history' && task && <TaskHistory taskId={task.id} />}
    </Modal>
  )
}

function addMinutes(hm: string, m: number) {
  const [h, mm] = hm.split(':').map(Number)
  const t = Math.min(h * 60 + mm + m, 23 * 60 + 59)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function SubtaskList({ taskId }: { taskId: string }) {
  const subs = useRows('task_subtasks', [taskId], (q) => q.eq('task_id', taskId).order('sort_order').order('created_at'))
  const { create, update, remove } = useCrud('task_subtasks', ['tasks'])
  const [draft, setDraft] = useState('')
  const rows = (subs.data ?? []) as Subtask[]
  const done = rows.filter((s) => s.is_done).length
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted">{done}/{rows.length} complete</div>
      <ul className="space-y-1">
        {rows.map((s) => (
          <li key={s.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
            <Checkbox checked={s.is_done} onChange={(v) => update.mutate({ id: s.id, is_done: v })} label={s.title} size="sm" />
            <span className={s.is_done ? 'flex-1 text-sm text-muted line-through' : 'flex-1 text-sm'}>{s.title}</span>
            <button onClick={() => remove.mutate(s.id)} className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete subtask ${s.title}`}><X className="h-4 w-4 text-muted" /></button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault()
        if (!draft.trim()) return
        create.mutate({ task_id: taskId, title: draft.trim(), sort_order: rows.length })
        setDraft('')
      }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a subtask…" aria-label="New subtask" />
        <Button type="submit" variant="soft" icon={<Plus className="h-4 w-4" />}>Add</Button>
      </form>
    </div>
  )
}

function Dependencies({ task }: { task: Task }) {
  const deps = useRows('task_dependencies', [task.id], (q) => q.eq('task_id', task.id))
  const all = useTasks(['open-options'], (q) => q.not('status', 'in', '(completed,cancelled)').order('title').limit(500))
  const { create, remove } = useCrud('task_dependencies', ['tasks'])
  const [pick, setPick] = useState('')
  const byId = useMemo(() => new Map((all.data ?? []).map((t) => [t.id, t])), [all.data])
  const rows = (deps.data ?? []) as TaskDependency[]
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">This task is blocked until these tasks are completed. Blocked tasks rank lower in Today's Focus.</p>
      <ul className="space-y-1">
        {rows.map((d) => {
          const t = byId.get(d.depends_on_task_id)
          return (
            <li key={d.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span>{t?.title ?? 'Completed / unavailable task'}</span>
              <button onClick={() => remove.mutate(d.id)} aria-label="Remove dependency"><X className="h-4 w-4 text-muted" /></button>
            </li>
          )
        })}
        {!rows.length && <li className="text-sm text-subtle">No dependencies.</li>}
      </ul>
      <div className="flex gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Task this depends on">
          <option value="">Depends on…</option>
          {(all.data ?? []).filter((t) => t.id !== task.id && !rows.some((d) => d.depends_on_task_id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </Select>
        <Button variant="soft" disabled={!pick} onClick={() => { create.mutate({ task_id: task.id, depends_on_task_id: pick }); setPick('') }}>Add</Button>
      </div>
    </div>
  )
}

export function TaskHistory({ taskId, entity = 'task' }: { taskId: string; entity?: string }) {
  const { tz, h24 } = useAppData()
  const logs = useRows('activity_logs', [entity, taskId], (q) => q.eq('entity_type', entity).eq('entity_id', taskId).order('created_at', { ascending: false }).limit(50))
  const rows = (logs.data ?? []) as ActivityLog[]
  if (!rows.length) return <p className="text-sm text-subtle">No history yet.</p>
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {rows.map((l) => (
        <li key={l.id} className="text-sm">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
          <div className="font-semibold capitalize">{l.action}</div>
          {l.action === 'updated' && l.changes && (
            <div className="text-xs text-muted">Changed: {Object.keys(l.changes).filter((k) => !['completed_at', 'due_at', 'has_due_time'].includes(k)).join(', ').replace(/_/g, ' ') || 'details'}</div>
          )}
          <div className="text-xs text-subtle">{fmt(l.created_at, tz, 'd MMM yyyy')} · {fmtTime(l.created_at, tz, h24)}</div>
        </li>
      ))}
    </ol>
  )
}
