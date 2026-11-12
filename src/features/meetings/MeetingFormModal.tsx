import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { ReminderPicker } from '@/components/ui/pickers'
import { PLATFORMS, detectPlatform } from '@/lib/constants'
import { fmtRange, fromInputDateTime, toInputDateTime } from '@/lib/dates'
import { safeUrl } from '@/lib/utils'
import { supabase, unwrap } from '@/lib/supabase'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useCrud, useRows } from '@/services/resource'
import { useInvalidateCalendar } from '@/services/calendar'
import { WhatsAppShare } from '@/features/notifications/WhatsAppShare'
import type { Meeting, MeetingParticipant, MeetingPlatform } from '@/types/db'

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  start: z.string().min(1, 'Required'),
  end: z.string().min(1, 'Required'),
  platform: z.enum(['google_meet', 'zoom', 'teams', 'in_person', 'phone', 'other']),
  meeting_url: z.string().max(500).optional().refine((v) => !v || !!safeUrl(v), 'Enter a valid https:// link'),
  agenda: z.string().max(10000).optional(),
  description: z.string().max(10000).optional(),
}).refine((v) => v.end > v.start, { message: 'End must be after start', path: ['end'] })
type FormValues = z.infer<typeof schema>

export function MeetingFormModal({ open, onClose, meeting, defaults }: { open: boolean; onClose: () => void; meeting?: Meeting | null; defaults?: { start?: Date; end?: Date } }) {
  const { tz, settings } = useAppData()
  const confirm = useConfirm()
  const invalidate = useInvalidateCalendar()
  const { create, update, remove } = useCrud('meetings')
  const [reminders, setReminders] = useState<number[]>([30, 1440])
  const [people, setPeople] = useState<{ id?: string; name: string; email: string }[]>([])
  const existing = useRows('meeting_participants', [meeting?.id], (q) => q.eq('meeting_id', meeting!.id).order('created_at'), { enabled: !!meeting })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    const s = meeting ? new Date(meeting.start_at) : defaults?.start ?? nextHalfHour()
    const e = meeting ? new Date(meeting.end_at) : defaults?.end ?? new Date(s.getTime() + 30 * 60_000)
    reset({
      title: meeting?.title ?? '',
      start: toInputDateTime(s, tz),
      end: toInputDateTime(e, tz),
      platform: meeting?.platform ?? 'google_meet',
      meeting_url: meeting?.meeting_url ?? '',
      agenda: meeting?.agenda ?? '',
      description: meeting?.description ?? '',
    })
    setReminders(meeting?.reminder_minutes ?? [30, 1440])
  }, [open, meeting, defaults, reset, tz])

  useEffect(() => {
    if (open) setPeople(((existing.data ?? []) as MeetingParticipant[]).map((p) => ({ id: p.id, name: p.name, email: p.email ?? '' })))
  }, [open, existing.data])

  const onSubmit = handleSubmit(async (v) => {
    const payload = {
      title: v.title.trim(),
      start_at: fromInputDateTime(v.start, tz)!,
      end_at: fromInputDateTime(v.end, tz)!,
      platform: v.platform as MeetingPlatform,
      meeting_url: safeUrl(v.meeting_url?.trim()) ?? null,
      agenda: v.agenda?.trim() || null,
      description: v.description?.trim() || null,
      reminder_minutes: reminders,
    }
    const saved = meeting ? await update.mutateAsync({ id: meeting.id, ...payload }) : await create.mutateAsync(payload)
    // sync participants: replace the set
    const valid = people.filter((p) => p.name.trim())
    if (meeting) unwrap(await supabase.from('meeting_participants').delete().eq('meeting_id', saved.id))
    if (valid.length) {
      unwrap(await supabase.from('meeting_participants').insert(valid.map((p) => ({ meeting_id: saved.id, name: p.name.trim().slice(0, 120), email: p.email.trim() || null }))))
    }
    await invalidate()
    void existing.refetch()
    toast.success(meeting ? 'Meeting updated' : 'Meeting scheduled')
    onClose()
  })

  const onDelete = async () => {
    if (meeting && await confirm({ title: 'Delete meeting?', message: 'Notes and participants will be deleted. Follow-up tasks are kept.', confirmLabel: 'Delete', danger: true })) {
      await remove.mutateAsync(meeting.id)
      await invalidate()
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={meeting ? 'Edit meeting' : 'Schedule meeting'}
      footer={<>
        {meeting && (
          <div className="mr-auto flex gap-1">
            <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete meeting"><Trash2 className="h-4 w-4 text-danger" /></Button>
            <WhatsAppShare iconOnly number={settings.whatsapp_number} text={`🤝 ${meeting.title}\n${fmtRange(meeting.start_at, meeting.end_at, tz)}${meeting.meeting_url ? `\n${meeting.meeting_url}` : ''}`} />
          </div>
        )}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={onSubmit} loading={isSubmitting}>{meeting ? 'Save' : 'Schedule'}</Button>
      </>}>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <button type="submit" hidden />
        <Field label="Title" error={errors.title?.message} className="sm:col-span-2" htmlFor="m-title"><Input id="m-title" autoFocus {...register('title')} /></Field>
        <Field label="Starts" htmlFor="m-s"><Input id="m-s" type="datetime-local" {...register('start')} /></Field>
        <Field label="Ends" error={errors.end?.message} htmlFor="m-e"><Input id="m-e" type="datetime-local" {...register('end')} /></Field>
        <Field label="Platform" htmlFor="m-p"><Select id="m-p" {...register('platform')}>{PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        <Field label="Meeting URL" error={errors.meeting_url?.message} htmlFor="m-url">
          <Input id="m-url" placeholder="Paste Meet / Zoom / Teams link" {...register('meeting_url', {
            onChange: (e) => { const p = detectPlatform(e.target.value); if (p) setValue('platform', p) },
          })} />
        </Field>
        <Field label="Participants" className="sm:col-span-2">
          <div className="space-y-2">
            {people.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="Name" value={p.name} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Participant name" />
                <Input placeholder="Email (optional)" type="email" value={p.email} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} aria-label="Participant email" />
                <Button variant="ghost" size="icon" onClick={() => setPeople(people.filter((_, j) => j !== i))} aria-label="Remove participant"><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setPeople([...people, { name: '', email: '' }])}>Add participant</Button>
          </div>
        </Field>
        <Field label="Agenda" className="sm:col-span-2" htmlFor="m-ag"><Textarea id="m-ag" rows={3} placeholder="1. …" {...register('agenda')} /></Field>
        <Field label="Description" className="sm:col-span-2" htmlFor="m-d"><Textarea id="m-d" rows={2} {...register('description')} /></Field>
        <Field label="Reminders" className="sm:col-span-2"><ReminderPicker value={reminders} onChange={setReminders} /></Field>
      </form>
    </Modal>
  )
}

function nextHalfHour() {
  const d = new Date()
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 30) * 30, 0, 0)
  return d
}
