import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ArrowLeft, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, PageHeader, Segmented } from '@/components/ui/display'
import { Input, Select } from '@/components/ui/form'
import { TagInput } from '@/components/ui/pickers'
import { EmptyState, ErrorState, FullPageLoader, ListSkeleton } from '@/components/ui/feedback'
import { fmt, fromNow } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { supabase, unwrap } from '@/lib/supabase'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useRow, useRows } from '@/services/resource'
import type { Note } from '@/types/db'

const RichEditor = lazy(() => import('@/features/notes/RichEditor').then((m) => ({ default: m.RichEditor })))

const KINDS: { value: Note['kind']; label: string }[] = [
  { value: 'quick', label: 'Quick' }, { value: 'personal', label: 'Personal' }, { value: 'meeting', label: 'Meeting' },
  { value: 'project', label: 'Project' }, { value: 'study', label: 'Study' },
]

export default function NotesPage() {
  const { id } = useParams<{ id: string }>()
  const { newNote } = useQuickCreate()
  const { tz } = useAppData()
  const [q, setQ] = useState('')
  const [view, setView] = useState<'active' | 'archived'>('active')
  const [kind, setKind] = useState('')
  const notes = useRows('notes', ['list', view], (qb) => qb.eq('is_archived', view === 'archived').order('is_pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(500),
    { select: 'id,title,content_text,kind,tags,is_pinned,is_archived,updated_at,created_at,user_id,content_html,task_id,project_id,event_id,meeting_id,subject_id' })
  const term = q.trim().toLowerCase()
  const rows = ((notes.data ?? []) as Note[]).filter((n) => (!kind || n.kind === kind) && (!term || `${n.title} ${n.content_text} ${n.tags.join(' ')}`.toLowerCase().includes(term.replace(/^#/, ''))))

  return (
    <div>
      {!id && <PageHeader title="Notes" subtitle="Capture ideas, meeting minutes and study notes." actions={<Button onClick={() => void newNote({ kind: 'personal' })} icon={<Plus className="h-4 w-4" />}>New note</Button>} />}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <aside className={cn('space-y-3', id && 'hidden lg:block')}>
          <div className="relative"><Search className="absolute top-3 left-3 h-4 w-4 text-subtle" /><Input className="pl-9" placeholder="Search notes or #tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" /></div>
          <div className="flex gap-2">
            <Segmented size="sm" className="shrink-0" value={view} onChange={setView} options={[{ value: 'active', label: 'Notes' }, { value: 'archived', label: 'Archive' }]} />
            <Select className="h-9 min-w-0 flex-1 py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Note type"><option value="">All types</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
          </div>
          {notes.error ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : notes.isLoading ? <ListSkeleton /> : rows.length ? (
            <ul className="space-y-1.5">
              {rows.map((n) => (
                <li key={n.id}>
                  <Link to={`/notes/${n.id}`} className={cn('block rounded-xl border p-3 transition hover:border-primary', n.id === id ? 'border-primary bg-primary-soft' : 'border-line bg-surface')}>
                    <div className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{n.title || 'Untitled'}</span>{n.is_pinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted">{n.content_text || 'Empty note'}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-subtle"><span className="capitalize">{n.kind}</span>·<span>{fmt(n.updated_at, tz, 'd MMM')}</span>{n.tags.slice(0, 2).map((t) => <span key={t}>#{t}</span>)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState compact art="notes" title={term ? 'No matching notes' : 'No notes yet'} />}
        </aside>
        <section className={cn(!id && 'hidden lg:block')}>
          {id ? <NoteEditor key={id} id={id} /> : <div className="card"><EmptyState art="notes" title="Select or create a note" action={<Button onClick={() => void newNote({ kind: 'personal' })}>New note</Button>} /></div>}
        </section>
      </div>
    </div>
  )
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

function NoteEditor({ id }: { id: string }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const note = useRow('notes', id)
  const [draft, setDraft] = useState<Partial<Note> | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const pending = useRef<Partial<Note>>({})
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const links = useRows('projects', ['names'], undefined, { select: 'id,title' })
  const subjects = useRows('subjects', ['all'], (q) => q.eq('archived', false).order('name'))

  useEffect(() => { if (note.data && !draft) setDraft(note.data as Note) }, [note.data, draft])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const patch = pending.current
    if (!Object.keys(patch).length) return
    pending.current = {}
    setState('saving')
    try {
      unwrap(await supabase.from('notes').update(patch).eq('id', id))
      setState(Object.keys(pending.current).length ? 'dirty' : 'saved')
      void qc.invalidateQueries({ queryKey: ['notes', 'list'] })
    } catch {
      pending.current = { ...patch, ...pending.current } // keep for retry
      setState('error')
      timer.current = setTimeout(() => void flush(), 5000)
    }
  }, [id, qc])

  const change = (patch: Partial<Note>) => {
    setDraft((d) => ({ ...d, ...patch }))
    pending.current = { ...pending.current, ...patch }
    setState('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 900)
  }

  // save on unmount / tab close
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length) { void flush(); e.preventDefault() } }
    window.addEventListener('beforeunload', before)
    return () => { window.removeEventListener('beforeunload', before); void flush() }
  }, [flush])

  if (note.isLoading || (!draft && note.data)) return <FullPageLoader />
  if (!note.data || !draft) return <EmptyState title="Note not found" action={<Link to="/notes"><Button>Back</Button></Link>} />

  const del = async () => {
    if (await confirm({ title: 'Delete note?', message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' })) {
      pending.current = {}
      unwrap(await supabase.from('notes').delete().eq('id', id))
      void qc.invalidateQueries({ queryKey: ['notes'] })
      navigate('/notes')
    }
  }

  const label: Record<SaveState, string> = { saved: `Saved ${fromNow((note.data as Note).updated_at)}`, dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Save failed – retrying' }

  return (
    <div className="card p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link to="/notes" className="mr-1 text-muted lg:hidden" aria-label="Back to notes"><ArrowLeft className="h-5 w-5" /></Link>
        <span className={cn('text-xs font-semibold', state === 'error' ? 'text-danger' : state === 'saved' ? 'text-success' : 'text-muted')} role="status" aria-live="polite">{state === 'saved' ? '✓ ' : ''}{label[state]}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => change({ is_pinned: !draft.is_pinned })} aria-label={draft.is_pinned ? 'Unpin' : 'Pin'}>{draft.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button>
          <Button variant="ghost" size="icon-sm" onClick={() => change({ is_archived: !draft.is_archived })} aria-label={draft.is_archived ? 'Unarchive' : 'Archive'}>{draft.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void del()} aria-label="Delete note"><Trash2 className="h-4 w-4 text-danger" /></Button>
        </div>
      </div>
      <input value={draft.title ?? ''} onChange={(e) => change({ title: e.target.value.slice(0, 300) })} placeholder="Untitled"
        className="mb-3 w-full bg-transparent text-2xl font-extrabold tracking-tight outline-none placeholder:text-subtle" aria-label="Note title" />
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Select value={draft.kind} onChange={(e) => change({ kind: e.target.value as Note['kind'] })} aria-label="Note type">{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label} note</option>)}</Select>
        <Select value={draft.project_id ?? ''} onChange={(e) => change({ project_id: e.target.value || null })} aria-label="Linked project">
          <option value="">No linked project</option>{((links.data ?? []) as { id: string; title: string }[]).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
        <Select value={draft.subject_id ?? ''} onChange={(e) => change({ subject_id: e.target.value || null })} aria-label="Linked subject">
          <option value="">No linked subject</option>{((subjects.data ?? []) as { id: string; name: string }[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <div className="sm:col-span-3"><TagInput value={draft.tags ?? []} onChange={(t) => change({ tags: t })} /></div>
        {(draft.task_id || draft.meeting_id || draft.event_id) && (
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            {draft.task_id && <Link to={`/tasks?task=${draft.task_id}`}><Badge color="#8B5CF6">Linked task</Badge></Link>}
            {draft.meeting_id && <Link to={`/meetings?meeting=${draft.meeting_id}`}><Badge color="#14B8A6">Linked meeting</Badge></Link>}
            {draft.event_id && <Link to={`/calendar?event=${draft.event_id}`}><Badge color="#6366F1">Linked event</Badge></Link>}
          </div>
        )}
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <RichEditor docKey={id} html={(note.data as Note).content_html} onChange={(html, text) => change({ content_html: html, content_text: text.slice(0, 200000) })} />
      </Suspense>
    </div>
  )
}
