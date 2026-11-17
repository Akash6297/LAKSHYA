// Jarvis controller: wake-word events from Android, the listen → understand →
// act → speak loop, saving to the user's Supabase account, Undo, and keeping
// the phone's alarms in sync with the calendar. Only included in the APK build.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { App as CapApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { toast } from 'sonner'
import { supabase, unwrap } from '@/lib/supabase'
import { addDaysKey, localDateKey, zonedInstant } from '@/lib/dates'
import { useAppData } from '@/providers/AppDataProvider'
import { useFocus } from '@/providers/FocusProvider'
import { createEvent, useCalendarFeed } from '@/services/calendar'
import { useOpenTasks } from '@/features/tasks/hooks'
import type { Meeting, Note, Task } from '@/types/db'
import { respond, type BrainContext, type Effect, type Pending } from './brain'
import { addCustomAlarm, buildAlarms, loadCustomAlarms } from './alarms'
import { isNative, JarvisNative } from './native'
import { createVoice } from './voice'
import { useJarvisSettings } from './settings'
import { JarvisOverlay, type Phase, type Turn } from './JarvisOverlay'
import { JARVIS_OPEN_EVENT, JARVIS_SYNC_ALARMS_EVENT } from './env'

type Created = { table: 'events' | 'meetings' | 'tasks' | 'notes'; id: string; title: string }
type Via = 'tap' | 'wake' | 'briefing' | 'type'


export default function JarvisRoot() {
  const { tz, h24, settings, prefs, profile, categoryById } = useAppData()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const focus = useFocus()
  const [js] = useJarvisSettings()
  const voice = useMemo(createVoice, [])
  const native = isNative()

  // minute tick: day rollover + "what's next" freshness
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 60_000); return () => clearInterval(id) }, [])
  const today = localDateKey(new Date(tick), tz)
  const [from, to] = useMemo(() => [zonedInstant(today, '00:00', tz), zonedInstant(addDaysKey(today, 8), '00:00', tz)], [today, tz])
  const feed = useCalendarFeed(from, to, { tz, categories: categoryById })
  const openTasks = useOpenTasks()

  const [ui, setUi] = useState<{ open: boolean; phase: Phase; partial: string; turns: Turn[]; level: number }>({ open: false, phase: 'idle', partial: '', turns: [], level: 0 })
  const pending = useRef<Pending | undefined>(undefined)
  const last = useRef<Created | null>(null)
  const session = useRef({ active: false, id: 0, fromBackground: false, navigated: false, typed: false })
  const turnId = useRef(0)

  const name = js.callMe.trim() || (profile?.full_name ?? '').trim().split(/\s+/)[0] || ''
  // latest values for async flows
  const L = useRef({ js, tz, h24, settings, prefs, name, items: feed.items, open: openTasks.data ?? [] })
  L.current = { js, tz, h24, settings, prefs, name, items: feed.items, open: openTasks.data ?? [] }

  const brainCtx = (): BrainContext => {
    const c = L.current, now = new Date()
    return {
      now, tz: c.tz, h24: c.h24, name: c.name,
      data: { now, tz: c.tz, h24: c.h24, name: c.name, items: c.items, openTasks: c.open, workingHours: c.settings.working_hours ?? {} },
      defaultEventMinutes: c.settings.default_event_minutes || 60,
      taskDefaultReminders: c.prefs?.task_default_reminders ?? [],
      confirmBeforeSave: c.js.confirmBeforeSave,
      corrections: c.js.corrections,
      shortcuts: c.js.shortcuts,
    }
  }

  const addTurn = (t: Omit<Turn, 'id'>) => setUi((u) => ({ ...u, turns: [...u.turns.map((x) => ({ ...x, undoable: t.undoable ? false : x.undoable })), { ...t, id: ++turnId.current }] }))
  const setPhase = (phase: Phase) => setUi((u) => ({ ...u, phase }))
  const invalidate = (keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))

  const speak = async (text: string) => {
    const c = L.current.js
    if (!text || !c.voice.speak) return
    setPhase('speaking')
    try { await voice.speak(text, { language: c.voice.language, rate: c.voice.rate, pitch: c.voice.pitch }) } catch { /* TTS unavailable: text is on screen */ }
  }

  const runEffect = async (e: Effect): Promise<{ say?: string; created?: boolean } | void> => {
    switch (e.type) {
      case 'createEvent': {
        const row = await createEvent(e.values)
        last.current = { table: 'events', id: row.id, title: row.title }
        await invalidate(['events'])
        return { created: true }
      }
      case 'createMeeting': {
        const row = unwrap(await supabase.from('meetings').insert(e.values as never).select().single()) as Meeting
        if (e.participants.length) {
          unwrap(await supabase.from('meeting_participants').insert(e.participants.map((n) => ({ meeting_id: row.id, name: n.slice(0, 120), email: null })) as never))
        }
        last.current = { table: 'meetings', id: row.id, title: row.title }
        await invalidate(['meetings', 'meeting_participants'])
        return { created: true }
      }
      case 'createTask': {
        const id = crypto.randomUUID()
        const row = unwrap(await supabase.from('tasks').insert({ ...e.values, id, client_key: id } as never).select().single()) as Task
        last.current = { table: 'tasks', id: row.id, title: row.title }
        await invalidate(['tasks', 'projects'])
        return { created: true }
      }
      case 'createNote': {
        const row = unwrap(await supabase.from('notes').insert(e.values as never).select().single()) as Note
        last.current = { table: 'notes', id: row.id, title: row.title }
        await invalidate(['notes'])
        return { created: true }
      }
      case 'undo': {
        const l = last.current
        if (!l) return { say: "There's nothing to undo." }
        unwrap(await supabase.from(l.table).delete().eq('id', l.id))
        last.current = null
        await invalidate([l.table, ...(l.table === 'tasks' ? ['projects'] : [])])
        setUi((u) => ({ ...u, turns: u.turns.map((t) => ({ ...t, undoable: false })) }))
        return { say: `Okay, I removed “${l.title}”.` }
      }
      case 'navigate':
        session.current.navigated = true
        navigate(e.to)
        return
      case 'alarm': {
        const at = new Date(e.at)
        if (!native) return { say: 'I can set alarms from the phone app.' }
        if (at.getTime() - Date.now() <= 23.5 * 3600_000) {
          // device-local clock fields: the Clock app rings in the phone's own timezone
          await JarvisNative.setSystemAlarm({ hour: at.getHours(), minute: at.getMinutes(), message: e.label || 'Jarvis' })
        } else {
          addCustomAlarm({ id: crypto.randomUUID(), at: e.at, label: e.label })
          syncAlarms()
        }
        return
      }
      case 'timer':
        if (native) await JarvisNative.setSystemTimer({ seconds: e.seconds, message: e.label || 'Jarvis timer' })
        else setTimeout(() => { toast.info("Time's up!"); void voice.speak("Time's up!", { language: L.current.js.voice.language, rate: 1, pitch: 1 }) }, e.seconds * 1000)
        return
      case 'focus':
        session.current.navigated = true
        navigate('/focus')
        if (!focus.running) focus.start()
        return
      case 'close':
        return
    }
  }

  const handle = async (text: string, opts: { silent?: boolean } = {}) => {
    const sid = session.current.id
    if (!opts.silent) addTurn({ who: 'you', text })
    setUi((u) => ({ ...u, phase: 'thinking', partial: '' }))
    const reply = respond(text, pending.current, brainCtx())
    pending.current = reply.pending
    let say = reply.say
    let shown = reply.display ?? reply.say
    let failed = false
    let created = false
    try {
      for (const e of reply.effects) {
        const r = await runEffect(e)
        if (r?.say) say = shown = r.say
        if (r?.created) created = true
      }
    } catch (err) {
      failed = true
      say = shown = `Sorry, I couldn't save that. ${(err as Error).message}`
    }
    if (sid !== session.current.id) return
    addTurn({ who: 'jarvis', text: shown, card: failed ? undefined : reply.card, error: failed, undoable: created })
    await speak(say)
    if (sid !== session.current.id) return
    if (reply.effects.some((e) => e.type === 'close')) return close()
    if (reply.listen && !session.current.typed && voice.canListen) return listen()
    setPhase('idle')
  }

  const listen = async () => {
    const sid = session.current.id
    if (!voice.canListen) return
    setUi((u) => ({ ...u, phase: 'listening', partial: '', level: 0 }))
    let text = ''
    let problem = ''
    try {
      text = await voice.listen(L.current.js.voice.language, (p) => setUi((u) => ({ ...u, partial: p })), (rms) => setUi((u) => ({ ...u, level: rms })))
    } catch (e) {
      problem = (e as Error).message
    }
    if (sid !== session.current.id) return
    if (problem) {
      setUi((u) => ({ ...u, partial: '', level: 0 }))
      addTurn({ who: 'jarvis', text: problem, error: true })
      setPhase('idle')
      return
    }
    setUi((u) => ({ ...u, partial: '', level: 0 }))
    if (!text.trim()) {
      setPhase('idle')
      return
    }
    await handle(text)
  }

  const openSession = async (via: Via, phrase?: string, fromBackground = false) => {
    if (session.current.active && via === 'wake') return
    session.current = { active: true, id: session.current.id + 1, fromBackground, navigated: false, typed: via === 'type' }
    pending.current = undefined
    setUi({ open: true, phase: 'idle', partial: '', turns: [], level: 0 })
    if (native) await JarvisNative.pauseWakeWord().catch(() => undefined)
    if (via === 'briefing') return handle('good morning', { silent: true })
    if (via === 'wake' && native && !L.current.js.allowOnLockScreen) {
      // privacy: nothing about your day is read out until the phone is unlocked
      const st = await JarvisNative.getStatus().catch(() => null)
      if (st?.locked) {
        addTurn({ who: 'jarvis', text: 'Unlock your phone to continue.' })
        const unlocked = await waitForUnlock(30_000)
        if (!unlocked) return close()
      }
    }
    if (via === 'wake') {
      const hello = /radh/i.test(phrase ?? '') ? 'Radhe Radhe!' : 'Yes?'
      addTurn({ who: 'jarvis', text: hello })
      await speak(hello)
    }
    if (via !== 'type') await listen()
  }

  const waitForUnlock = (ms: number) => new Promise<boolean>((resolve) => {
    let done = false
    const finish = (v: boolean) => { if (done) return; done = true; clearTimeout(t); void sub.then((s) => s.remove()); resolve(v) }
    const sub = JarvisNative.addListener('unlocked', () => finish(true))
    const t = setTimeout(() => finish(false), ms)
  })

  const close = () => {
    const wasBackground = session.current.fromBackground && !session.current.navigated
    session.current = { ...session.current, active: false, id: session.current.id + 1 }
    voice.stopListening()
    voice.stopSpeaking()
    pending.current = undefined
    setUi((u) => ({ ...u, open: false, phase: 'idle', partial: '' }))
    if (native) {
      void JarvisNative.resumeWakeWord().catch(() => undefined)
      if (wasBackground && L.current.js.returnToPreviousApp) void JarvisNative.minimize().catch(() => undefined)
    }
  }

  // stable entry points for listeners registered once
  const api = useRef({ openSession, close, handle, listen })
  api.current = { openSession, close, handle, listen }
  const isOpen = useRef(false)
  isOpen.current = ui.open

  // mic button in the top bar
  useEffect(() => {
    const on = (e: Event) => void api.current.openSession((e as CustomEvent<{ via?: Via }>).detail?.via ?? 'tap')
    window.addEventListener(JARVIS_OPEN_EVENT, on)
    return () => window.removeEventListener(JARVIS_OPEN_EVENT, on)
  }, [])

  // wake word / notification taps from Android
  useEffect(() => {
    if (!native) return
    const subs: Promise<PluginListenerHandle>[] = [
      JarvisNative.addListener('wake', (e) => void api.current.openSession('wake', e.phrase, e.fromBackground)),
      JarvisNative.addListener('launch', (e) => {
        if (e.route === 'jarvis:briefing') void api.current.openSession('briefing')
        else if (e.route) navigate(e.route)
      }),
    ]
    void JarvisNative.consumeLaunch().then((l) => {
      if (l.action === 'wake') void api.current.openSession('wake', l.phrase, l.fromBackground)
      else if (l.route === 'jarvis:briefing') void api.current.openSession('briefing')
      else if (l.route) navigate(l.route)
    }).catch(() => undefined)
    return () => { subs.forEach((p) => void p.then((s) => s.remove())) }
  }, [native, navigate])

  // Android back button: close Jarvis / dialogs / go back / leave the app running
  useEffect(() => {
    if (!native) return
    const sub = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (isOpen.current) return api.current.close()
      if (document.querySelector('[role="dialog"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      if (canGoBack) window.history.back()
      else void CapApp.minimizeApp()
    })
    return () => { void sub.then((s) => s.remove()) }
  }, [native])

  // keep the wake-word service in line with settings
  const wakeKey = `${js.wake.enabled}|${js.wake.mode}|${js.wake.threshold}|${js.wake.phrases.join(',')}|${js.allowOnLockScreen}`
  useEffect(() => {
    if (!native) return
    const w = L.current.js.wake
    void (async () => {
      if (!w.enabled) return JarvisNative.stopWakeWord()
      const st = await JarvisNative.getStatus()
      if (!st.permissions.microphone) return
      await JarvisNative.startWakeWord({ phrases: w.phrases, mode: w.mode, threshold: w.threshold, allowOnLockScreen: L.current.js.allowOnLockScreen })
      if (isOpen.current) await JarvisNative.pauseWakeWord()
    })().catch(() => undefined)
  }, [native, wakeKey])

  // phone alarms follow the calendar (debounced; only once data has loaded)
  const alarmSig = useMemo(() => feed.items.map((i) => `${i.key}@${i.start.getTime()}${i.done ? 'd' : ''}`).join('|'), [feed.items])
  const syncAlarms = useCallback(() => {
    if (!native) return
    const c = L.current
    const alarms = buildAlarms(c.items, c.js, new Date(), c.tz, c.h24, loadCustomAlarms())
    void JarvisNative.setAlarms({ alarms }).catch(() => undefined)
  }, [native])
  useEffect(() => {
    const on = () => syncAlarms()
    window.addEventListener(JARVIS_SYNC_ALARMS_EVENT, on)
    return () => window.removeEventListener(JARVIS_SYNC_ALARMS_EVENT, on)
  }, [syncAlarms])
  const alarmsKey = JSON.stringify([js.alarms, js.briefing])
  useEffect(() => {
    if (!native || feed.loading) return
    const t = setTimeout(syncAlarms, 1500)
    return () => clearTimeout(t)
  }, [native, feed.loading, alarmSig, alarmsKey, today, h24, tz, syncAlarms])

  const openItem = () => {
    const l = last.current
    if (!l) return
    session.current.navigated = true
    close()
    navigate(l.table === 'notes' ? `/notes/${l.id}` : l.table === 'events' ? '/calendar' : `/${l.table}`)
  }

  return (
    <JarvisOverlay
      open={ui.open}
      phase={ui.phase}
      partial={ui.partial}
      turns={ui.turns}
      level={ui.level}
      canListen={voice.canListen}
      tz={tz}
      h24={h24}
      onMic={() => {
        if (ui.phase === 'listening') voice.stopListening()
        else {
          voice.stopSpeaking()
          session.current.typed = false
          void listen()
        }
      }}
      onClose={close}
      onText={(t) => { voice.stopListening(); voice.stopSpeaking(); session.current.typed = true; void handle(t) }}
      onUndo={() => void handle('undo')}
      onOpenItem={openItem}
      onSettings={() => { session.current.navigated = true; close(); navigate('/settings#jarvis') }}
    />
  )
}
