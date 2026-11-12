import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CalendarDays, CheckSquare, FolderKanban, Loader2, Search, StickyNote, Target, Users } from 'lucide-react'
import { supabase, unwrap } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { fmt } from '@/lib/dates'
import { useAppData } from '@/providers/AppDataProvider'
import { NAV_ITEMS } from '@/layouts/nav'
import { Kbd } from '@/components/ui/display'

type Kind = 'task' | 'event' | 'project' | 'meeting' | 'note' | 'goal' | 'subject'
interface Hit { kind: Kind; id: string; title: string; subtitle: string | null; at: string | null }

const KINDS: { value: Kind | 'all'; label: string; icon: typeof Search }[] = [
  { value: 'all', label: 'All', icon: Search },
  { value: 'task', label: 'Tasks', icon: CheckSquare },
  { value: 'event', label: 'Events', icon: CalendarDays },
  { value: 'project', label: 'Projects', icon: FolderKanban },
  { value: 'meeting', label: 'Meetings', icon: Users },
  { value: 'note', label: 'Notes', icon: StickyNote },
  { value: 'goal', label: 'Goals', icon: Target },
  { value: 'subject', label: 'Subjects', icon: BookOpen },
]
const iconFor = (k: Kind) => KINDS.find((x) => x.value === k)!.icon

function linkFor(h: Hit): string {
  switch (h.kind) {
    case 'task': return `/tasks?task=${h.id}`
    case 'event': return `/calendar?event=${h.id}`
    case 'project': return `/projects/${h.id}`
    case 'meeting': return `/meetings?meeting=${h.id}`
    case 'note': return `/notes/${h.id}`
    case 'goal': return '/goals'
    case 'subject': return '/study'
  }
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { tz } = useAppData()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10)
  }, [open])

  const search = useQuery({
    queryKey: ['search', debounced],
    enabled: debounced.length >= 2,
    staleTime: 10_000,
    queryFn: async () => unwrap(await supabase.rpc('global_search', { q: debounced, p_limit: 8 })) as Hit[],
  })

  const nav = useMemo(() => NAV_ITEMS.filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 4 : 13), [q])
  const hits = (search.data ?? []).filter((h) => kind === 'all' || h.kind === kind)
  const entries: { key: string; label: string; sub?: string; icon: typeof Search; go: () => void }[] = [
    ...hits.map((h) => ({ key: `${h.kind}:${h.id}`, label: h.title, sub: [h.kind, h.subtitle, h.at ? fmt(h.at, tz, 'd MMM yyyy') : null].filter(Boolean).join(' · '), icon: iconFor(h.kind), go: () => navigate(linkFor(h)) })),
    ...(kind === 'all' ? nav.map((n) => ({ key: `nav:${n.to}`, label: `Go to ${n.label}`, icon: n.icon, go: () => navigate(n.to) })) : []),
  ]

  useEffect(() => setActive(0), [debounced, kind])

  if (!open) return null
  const choose = (i: number) => {
    entries[i]?.go()
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[10vh]" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Search" className="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose() }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, entries.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); choose(active) }
        }}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          {search.isFetching ? <Loader2 className="h-5 w-5 animate-spin text-muted" /> : <Search className="h-5 w-5 text-muted" />}
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, events, projects, notes…"
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-subtle" aria-label="Search query"
            role="combobox" aria-expanded aria-controls="search-results" aria-activedescendant={entries[active] ? `sr-${active}` : undefined} />
          <Kbd>Esc</Kbd>
        </div>
        <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
          {KINDS.map((k) => (
            <button key={k.value} onClick={() => setKind(k.value)}
              className={cn('chip shrink-0 px-2.5 py-1', kind === k.value ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted hover:text-fg')}>
              {k.label}
            </button>
          ))}
        </div>
        <ul id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {debounced.length >= 2 && !search.isFetching && hits.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">No results for “{debounced}”</li>
          )}
          {entries.map((e, i) => (
            <li key={e.key} id={`sr-${i}`} role="option" aria-selected={i === active}>
              <button onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i === active && 'bg-surface-2')}>
                <e.icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{e.label}</span>
                  {e.sub && <span className="block truncate text-xs text-muted capitalize">{e.sub.replace(/_/g, ' ')}</span>}
                </span>
                {i === active && <ArrowRight className="h-4 w-4 text-muted" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
