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
import { createEvent, deleteEvent, updateEvent, useCalendarFeed } from '@/services/calendar'
import { useOpenTasks } from '@/features/tasks/hooks'
import type { EventRow, Meeting, MeetingParticipant, Note, Task } from '@/types/db'
import { respond, type BrainContext, type Card, type Effect, type Pending } from './brain'
import { planCall, type Contact } from './nlu/match'
import { addCustomAlarm, buildAlarms, loadCustomAlarms } from './alarms'
import { isNative, JarvisNative } from './native'
import { createVoice } from './voice'
import { useJarvisSettings } from './settings'
import { JarvisOverlay, type Phase, type Turn } from './JarvisOverlay'
import { JARVIS_OPEN_EVENT, JARVIS_SYNC_ALARMS_EVENT } from './env'

type Table = 'events' | 'meetings' | 'tasks' | 'notes'
/** The last thing Jarvis changed, and how to take it back ("undo"). */
type Last = { table: Table; id: string; title: string; open: boolean; undo: () => Promise<void>; undoSay: string }
type Via = 'tap' | 'wake' | 'briefing' | 'type'
type EffectResult = {
  say?: string
  created?: boolean
  card?: Card
  /** ask a follow-up (e.g. which contact) */
  pending?: Pending
  listen?: boolean
  /** runs after Jarvis has finished speaking (placing a call) */
  after?: () => Promise<void>
  undo?: Last
}

const TABLE = { event: 'events', meeting: 'meetings', task: 'tasks' } as const
const pick = (row: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]))
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)
const sayDigits = (n: string) => n.replace(/[^\d+]/g, '').split('').join(' ').replace('+', 'plus')


export default function JarvisRoot() {
  const { tz, h24, settings, prefs, profile, categoryById } = useAppData()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const focus = useFocus()
  const [js, setJs] = useJarvisSettings()
  const voice = useMemo(createVoice, [])
  const native = isNative()

  // minute tick: day rollover + "what's next" freshness
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 60_000); return () => clearInterval(id) }, [])
  const today = localDateKey(new Date(tick), tz)
  // a month ahead (and yesterday), so "move my meeting on the 28th" can find it
  const [from, to] = useMemo(() => [zonedInstant(addDaysKey(today, -1), '00:00', tz), zonedInstant(addDaysKey(today, 32), '00:00', tz)], [today, tz])
  const feed = useCalendarFeed(from, to, { tz, categories: categoryById })
  const openTasks = useOpenTasks()

  const [ui, setUi] = useState<{ open: boolean; phase: Phase; partial: string; turns: Turn[]; level: number }>({ open: false, phase: 'idle', partial: '', turns: [], level: 0 })
  const pending = useRef<Pending | undefined>(undefined)
  const last = useRef<Last | null>(null)
  const contactsCache = useRef<{ at: number; list: Contact[] } | null>(null)
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
      confirmDeletes: c.js.confirmDeletes,
      autocorrect: c.js.autocorrect,
      recentId: last.current?.id,
    }
  }

  const removeRow = (table: Table, id: string) => async () => { unwrap(await supabase.from(table).delete().eq('id', id)) }
  const created = (table: Table, id: string, title: string): Last => ({ table, id, title, open: true, undo: removeRow(table, id), undoSay: `Okay, I removed “${title}”.` })

  /** Contacts with phone numbers, asking for permission the first time. null = not allowed. */
  const loadContacts = async (): Promise<Contact[] | null> => {
    const c = contactsCache.current
    if (c && Date.now() - c.at < 10 * 60_000) return c.list
    const st = await JarvisNative.getStatus()
    if (!st.permissions.contacts) {
      const r = await JarvisNative.requestPermission({ kind: 'contacts' }).catch(() => ({ granted: false }))
      if (!r.granted) return null
    }
    const { contacts } = await JarvisNative.getContacts()
    contactsCache.current = { at: Date.now(), list: contacts }
    return contacts
  }

  /** Without the call permission Android opens the dialer with the number filled in instead. */
  const ensureCallPermission = async () => {
    const st = await JarvisNative.getStatus().catch(() => null)
    if (st && !st.permissions.phone) await JarvisNative.requestPermission({ kind: 'phone' }).catch(() => undefined)
  }

  const dial = (number: string) => async () => {
    const r = await JarvisNative.placeCall({ number })
    if (!r.placed) toast.info('Tap the green button to call', { description: 'Allow “Phone” for Jarvis in Settings to call directly.' })
  }

  const callNow = async (name: string, number: string, label?: string): Promise<EffectResult> => {
    await ensureCallPermission()
    const on = label === 'work' || label === 'home' ? ` on ${label}` : ''
    return {
      say: `Calling ${name === number ? sayDigits(number) : name}${on}.`,
      card: { type: 'item', target: 'call', title: name, detail: name === number ? undefined : `${label ? `${label[0].toUpperCase()}${label.slice(1)} · ` : ''}${number}` },
      after: dial(number),
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

  const runEffect = async (e: Effect): Promise<EffectResult | void> => {
    switch (e.type) {
      case 'createEvent': {
        const row = await createEvent(e.values)
        await invalidate(['events'])
        return { created: true, undo: created('events', row.id, row.title) }
      }
      case 'createMeeting': {
        const row = unwrap(await supabase.from('meetings').insert(e.values as never).select().single()) as Meeting
        if (e.participants.length) {
          unwrap(await supabase.from('meeting_participants').insert(e.participants.map((n) => ({ meeting_id: row.id, name: n.slice(0, 120), email: null })) as never))
        }
        await invalidate(['meetings', 'meeting_participants'])
        return { created: true, undo: created('meetings', row.id, row.title) }
      }
      case 'createTask': {
        const id = crypto.randomUUID()
        const row = unwrap(await supabase.from('tasks').insert({ ...e.values, id, client_key: id } as never).select().single()) as Task
        await invalidate(['tasks', 'projects'])
        return { created: true, undo: created('tasks', row.id, row.title) }
      }
      case 'createNote': {
        const row = unwrap(await supabase.from('notes').insert(e.values as never).select().single()) as Note
        await invalidate(['notes'])
        return { created: true, undo: created('notes', row.id, row.title) }
      }
      case 'updateItem': {
        const { cand, values, scope } = e
        const table = TABLE[cand.kind]
        let undo: () => Promise<void>
        if (cand.kind === 'event') {
          const it = cand.item!
          const row = it.row as EventRow
          await updateEvent({ row, master: it.master, originalStart: it.originalStart }, values as never, scope)
          if (it.master && it.originalStart && scope === 'this') {
            // one occurrence of a series became its own row: removing that row restores the occurrence
            const masterId = it.master.id, os = it.originalStart.toISOString()
            undo = async () => { unwrap(await supabase.from('events').delete().eq('recurring_event_id', masterId).eq('original_start', os)) }
          } else {
            const target = it.master ?? row
            const before = pick(target, [...new Set([...Object.keys(values), 'start_at', 'end_at', 'all_day', ...(it.master ? ['exdates'] : [])])])
            undo = async () => { unwrap(await supabase.from('events').update(before as never).eq('id', target.id)) }
          }
        } else {
          const row = cand.kind === 'task' ? cand.task! : (cand.item!.row as Meeting)
          const before = pick(row, Object.keys(values))
          unwrap(await supabase.from(table).update(values as never).eq('id', cand.id))
          undo = async () => { unwrap(await supabase.from(table).update(before as never).eq('id', cand.id)) }
        }
        await invalidate([table, ...(cand.kind === 'task' ? ['projects'] : [])])
        const title = (values.title as string | undefined) ?? cand.title
        return { created: true, undo: { table, id: cand.id, title, open: true, undo, undoSay: `Okay, I've put “${cand.title}” back the way it was.` } }
      }
      case 'deleteItem': {
        const { cand, scope } = e
        const table = TABLE[cand.kind]
        let undo: () => Promise<void>
        if (cand.kind === 'event') {
          const it = cand.item!
          const row = it.row as EventRow
          const item = { row, master: it.master, originalStart: it.originalStart }
          if (row.recurring_event_id && row.original_start && scope === 'this') {
            // an edited occurrence: it is removed and hidden from its series
            const parentId = row.recurring_event_id
            const { data } = await supabase.from('events').select('exdates').eq('id', parentId).single()
            const exdates = (data as { exdates: string[] | null } | null)?.exdates ?? []
            await deleteEvent(item, 'this')
            undo = async () => {
              unwrap(await supabase.from('events').update({ exdates } as never).eq('id', parentId))
              unwrap(await supabase.from('events').insert(row as never))
            }
          } else if (it.master && it.originalStart && scope === 'this') {
            const masterId = it.master.id, exdates = it.master.exdates ?? []
            await deleteEvent(item, 'this')
            undo = async () => { unwrap(await supabase.from('events').update({ exdates } as never).eq('id', masterId)) }
          } else {
            const target = it.master ?? row
            await deleteEvent(item, scope)
            undo = async () => { unwrap(await supabase.from('events').insert(target as never)) }
          }
        } else if (cand.kind === 'meeting') {
          const row = cand.item!.row as Meeting
          const people = (unwrap(await supabase.from('meeting_participants').select('*').eq('meeting_id', cand.id)) ?? []) as MeetingParticipant[]
          unwrap(await supabase.from('meetings').delete().eq('id', cand.id))
          undo = async () => {
            unwrap(await supabase.from('meetings').insert(row as never))
            if (people.length) unwrap(await supabase.from('meeting_participants').insert(people as never))
          }
        } else {
          // tasks are cancelled, not destroyed, so subtasks and history survive an undo
          const t = cand.task!
          unwrap(await supabase.from('tasks').update({ status: 'cancelled' } as never).eq('id', t.id))
          undo = async () => { unwrap(await supabase.from('tasks').update({ status: t.status } as never).eq('id', t.id)) }
        }
        await invalidate([table, ...(cand.kind === 'meeting' ? ['meeting_participants'] : cand.kind === 'task' ? ['projects'] : [])])
        return { created: true, undo: { table, id: cand.id, title: cand.title, open: false, undo, undoSay: `Okay, I've brought back “${cand.title}”.` } }
      }
      case 'call': {
        if (!native) return { say: 'I can make calls from the phone app.' }
        if (e.number) return callNow(e.name ?? e.number, e.number, e.label)
        const contacts = await loadContacts()
        if (!contacts) return { say: 'To call people by name I need access to your contacts. Please allow it, or say the number instead.' }
        const who = e.who ?? ''
        const plan = planCall(who, e.label, contacts)
        if (plan.type === 'none') {
          return { say: `I couldn't find “${who}” in your contacts. If they're saved under another name, teach me: say “when I say ${who} I mean”, then the contact's name.` }
        }
        if (plan.type === 'choose') {
          const people = plan.reason === 'people'
          const opts = plan.options
          return {
            say: people ? `I found ${opts.length} contacts: ${listJoin(opts.map((o) => o.name))}. Which one?` : `${opts[0].name} has ${opts.length} numbers: ${listJoin(opts.map((o) => o.label))}. Which one?`,
            listen: true,
            pending: { type: 'choose_contact', options: opts },
            card: { type: 'choices', title: people ? 'Who should I call?' : 'Which number?', selectable: true, rows: opts.map((o, i) => ({ label: `${i + 1}. ${people ? o.name : o.label[0].toUpperCase() + o.label.slice(1)}`, detail: o.number })) },
          }
        }
        const c = plan.choice
        if (!plan.sure) {
          return {
            say: `Did you mean ${c.name}? Should I call?`,
            listen: true,
            card: { type: 'item', target: 'call', title: c.name, detail: c.number },
            pending: { type: 'confirm', effects: [{ type: 'call', number: c.number, name: c.name, label: c.label }], done: '' },
          }
        }
        return callNow(c.name, c.number, c.label)
      }
      case 'learn': {
        const heard = e.heard.trim().toLowerCase()
        setJs((s) => ({ ...s, corrections: [...s.corrections.filter((x) => x.heard.trim().toLowerCase() !== heard), { heard: e.heard.trim(), meant: e.meant.trim() }] }))
        return
      }
      case 'undo': {
        const l = last.current
        if (!l) return { say: "There's nothing to undo." }
        await l.undo()
        last.current = null
        await invalidate([l.table, ...(l.table === 'tasks' ? ['projects'] : l.table === 'meetings' ? ['meeting_participants'] : [])])
        setUi((u) => ({ ...u, turns: u.turns.map((t) => ({ ...t, undoable: false })) }))
        return { say: l.undoSay }
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

  const handle = async (text: string, opts: { silent?: boolean; alternatives?: string[] } = {}) => {
    const sid = session.current.id
    setUi((u) => ({ ...u, phase: 'thinking', partial: '' }))
    const reply = respond(text, pending.current, brainCtx(), opts.alternatives)
    // show what Jarvis understood (a better speech alternative may have been picked)
    if (!opts.silent) addTurn({ who: 'you', text: reply.heard })
    pending.current = reply.pending
    let say = reply.say
    let shown = reply.display ?? reply.say
    let card = reply.card
    let listenAgain = reply.listen
    let failed = false
    let changed = false
    const afters: (() => Promise<void>)[] = []
    const undos: Last[] = []
    try {
      for (const e of reply.effects) {
        const r = await runEffect(e)
        if (!r) continue
        if (r.say) say = shown = r.say
        if (r.created) changed = true
        if (r.card) card = r.card
        if (r.pending) pending.current = r.pending
        if (r.listen) listenAgain = true
        if (r.after) afters.push(r.after)
        if (r.undo) undos.push(r.undo)
      }
    } catch (err) {
      failed = true
      say = shown = `Sorry, that didn't work. ${(err as Error).message}`
    }
    if (undos.length) {
      // several changes at once ("cancel all my meetings tomorrow") undo together
      last.current = undos.length === 1 ? undos[0] : {
        ...undos[undos.length - 1], open: false,
        undo: async () => { for (const u of [...undos].reverse()) await u.undo() },
        undoSay: `Okay, I've brought back all ${undos.length}.`,
      }
    }
    if (sid !== session.current.id) return
    addTurn({ who: 'jarvis', text: shown, card: failed ? undefined : card, error: failed, undoable: changed && !failed })
    await speak(say)
    if (sid !== session.current.id) return
    if (afters.length && !failed) {
      session.current.navigated = true // the call screen takes over; don't send the phone back to another app
      try {
        for (const a of afters) await a()
      } catch (err) {
        addTurn({ who: 'jarvis', text: `Sorry, I couldn't place the call. ${(err as Error).message}`, error: true })
        setPhase('idle')
        return
      }
      return close()
    }
    if (reply.effects.some((e) => e.type === 'close')) return close()
    if (listenAgain && !session.current.typed && voice.canListen) return listen()
    setPhase('idle')
  }

  const listen = async () => {
    const sid = session.current.id
    if (!voice.canListen) return
    setUi((u) => ({ ...u, phase: 'listening', partial: '', level: 0 }))
    let text = ''
    let alternatives: string[] = []
    let problem = ''
    try {
      ;({ text, alternatives } = await voice.listen(L.current.js.voice.language, (p) => setUi((u) => ({ ...u, partial: p })), (rms) => setUi((u) => ({ ...u, level: rms }))))
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
    await handle(text, { alternatives })
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
    if (!l || !l.open) return
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
