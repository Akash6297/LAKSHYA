import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import multiMonthPlugin from '@fullcalendar/multimonth'
import interactionPlugin from '@fullcalendar/interaction'
import { ChevronLeft, ChevronRight, Filter, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/display'
import { ErrorState } from '@/components/ui/feedback'
import { TimelineView } from '@/features/calendar/TimelineView'
import { useOpenItem } from '@/features/calendar/AgendaList'
import { addDaysKey, fmt, localDateKey, todayKey } from '@/lib/dates'
import { fromWallClock, toWallClock } from '@shared/time.ts'
import { supabase, unwrap } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { kindColor, updateEvent, useCalendarFeed, useInvalidateCalendar, type CalendarItem, type ItemKind } from '@/services/calendar'
import { useTaskActions } from '@/services/tasks'
import type { EventRow, Task } from '@/types/db'

type View = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth' | 'multiMonthYear' | 'listMonth' | 'timeline'
const VIEWS: { value: View; label: string }[] = [
  { value: 'timeGridDay', label: 'Day' }, { value: 'timeGridWeek', label: 'Week' }, { value: 'dayGridMonth', label: 'Month' },
  { value: 'multiMonthYear', label: 'Year' }, { value: 'listMonth', label: 'Agenda' }, { value: 'timeline', label: 'Timeline' },
]
const ALL_KINDS: { kind: ItemKind; label: string }[] = [
  { kind: 'event', label: 'Events' }, { kind: 'task', label: 'Tasks' }, { kind: 'meeting', label: 'Meetings' }, { kind: 'study', label: 'Study' },
  { kind: 'exam', label: 'Exams' }, { kind: 'deadline', label: 'Deadlines' }, { kind: 'timeoff', label: 'Leave' },
]
const KINDS_KEY = 'lakshya-cal-kinds'

export default function CalendarPage() {
  const { tz, h24, settings, categoryById, categories } = useAppData()
  const { openEvent } = useQuickCreate()
  const openItem = useOpenItem()
  const confirm = useConfirm()
  const invalidate = useInvalidateCalendar()
  const { update: updateTask } = useTaskActions()
  const cal = useRef<FullCalendar>(null)
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'timeGridDay' : (settings.default_calendar_view as View) || 'timeGridWeek'))
  const [title, setTitle] = useState('')
  const [range, setRange] = useState<{ from: Date; to: Date }>(() => {
    const t = todayKey(tz)
    return { from: new Date(t + 'T00:00:00Z'), to: new Date(addDaysKey(t, 7) + 'T00:00:00Z') }
  })
  const [timelineStart, setTimelineStart] = useState(() => todayKey(tz))
  const [kinds, setKinds] = useState<ItemKind[]>(() => {
    try { return JSON.parse(localStorage.getItem(KINDS_KEY) ?? '') } catch { return ALL_KINDS.map((k) => k.kind) }
  })
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => { try { localStorage.setItem(KINDS_KEY, JSON.stringify(kinds)) } catch { /* ignore */ } }, [kinds])

  // FullCalendar runs in UTC with wall-clock dates, so the visible range is wall-clock too
  const queryFrom = view === 'timeline' ? fromWallClock(new Date(timelineStart + 'T00:00:00Z'), tz) : fromWallClock(range.from, tz)
  const queryTo = view === 'timeline' ? fromWallClock(new Date(addDaysKey(timelineStart, 14) + 'T00:00:00Z'), tz) : fromWallClock(range.to, tz)
  const feed = useCalendarFeed(queryFrom, queryTo, { tz, categories: categoryById, kinds })

  // deep link: /calendar?event=<id>
  useEffect(() => {
    const id = params.get('event')
    if (!id) return
    void (async () => {
      const { data } = await supabase.from('events').select('*').eq('id', id).maybeSingle()
      if (data) openEvent({ row: data as EventRow, master: (data as EventRow).rrule ? (data as EventRow) : undefined, originalStart: (data as EventRow).rrule ? new Date(data.start_at) : undefined })
      setParams({}, { replace: true })
    })()
  }, [params, setParams, openEvent])

  const events: EventInput[] = useMemo(() => feed.items.map((i) => ({
    id: i.key,
    title: i.title,
    start: i.allDay ? localDateKey(i.start, tz) : toWallClock(i.start, tz),
    end: i.allDay ? localDateKey(new Date(i.end.getTime() - 1), tz) + 'T24:00:00' : toWallClock(i.end, tz),
    allDay: i.allDay,
    backgroundColor: i.color,
    borderColor: i.color,
    textColor: '#fff',
    editable: (i.kind === 'event' || i.kind === 'meeting' || (i.kind === 'task' && !i.allDay)),
    durationEditable: !i.allDay && (i.kind === 'event' || i.kind === 'meeting' || i.kind === 'task'),
    classNames: [i.done ? 'lk-done' : '', `lk-${i.kind}`],
    extendedProps: { item: i },
  })), [feed.items, tz])

  const api = () => cal.current?.getApi()
  const changeView = (v: View) => {
    setView(v)
    if (v !== 'timeline') setTimeout(() => api()?.changeView(v), 0)
  }
  const nav = (dir: -1 | 0 | 1) => {
    if (view === 'timeline') return setTimelineStart(dir === 0 ? todayKey(tz) : addDaysKey(timelineStart, dir * 7))
    if (dir === 0) {
      api()?.gotoDate(toWallClock(new Date(), tz))
    } else if (dir === -1) {
      api()?.prev()
    } else {
      api()?.next()
    }
  }

  const persistMove = async (item: CalendarItem, start: Date, end: Date, revert: () => void) => {
    const s = fromWallClock(start, tz), e = fromWallClock(end, tz)
    try {
      if (item.kind === 'event') {
        let scope: 'this' | 'all' = 'all'
        if (item.master) {
          const onlyThis = await confirm({ title: 'Move recurring event', message: 'Move only this occurrence? (Edit the event to change the whole series.)', confirmLabel: 'Move this occurrence' })
          if (!onlyThis) return revert()
          scope = 'this'
        }
        await updateEvent({ row: item.row as EventRow, master: item.master, originalStart: item.master ? item.originalStart : undefined }, { start_at: s.toISOString(), end_at: e.toISOString() }, scope)
      } else if (item.kind === 'meeting') {
        unwrap(await supabase.from('meetings').update({ start_at: s.toISOString(), end_at: e.toISOString() }).eq('id', item.id))
      } else if (item.kind === 'task') {
        const t = item.row as Task
        await updateTask.mutateAsync({ id: t.id, base: t, patch: { start_at: s.toISOString(), end_at: e.toISOString() } })
      }
      await invalidate()
      toast.success('Rescheduled')
    } catch (err) {
      revert()
      toast.error((err as Error).message)
    }
  }

  const onDrop = (a: EventDropArg | EventResizeDoneArg) => {
    const item = a.event.extendedProps.item as CalendarItem
    void persistMove(item, a.event.start!, a.event.end ?? new Date(a.event.start!.getTime() + (item.end.getTime() - item.start.getTime())), a.revert)
  }

  const onSelect = (s: DateSelectArg) => {
    api()?.unselect()
    openEvent(null, s.allDay
      ? { start: fromWallClock(s.start, tz), end: fromWallClock(s.end, tz), allDay: true }
      : { start: fromWallClock(s.start, tz), end: fromWallClock(s.end, tz) })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => nav(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => nav(0)}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => nav(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
          <h1 className="ml-2 truncate text-xl font-extrabold tracking-tight sm:text-2xl">
            {view === 'timeline' ? `${fmt(timelineStart + 'T12:00:00Z', 'UTC', 'd MMM')} – ${fmt(addDaysKey(timelineStart, 13) + 'T12:00:00Z', 'UTC', 'd MMM yyyy')}` : title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={view} onChange={changeView} options={VIEWS} size="sm" />
          <Button variant={showFilters ? 'soft' : 'outline'} size="icon" onClick={() => setShowFilters(!showFilters)} aria-label="Filters" aria-expanded={showFilters}><Filter className="h-4 w-4" /></Button>
          <Button onClick={() => openEvent()} icon={<Plus className="h-4 w-4" />}>Event</Button>
        </div>
      </div>

      {showFilters && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <span className="mr-1 text-xs font-semibold text-muted">Show:</span>
          {ALL_KINDS.map((k) => {
            const on = kinds.includes(k.kind)
            return (
              <button key={k.kind} onClick={() => setKinds(on ? kinds.filter((x) => x !== k.kind) : [...kinds, k.kind])} aria-pressed={on}
                className={cn('chip border px-2.5 py-1 transition', on ? 'border-transparent text-white' : 'border-line bg-transparent text-muted')} style={on ? { background: kindColor(k.kind) } : undefined}>
                {k.label}
              </button>
            )
          })}
          <span className="ml-auto hidden text-xs text-subtle md:inline">Category colors: {categories.slice(0, 6).map((c) => <span key={c.id} className="ml-2 inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}</span>)}</span>
        </div>
      )}

      {feed.error && <ErrorState error={feed.error} onRetry={feed.refetch} />}

      {view === 'timeline' ? (
        <TimelineView items={feed.items} startKey={timelineStart} days={14} />
      ) : (
        <div className={cn('card overflow-hidden p-2 sm:p-3', feed.loading && 'opacity-70')}>
          <FullCalendar
            ref={cal}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, multiMonthPlugin, interactionPlugin]}
            initialView={view}
            timeZone="UTC"
            now={() => toWallClock(new Date(), tz)}
            initialDate={toWallClock(new Date(), tz)}
            headerToolbar={false}
            // time grids need a fixed height so they scroll internally and honour scrollTime
            height={view.startsWith('timeGrid') ? Math.max(520, window.innerHeight - 190) : 'auto'}
            firstDay={settings.week_starts_on}
            nowIndicator
            selectable
            selectMirror
            editable
            eventResizableFromStart
            dayMaxEvents={4}
            scrollTime="07:30:00"
            slotEventOverlap={false}
            events={events}
            eventTimeFormat={h24 ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
            slotLabelFormat={h24 ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', meridiem: 'short' }}
            datesSet={(a: DatesSetArg) => { setTitle(a.view.title); setRange({ from: a.start, to: a.end }) }}
            select={onSelect}
            eventClick={(a: EventClickArg) => { a.jsEvent.preventDefault(); openItem(a.event.extendedProps.item as CalendarItem) }}
            eventDrop={onDrop}
            eventResize={onDrop}
            multiMonthMaxColumns={window.innerWidth < 640 ? 1 : 3}
            dateClick={view === 'multiMonthYear' ? (a) => { api()?.changeView('timeGridDay', a.date); setView('timeGridDay') } : undefined}
            noEventsContent="Nothing scheduled in this period"
          />
        </div>
      )}
    </div>
  )
}
