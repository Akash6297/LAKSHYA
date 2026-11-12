// Pomodoro engine. Lives above the router so the timer keeps running while the
// user navigates, and is persisted to localStorage so a reload doesn't lose it.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAppData } from './AppDataProvider'

export type FocusMode = 'focus' | 'short_break' | 'long_break'

interface TimerState {
  mode: FocusMode
  running: boolean
  /** epoch ms when the running period ends */
  endsAt: number | null
  /** remaining ms while paused */
  remaining: number
  startedAt: number | null
  taskId: string | null
  completedFocus: number
}

interface FocusCtx extends TimerState {
  durationMin: number
  remainingMs: number
  start: (taskId?: string | null) => void
  pause: () => void
  reset: () => void
  skip: () => void
  setMode: (m: FocusMode) => void
  setTask: (id: string | null) => void
}

const KEY = 'lakshya-focus'
const Ctx = createContext<FocusCtx | null>(null)

function load(): TimerState | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TimerState) : null
  } catch {
    return null
  }
}

function chime() {
  try {
    const ctx = new AudioContext()
    ;[660, 880].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.25 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.6)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.25)
      o.stop(ctx.currentTime + i * 0.25 + 0.7)
    })
  } catch {
    /* audio unavailable */
  }
}

async function systemNotify(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(title, { body, icon: '/icons/icon-192.png', tag: 'lakshya-focus' })
    else new Notification(title, { body, icon: '/icons/icon-192.png' })
  } catch {
    /* notifications blocked */
  }
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppData()
  const qc = useQueryClient()
  const minutesFor = useCallback((m: FocusMode) =>
    m === 'focus' ? settings.focus_minutes : m === 'short_break' ? settings.short_break_minutes : settings.long_break_minutes,
  [settings.focus_minutes, settings.short_break_minutes, settings.long_break_minutes])

  const [s, setS] = useState<TimerState>(() => load() ?? {
    mode: 'focus', running: false, endsAt: null, remaining: 25 * 60_000, startedAt: null, taskId: null, completedFocus: 0,
  })
  const [now, setNow] = useState(Date.now())
  const finishing = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* ignore */
    }
  }, [s])

  // keep the idle duration in sync with settings
  useEffect(() => {
    setS((p) => (!p.running && !p.startedAt ? { ...p, remaining: minutesFor(p.mode) * 60_000 } : p))
  }, [minutesFor])

  useEffect(() => {
    if (!s.running) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [s.running])

  const remainingMs = s.running && s.endsAt ? Math.max(0, s.endsAt - now) : s.remaining

  const record = useCallback(async (st: TimerState, completed: boolean) => {
    if (!st.startedAt) return
    const planned = minutesFor(st.mode)
    const elapsedMin = Math.round((planned * 60_000 - (st.running && st.endsAt ? Math.max(0, st.endsAt - Date.now()) : st.remaining)) / 60_000)
    if (elapsedMin < 1 && !completed) return
    const { error } = await supabase.from('focus_sessions').insert({
      kind: st.mode, planned_minutes: planned, actual_minutes: Math.min(Math.max(elapsedMin, 0), 240), completed,
      started_at: new Date(st.startedAt).toISOString(), ended_at: new Date().toISOString(), task_id: st.taskId,
    })
    if (error) toast.error(`Couldn't save focus session: ${error.message}`)
    else void qc.invalidateQueries({ queryKey: ['focus_sessions'] })
  }, [minutesFor, qc])

  // period finished
  useEffect(() => {
    if (!s.running || remainingMs > 0 || finishing.current) return
    finishing.current = true
    const done = s
    void record(done, true).finally(() => (finishing.current = false))
    chime()
    const nextFocusCount = done.mode === 'focus' ? done.completedFocus + 1 : done.completedFocus
    const next: FocusMode = done.mode === 'focus' ? (nextFocusCount % 4 === 0 ? 'long_break' : 'short_break') : 'focus'
    const msg = done.mode === 'focus' ? 'Focus session complete – time for a break.' : 'Break over – ready to focus?'
    toast.success(msg)
    void systemNotify('LAKSHYA', msg)
    setS({ ...done, mode: next, running: false, endsAt: null, startedAt: null, remaining: minutesFor(next) * 60_000, completedFocus: nextFocusCount })
  }, [remainingMs, s, record, minutesFor])

  const value: FocusCtx = {
    ...s,
    durationMin: minutesFor(s.mode),
    remainingMs,
    start: (taskId) => {
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
      setS((p) => ({ ...p, running: true, endsAt: Date.now() + p.remaining, startedAt: p.startedAt ?? Date.now(), taskId: taskId === undefined ? p.taskId : taskId }))
      setNow(Date.now())
    },
    pause: () => setS((p) => ({ ...p, running: false, endsAt: null, remaining: p.endsAt ? Math.max(0, p.endsAt - Date.now()) : p.remaining })),
    reset: () => {
      void record(s, false)
      setS((p) => ({ ...p, running: false, endsAt: null, startedAt: null, remaining: minutesFor(p.mode) * 60_000 }))
    },
    skip: () => {
      void record(s, false)
      const next: FocusMode = s.mode === 'focus' ? 'short_break' : 'focus'
      setS((p) => ({ ...p, mode: next, running: false, endsAt: null, startedAt: null, remaining: minutesFor(next) * 60_000 }))
    },
    setMode: (m) => setS((p) => (p.running ? p : { ...p, mode: m, startedAt: null, remaining: minutesFor(m) * 60_000 })),
    setTask: (id) => setS((p) => ({ ...p, taskId: id })),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFocus() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useFocus outside FocusProvider')
  return c
}
