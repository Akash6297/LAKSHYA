import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Copy, Repeat, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form'
import { CategorySelect, ReminderPicker, TagInput } from '@/components/ui/pickers'
import { Segmented } from '@/components/ui/display'
import { PRIORITIES } from '@/lib/constants'
import { addDaysKey, fmt, fmtRange, fromInputDateTime, toInputDateTime, zonedInstant, zonedDayBounds } from '@/lib/dates'
import { conflictsWith } from '@/lib/planning'
import { safeUrl } from '@/lib/utils'
import { describeRule, isValidRule, presetToRule, type RepeatPreset } from '@shared/recurrence.ts'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { createEvent, deleteEvent, duplicateEvent, updateEvent, useCalendarFeed, useInvalidateCalendar, type EditScope } from '@/services/calendar'
import { Attachments } from '@/features/attachments/Attachments'
import { TaskHistory } from '@/features/tasks/TaskFormModal'
import { WhatsAppShare } from '@/features/notifications/WhatsAppShare'
import type { EventRow, Priority } from '@/types/db'

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  all_day: z.boolean(),
  start: z.string().min(1, 'Start is required'),
  end: z.string().min(1, 'End is required'),
  start_date: z.string(),
  end_date: z.string(),
  location: z.string().max(300).optional(),
  meeting_url: z.string().max(500).optional().refine((v) => !v || !!safeUrl(v), 'Enter a valid https:// link'),
  description: z.string().max(10000).optional(),
  notes: z.string().max(20000).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  repeat: z.string(),
  custom_rule: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.all_day ? v.end_date < v.start_date : v.end <= v.start) ctx.addIssue({ code: 'custom', message: 'End must be after start', path: [v.all_day ? 'end_date' : 'end'] })
  if (v.repeat === 'custom' && (!v.custom_rule || !isValidRule(v.custom_rule))) ctx.addIssue({ code: 'custom', message: 'Enter a valid RRULE, e.g. FREQ=WEEKLY;BYDAY=MO,WE', path: ['custom_rule'] })
})
type FormValues = z.infer<typeof schema>

export interface EventTarget {
  row: EventRow
  master?: EventRow
  originalStart?: Date
  /** occurrence times when opening an instance of a series */
  start?: Date
  end?: Date
}

function ruleToPreset(rule: string | null): RepeatPreset {
  if (!rule) return 'none'
  const r = rule.replace(/^RRULE:/, '')
  if (r === 'FREQ=DAILY') return 'daily'
  if (r === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays'
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(r)) return 'weekly'
  if (/^FREQ=WEEKLY;INTERVAL=2;BYDAY=[A-Z]{2}$/.test(r)) return 'biweekly'
  if (r === 'FREQ=MONTHLY') return 'monthly'
  if (r === 'FREQ=YEARLY') return 'yearly'
  return 'custom'
}

export function EventFormModal({ open, onClose, target, defaults }: {
  open: boolean
  onClose: () => void
  target?: EventTarget | null
  defaults?: { start?: Date; end?: Date; allDay?: boolean; title?: string; categorySlug?: string }
}) {
  const { tz, settings, categories, categoryById } = useAppData()
  const confirm = useConfirm()
  const invalidate = useInvalidateCalendar()
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [reminders, setReminders] = useState<number[]>([30])
  const [scope, setScope] = useState<EditScope>('this')
  const [tab, setTab] = useState<'details' | 'files' | 'history'>('details')
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID())

  const editing = !!target
  const series = target?.master ?? null
  const isRecurringInstance = !!series && !!target?.originalStart
  const base = target?.master ?? target?.row

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    setTab('details')
    setScope('this')
    setClientKey(crypto.randomUUID())
    const s = target?.start ?? (target ? new Date(target.row.start_at) : defaults?.start ?? roundedNow())
    const e = target?.end ?? (target ? new Date(target.row.end_at) : defaults?.end ?? new Date(s.getTime() + settings.default_event_minutes * 60_000))
    const allDay = target?.row.all_day ?? defaults?.allDay ?? false
    const startKey = fmt(s, tz, 'yyyy-MM-dd')
    // all-day rows store an exclusive end at midnight → show the inclusive last day
    const endKey = allDay ? fmt(new Date(e.getTime() - 1), tz, 'yyyy-MM-dd') : fmt(e, tz, 'yyyy-MM-dd')
    const rule = base?.rrule ?? null
    reset({
      title: target?.row.title ?? defaults?.title ?? '',
      all_day: allDay,
      start: toInputDateTime(s, tz),
      end: toInputDateTime(e, tz),
      start_date: startKey,
      end_date: endKey < startKey ? startKey : endKey,
      location: target?.row.location ?? '',
      meeting_url: target?.row.meeting_url ?? '',
      description: target?.row.description ?? '',
      notes: target?.row.notes ?? '',
      priority: target?.row.priority ?? 'medium',
      repeat: ruleToPreset(rule),
      custom_rule: rule ?? '',
    })
    setCategoryId(target?.row.category_id ?? categories.find((c) => c.slug === (defaults?.categorySlug ?? 'personal'))?.id ?? null)
    setTags(target?.row.tags ?? [])
    setReminders(target?.row.reminder_minutes ?? [30])
  }, [open, target, defaults, reset, tz, settings.default_event_minutes, categories, base])

  const w = watch()
  const startIso = w.all_day ? (w.start_date ? zonedInstant(w.start_date, '00:00', tz) : null) : w.start ? new Date(fromInputDateTime(w.start, tz)!) : null
  const endIso = w.all_day ? (w.end_date ? zonedInstant(addDaysKey(w.end_date, 1), '00:00', tz) : null) : w.end ? new Date(fromInputDateTime(w.end, tz)!) : null

  // conflict detection against everything else on that day
  const dayKey = startIso ? fmt(startIso, tz, 'yyyy-MM-dd') : fmt(new Date(), tz, 'yyyy-MM-dd')
  const [dayFrom, dayTo] = useMemo(() => zonedDayBounds(dayKey, tz), [dayKey, tz])
  const feed = useCalendarFeed(dayFrom, dayTo, { tz, categories: categoryById, kinds: ['event', 'meeting', 'study', 'exam', 'task'] })
  const conflicts = useMemo(() => {
    if (!open || !startIso || !endIso || w.all_day) return []
    const ownKey = target ? (target.originalStart ? `e:${target.row.id}:${target.originalStart.toISOString()}` : `e:${target.row.id}`) : ''
    return conflictsWith({ start: startIso, end: endIso }, feed.items.filter((i) => !i.allDay && i.key !== ownKey && !(target && i.id === target.row.id && !i.master)).map((i) => ({ id: i.key, title: i.title, start: i.start, end: i.end })))
  }, [open, feed.items, startIso?.getTime(), endIso?.getTime(), w.all_day, target]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = handleSubmit(async (v) => {
    const start = v.all_day ? zonedInstant(v.start_date, '00:00', tz) : new Date(fromInputDateTime(v.start, tz)!)
    const end = v.all_day ? zonedInstant(addDaysKey(v.end_date, 1), '00:00', tz) : new Date(fromInputDateTime(v.end, tz)!)
    const rrule = v.repeat === 'custom' ? v.custom_rule!.replace(/^RRULE:/i, '').trim() : presetToRule(v.repeat as RepeatPreset, start, tz)
    const values = {
      title: v.title.trim(),
      all_day: v.all_day,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      timezone: tz,
      location: v.location?.trim() || null,
      meeting_url: safeUrl(v.meeting_url?.trim()) ?? null,
      description: v.description?.trim() || null,
      notes: v.notes?.trim() || null,
      priority: v.priority as Priority,
      category_id: categoryId,
      tags,
      reminder_minutes: reminders,
    }
    try {
      if (!target) {
        await createEvent({ ...values, rrule, client_key: clientKey })
        toast.success('Event created')
      } else if (isRecurringInstance) {
        await updateEvent(target, scope === 'this' ? values : { ...values, rrule }, scope)
        toast.success(scope === 'this' ? 'Occurrence updated' : scope === 'following' ? 'This and following updated' : 'Series updated')
      } else {
        await updateEvent(target, target.row.recurring_event_id ? values : { ...values, rrule })
        toast.success('Event updated')
      }
      await invalidate()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  const onDelete = async () => {
    if (!target) return
    const ok = await confirm({
      title: isRecurringInstance ? `Delete ${scope === 'this' ? 'this occurrence' : scope === 'following' ? 'this and following occurrences' : 'the entire series'}?` : 'Delete event?',
      message: `"${target.row.title}" will be removed from your calendar.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteEvent(target, isRecurringInstance ? scope : target.row.recurring_event_id ? 'this' : 'all')
      await invalidate()
      toast.success('Deleted')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const onDuplicate = async () => {
    if (!target) return
    await duplicateEvent({ ...(target.master ?? target.row), rrule: null, start_at: (target.start ?? new Date(target.row.start_at)).toISOString(), end_at: (target.end ?? new Date(target.row.end_at)).toISOString() })
    await invalidate()
    toast.success('Event duplicated')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? 'Edit event' : 'New event'}
      footer={
        <>
          {editing && (
            <div className="mr-auto flex gap-1">
              <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete event" title="Delete"><Trash2 className="h-4 w-4 text-danger" /></Button>
              <Button variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label="Duplicate event" title="Duplicate"><Copy className="h-4 w-4" /></Button>
              <WhatsAppShare iconOnly number={settings.whatsapp_number}
                text={`📅 ${target!.row.title}\n${fmt(target!.start ?? target!.row.start_at, tz, 'EEE d MMM')} · ${fmtRange(target!.start ?? target!.row.start_at, target!.end ?? target!.row.end_at, tz)}${target!.row.location ? `\n📍 ${target!.row.location}` : ''}${target!.row.meeting_url ? `\n🔗 ${target!.row.meeting_url}` : ''}`} />
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting}>{editing ? 'Save' : 'Create event'}</Button>
        </>
      }>
      {editing && (
        <Segmented className="mb-4" size="sm" value={tab} onChange={setTab} options={[
          { value: 'details', label: 'Details' }, { value: 'files', label: 'Attachments' }, { value: 'history', label: 'History' },
        ]} />
      )}
      {tab === 'files' && target && <Attachments entityType="event" entityId={(target.master ?? target.row).id} />}
      {tab === 'history' && target && <TaskHistory taskId={(target.master ?? target.row).id} entity="event" />}
      {tab === 'details' && (
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <button type="submit" hidden />
          {isRecurringInstance && (
            <div className="rounded-xl border border-primary/30 bg-primary-soft p-3 sm:col-span-2">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary-soft-fg"><Repeat className="h-4 w-4" /> Recurring event – apply changes to:</div>
              <Segmented size="sm" value={scope} onChange={setScope} options={[
                { value: 'this', label: 'This occurrence' }, { value: 'following', label: 'This & following' }, { value: 'all', label: 'All events' },
              ]} />
            </div>
          )}
          <Field label="Title" error={errors.title?.message} className="sm:col-span-2" htmlFor="e-title">
            <Input id="e-title" autoFocus placeholder="Add a title" {...register('title')} invalid={!!errors.title} />
          </Field>
          <div className="sm:col-span-2"><Switch checked={!!w.all_day} onChange={(v) => reset({ ...w, all_day: v })} label="All-day" /></div>
          {w.all_day ? (
            <>
              <Field label="Start date" htmlFor="e-sd"><Input id="e-sd" type="date" {...register('start_date')} /></Field>
              <Field label="End date" error={errors.end_date?.message} htmlFor="e-ed"><Input id="e-ed" type="date" {...register('end_date')} /></Field>
            </>
          ) : (
            <>
              <Field label="Starts" htmlFor="e-s"><Input id="e-s" type="datetime-local" {...register('start')} /></Field>
              <Field label="Ends" error={errors.end?.message} htmlFor="e-e"><Input id="e-e" type="datetime-local" {...register('end')} /></Field>
            </>
          )}
          {conflicts.length > 0 && (
            <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm sm:col-span-2" role="status">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <div>
                <div className="font-semibold">Overlaps with {conflicts.length} item{conflicts.length > 1 ? 's' : ''}</div>
                <ul className="text-xs text-muted">{conflicts.slice(0, 4).map((c) => <li key={c.id}>{c.title} · {fmtRange(c.start, c.end, tz)}</li>)}</ul>
              </div>
            </div>
          )}
          {(!isRecurringInstance || scope !== 'this') && !target?.row.recurring_event_id && (
            <>
              <Field label="Repeat" htmlFor="e-rep" hint={w.repeat === 'custom' ? describeRule(w.custom_rule || null) : undefined}>
                <Select id="e-rep" {...register('repeat')}>
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Every weekday (Mon–Fri)</option>
                  <option value="weekly">Weekly on this day</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom (RRULE)…</option>
                </Select>
              </Field>
              {w.repeat === 'custom' ? (
                <Field label="Custom rule" error={errors.custom_rule?.message} htmlFor="e-rr" hint="e.g. FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20271231T000000Z">
                  <Input id="e-rr" placeholder="FREQ=WEEKLY;BYDAY=MO,WE" {...register('custom_rule')} />
                </Field>
              ) : <div className="hidden sm:block" />}
            </>
          )}
          <Field label="Category" htmlFor="e-cat"><CategorySelect id="e-cat" value={categoryId} onChange={setCategoryId} /></Field>
          <Field label="Priority" htmlFor="e-pri">
            <Select id="e-pri" {...register('priority')}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          </Field>
          <Field label="Location" htmlFor="e-loc"><Input id="e-loc" placeholder="Office, address…" {...register('location')} /></Field>
          <Field label="Meeting link" error={errors.meeting_url?.message} htmlFor="e-url">
            <div className="relative"><Video className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-subtle" /><Input id="e-url" className="pl-9" placeholder="https://meet.google.com/…" {...register('meeting_url')} /></div>
          </Field>
          <Field label="Reminders" className="sm:col-span-2"><ReminderPicker value={reminders} onChange={setReminders} /></Field>
          <Field label="Tags" className="sm:col-span-2"><TagInput value={tags} onChange={setTags} /></Field>
          <Field label="Description" className="sm:col-span-2" htmlFor="e-desc"><Textarea id="e-desc" {...register('description')} /></Field>
          <Field label="Notes" className="sm:col-span-2" htmlFor="e-notes"><Textarea id="e-notes" rows={2} {...register('notes')} /></Field>
        </form>
      )}
    </Modal>
  )
}

function roundedNow() {
  const d = new Date()
  d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30, 0, 0)
  return d
}
