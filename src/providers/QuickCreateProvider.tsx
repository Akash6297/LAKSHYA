// One place that owns the create/edit modals so any screen (and keyboard
// shortcuts) can open them: Q quick add · T task · E event · Ctrl/Cmd+K search.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, CheckSquare, FolderPlus, StickyNote, Timer, Users } from 'lucide-react'
import { toast } from 'sonner'
import { TaskFormModal, type TaskDefaults } from '@/features/tasks/TaskFormModal'
import { MeetingFormModal } from '@/features/meetings/MeetingFormModal'
import { ProjectFormModal } from '@/features/projects/ProjectFormModal'
import { Modal } from '@/components/ui/Modal'
import { Kbd } from '@/components/ui/display'
import { isTypingTarget } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import type { EventTarget } from '@/features/calendar/EventFormModal'
import type { Meeting, Project, Task } from '@/types/db'

const EventFormModal = lazy(() => import('@/features/calendar/EventFormModal').then((m) => ({ default: m.EventFormModal })))
const CommandPalette = lazy(() => import('@/features/search/CommandPalette').then((m) => ({ default: m.CommandPalette })))

type EventDefaults = { start?: Date; end?: Date; allDay?: boolean; title?: string; categorySlug?: string }

interface QuickCtx {
  openTask: (task?: Task | null, defaults?: TaskDefaults) => void
  openEvent: (target?: EventTarget | null, defaults?: EventDefaults) => void
  openMeeting: (meeting?: Meeting | null, defaults?: { start?: Date; end?: Date }) => void
  openProject: (project?: Project | null) => void
  newNote: (link?: { project_id?: string; meeting_id?: string; task_id?: string; subject_id?: string; kind?: string }) => Promise<void>
  openQuickAdd: () => void
  openSearch: () => void
}

const Ctx = createContext<QuickCtx | null>(null)

export function QuickCreateProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [task, setTask] = useState<{ open: boolean; task?: Task | null; defaults?: TaskDefaults }>({ open: false })
  const [event, setEvent] = useState<{ open: boolean; target?: EventTarget | null; defaults?: EventDefaults }>({ open: false })
  const [meeting, setMeeting] = useState<{ open: boolean; meeting?: Meeting | null; defaults?: { start?: Date; end?: Date } }>({ open: false })
  const [project, setProject] = useState<{ open: boolean; project?: Project | null }>({ open: false })
  const [quickAdd, setQuickAdd] = useState(false)
  const [search, setSearch] = useState(false)

  const newNote = useCallback<QuickCtx['newNote']>(async (link) => {
    const { data, error } = await supabase.from('notes').insert({ title: 'Untitled', kind: link?.kind ?? 'quick', ...link }).select('id').single()
    if (error) return void toast.error(error.message)
    navigate(`/notes/${data.id}`)
  }, [navigate])

  const value: QuickCtx = {
    openTask: (t, d) => setTask({ open: true, task: t, defaults: d }),
    openEvent: (t, d) => setEvent({ open: true, target: t, defaults: d }),
    openMeeting: (m, d) => setMeeting({ open: true, meeting: m, defaults: d }),
    openProject: (p) => setProject({ open: true, project: p }),
    newNote,
    openQuickAdd: () => setQuickAdd(true),
    openSearch: () => setSearch(true),
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch(true)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return
      const k = e.key.toLowerCase()
      if (k === 'q') { e.preventDefault(); setQuickAdd(true) }
      else if (k === 't') { e.preventDefault(); setTask({ open: true }) }
      else if (k === 'e') { e.preventDefault(); setEvent({ open: true }) }
      else if (k === '/') { e.preventDefault(); setSearch(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const quickItems = [
    { icon: CheckSquare, label: 'Task', key: 'T', run: () => setTask({ open: true }) },
    { icon: CalendarPlus, label: 'Event', key: 'E', run: () => setEvent({ open: true }) },
    { icon: Users, label: 'Meeting', run: () => setMeeting({ open: true }) },
    { icon: FolderPlus, label: 'Project', run: () => setProject({ open: true }) },
    { icon: StickyNote, label: 'Note', run: () => void newNote() },
    { icon: Timer, label: 'Focus session', run: () => navigate('/focus') },
  ]

  return (
    <Ctx.Provider value={value}>
      {children}
      <TaskFormModal open={task.open} task={task.task} defaults={task.defaults} onClose={() => setTask({ open: false })} />
      {event.open && (
        <Suspense fallback={null}>
          <EventFormModal open target={event.target} defaults={event.defaults} onClose={() => setEvent({ open: false })} />
        </Suspense>
      )}
      <MeetingFormModal open={meeting.open} meeting={meeting.meeting} defaults={meeting.defaults} onClose={() => setMeeting({ open: false })} />
      <ProjectFormModal open={project.open} project={project.project} onClose={() => setProject({ open: false })} />
      {search && <Suspense fallback={null}><CommandPalette open onClose={() => setSearch(false)} /></Suspense>}
      <Modal open={quickAdd} onClose={() => setQuickAdd(false)} title="Quick add" size="sm">
        <div className="grid grid-cols-2 gap-2">
          {quickItems.map((q) => (
            <button key={q.label} onClick={() => { setQuickAdd(false); q.run() }}
              className="flex items-center gap-3 rounded-xl border border-line p-3 text-left text-sm font-semibold transition hover:border-primary hover:bg-primary-soft">
              <q.icon className="h-5 w-5 text-primary" />
              <span className="flex-1">{q.label}</span>
              {q.key && <Kbd>{q.key}</Kbd>}
            </button>
          ))}
        </div>
      </Modal>
    </Ctx.Provider>
  )
}

export function useQuickCreate() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useQuickCreate outside QuickCreateProvider')
  return c
}
