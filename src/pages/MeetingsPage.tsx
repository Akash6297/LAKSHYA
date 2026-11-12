import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, ListChecks, Pencil, Plus, Users, Video } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, Card, PageHeader, Segmented } from '@/components/ui/display'
import { Textarea } from '@/components/ui/form'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback'
import { TaskItem } from '@/features/tasks/TaskItem'
import { WhatsAppShare } from '@/features/notifications/WhatsAppShare'
import { platformMeta } from '@/lib/constants'
import { dayLabel, fmt, fmtRange, localDateKey } from '@/lib/dates'
import { cn, safeUrl } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useCrud, useRows } from '@/services/resource'
import { useTasks } from '@/services/tasks'
import type { Meeting, MeetingParticipant } from '@/types/db'

export default function MeetingsPage() {
  const { tz, h24 } = useAppData()
  const { openMeeting } = useQuickCreate()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming')
  const [selected, setSelected] = useState<string | null>(params.get('meeting'))
  const nowIso = new Date().toISOString()
  const list = useRows('meetings', [tab], (q) => (tab === 'upcoming' ? q.gte('end_at', nowIso).order('start_at') : q.lt('end_at', nowIso).order('start_at', { ascending: false })).limit(200))
  const rows = (list.data ?? []) as Meeting[]

  useEffect(() => {
    const id = params.get('meeting')
    if (id) { setSelected(id); setParams({}, { replace: true }) }
  }, [params, setParams])

  useEffect(() => {
    if (!selected && rows.length && window.innerWidth >= 1024) setSelected(rows[0].id)
  }, [rows, selected])

  const current = useRows('meetings', ['one', selected], (q) => q.eq('id', selected), { enabled: !!selected })
  const meeting = ((current.data ?? []) as Meeting[])[0]

  return (
    <div>
      <PageHeader title="Meetings" subtitle="Agendas, notes and follow-ups in one place." actions={<Button onClick={() => openMeeting()} icon={<Plus className="h-4 w-4" />}>Schedule meeting</Button>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className={cn(selected && 'hidden lg:block')}>
          <Segmented className="mb-3" value={tab} onChange={(t) => { setTab(t); setSelected(null) }} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'history', label: 'History' }]} />
          {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <ListSkeleton /> : rows.length ? (
            <ul className="space-y-2">
              {rows.map((m) => {
                const p = platformMeta(m.platform)
                const live = new Date(m.start_at) <= new Date() && new Date(m.end_at) > new Date()
                return (
                  <li key={m.id}>
                    <button onClick={() => setSelected(m.id)} className={cn('card w-full p-3 text-left transition hover:border-primary', selected === m.id && 'border-primary ring-2 ring-ring')}>
                      <div className="flex items-center gap-2"><span className="truncate font-semibold">{m.title}</span>{live && <Badge color="#EF4444">Live</Badge>}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                        <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />{dayLabel(localDateKey(new Date(m.start_at), tz), tz)} · {fmtRange(m.start_at, m.end_at, tz, h24)}</span>
                        <span style={{ color: p.color }} className="font-semibold">{p.label}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : <EmptyState art="calendar" title={tab === 'upcoming' ? 'No upcoming meetings' : 'No past meetings'} action={tab === 'upcoming' ? <Button size="sm" onClick={() => openMeeting()}>Schedule one</Button> : undefined} />}
        </div>
        <div className={cn(!selected && 'hidden lg:block')}>
          {meeting ? <MeetingDetail meeting={meeting} onBack={() => setSelected(null)} /> : <div className="card"><EmptyState art="inbox" title="Select a meeting" /></div>}
        </div>
      </div>
    </div>
  )
}

function MeetingDetail({ meeting, onBack }: { meeting: Meeting; onBack: () => void }) {
  const { tz, h24, settings } = useAppData()
  const { openMeeting, openTask } = useQuickCreate()
  const { update } = useCrud('meetings')
  const people = useRows('meeting_participants', [meeting.id], (q) => q.eq('meeting_id', meeting.id).order('created_at'))
  const followUps = useTasks(['meeting', meeting.id], (q) => q.eq('meeting_id', meeting.id).order('created_at'))
  const [notes, setNotes] = useState(meeting.notes ?? '')
  const [status, setStatus] = useState('')
  const dirty = useRef(false)
  const url = safeUrl(meeting.meeting_url)
  const p = platformMeta(meeting.platform)
  const past = new Date(meeting.end_at) < new Date()

  useEffect(() => { setNotes(meeting.notes ?? ''); dirty.current = false; setStatus('') }, [meeting.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty.current) return
    setStatus('Saving…')
    const t = setTimeout(() => update.mutate({ id: meeting.id, notes }, { onSuccess: () => setStatus('Saved'), onError: () => setStatus('Not saved') }), 900)
    return () => clearTimeout(t)
  }, [notes]) // eslint-disable-line react-hooks/exhaustive-deps

  const summary = `🤝 ${meeting.title}\n${fmt(meeting.start_at, tz, 'EEE d MMM')} · ${fmtRange(meeting.start_at, meeting.end_at, tz, h24)}${url ? `\n${url}` : ''}${meeting.agenda ? `\n\nAgenda:\n${meeting.agenda}` : ''}`

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm font-semibold text-muted lg:hidden">← All meetings</button>
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold">{meeting.title}</h2>
            <div className="mt-1 text-sm text-muted">{fmt(meeting.start_at, tz, 'EEEE, d MMMM yyyy')} · {fmtRange(meeting.start_at, meeting.end_at, tz, h24)}</div>
            <div className="mt-2 flex flex-wrap gap-2"><Badge color={p.color}>{p.label}</Badge>{meeting.attended === true && <Badge color="#10B981">Attended</Badge>}{meeting.attended === false && <Badge>Missed</Badge>}</div>
          </div>
          <div className="flex gap-2">
            {url && !past && <a href={url} target="_blank" rel="noopener noreferrer"><Button icon={<Video className="h-4 w-4" />}>Join</Button></a>}
            <WhatsAppShare iconOnly text={summary} number={settings.whatsapp_number} />
            <Button variant="outline" size="icon" onClick={() => openMeeting(meeting)} aria-label="Edit meeting"><Pencil className="h-4 w-4" /></Button>
          </div>
        </div>
        {past && meeting.attended == null && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
            <span className="flex-1">Did this meeting happen?</span>
            <Button size="sm" variant="soft" onClick={() => update.mutate({ id: meeting.id, attended: true })}>Attended</Button>
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: meeting.id, attended: false })}>Missed</Button>
          </div>
        )}
        {meeting.agenda && <div className="mt-4"><div className="label">Agenda</div><p className="text-sm whitespace-pre-wrap">{meeting.agenda}</p></div>}
        {meeting.description && <div className="mt-4"><div className="label">Description</div><p className="text-sm whitespace-pre-wrap text-muted">{meeting.description}</p></div>}
        {((people.data ?? []) as MeetingParticipant[]).length > 0 && (
          <div className="mt-4"><div className="label flex items-center gap-1"><Users className="h-3 w-3" /> Participants</div>
            <div className="flex flex-wrap gap-1.5">{((people.data ?? []) as MeetingParticipant[]).map((x) => <span key={x.id} className="chip bg-surface-2 py-1 text-fg" title={x.email ?? undefined}>{x.name}</span>)}</div>
          </div>
        )}
      </Card>
      <Card title="Meeting notes" action={<span className="text-[11px] font-semibold text-subtle">{status}</span>}>
        <Textarea rows={8} value={notes} onChange={(e) => { dirty.current = true; setNotes(e.target.value) }} placeholder="Decisions, discussion points, action items…" aria-label="Meeting notes" />
      </Card>
      <Card title="Follow-up tasks" icon={<ListChecks className="h-4 w-4" />} action={<Button size="sm" variant="soft" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => openTask(null, { meeting_id: meeting.id, project_id: meeting.project_id, title: '' })}>Add</Button>}>
        {(followUps.data ?? []).length ? <ul>{(followUps.data ?? []).map((t) => <li key={t.id}><TaskItem task={t} /></li>)}</ul> : <EmptyState compact title="No follow-ups yet" description="Create tasks linked to this meeting – they get reminders like any task." />}
      </Card>
    </div>
  )
}
