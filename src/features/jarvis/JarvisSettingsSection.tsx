// Settings → Jarvis (phone app only): permissions, wake words, voice,
// briefing, ringing alerts and "training" (corrections + shortcuts).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { BatteryCharging, Bell, BellRing, Check, GraduationCap, Layers, Mic, Plus, RotateCcw, Sparkles, Trash2, Volume2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/display'
import { Field, Input, Select, Switch } from '@/components/ui/form'
import { cn } from '@/lib/utils'
import { useAppData } from '@/providers/AppDataProvider'
import { isNative, JarvisNative, type NativeStatus, type PermissionKind, type SettingsKind } from './native'
import { DEFAULT_WAKE_PHRASES, useJarvisSettings, type JarvisSettings, type ListenMode, type Shortcut } from './settings'
import { createVoice } from './voice'
import { addCustomAlarm } from './alarms'
import { openJarvis, requestAlarmSync } from './env'
import { parseCommand } from './nlu/parse'
import { resolveWhen } from './nlu/when'
import { spokenDay, spokenTime } from './motivation'

function Block({ title, icon, children, description }: { title: string; icon: ReactNode; children: ReactNode; description?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center gap-2 text-sm font-bold"><span className="text-primary">{icon}</span>{title}</div>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  )
}

const OEM = /xiaomi|redmi|poco|oppo|realme|vivo|iqoo|oneplus|huawei|honor|samsung|motorola|nothing|tecno|infinix/i

export default function JarvisSettingsSection() {
  const [s, update] = useJarvisSettings()
  const native = isNative()
  const [st, setSt] = useState<NativeStatus | null>(null)
  const refresh = useCallback(async () => {
    if (!native) return
    try { setSt(await JarvisNative.getStatus()) } catch { setSt(null) }
  }, [native])
  useEffect(() => {
    void refresh()
    if (!native) return
    const sub = CapApp.addListener('resume', () => void refresh())
    const t = setInterval(() => void refresh(), 5000)
    return () => { void sub.then((x) => x.remove()); clearInterval(t) }
  }, [native, refresh])

  // the section loads lazily, after SettingsPage's own #hash scroll ran
  useEffect(() => {
    if (location.hash === '#jarvis') setTimeout(() => document.getElementById('jarvis')?.scrollIntoView({ behavior: 'smooth' }), 120)
  }, [])

  const set = (fn: (s: JarvisSettings) => JarvisSettings) => update(fn)

  return (
    <section id="jarvis" className="card scroll-mt-24 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold"><span className="text-primary"><Sparkles className="h-4 w-4" /></span>Jarvis voice assistant</h2>
      <p className="mt-1 text-sm text-muted">Say “Hey Jarvis”, “Hey Lakshya”, “Radhe Radhe Jarvis” or “Radhe Radhe Lakshya”. Everything runs on this phone for free; what Jarvis creates is saved to your LAKSHYA account.</p>
      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button icon={<Mic className="h-4 w-4" />} onClick={() => openJarvis('tap')}>Talk to Jarvis</Button>
          {native && <Button variant="soft" onClick={() => void refresh()}>Refresh status</Button>}
        </div>

        {native && st && <Permissions st={st} refresh={refresh} s={s} />}

        <Block title="Wake word" icon={<Mic className="h-4 w-4" />} description="An offline speech model listens only for your wake phrases. Nothing you say is sent anywhere until Jarvis opens.">
          <Switch label="Listen for wake words" checked={s.wake.enabled} onChange={(v) => set((x) => ({ ...x, wake: { ...x.wake, enabled: v } }))} />
          <Field label="When to listen">
            <Segmented size="sm" value={s.wake.mode} onChange={(v) => set((x) => ({ ...x, wake: { ...x.wake, mode: v as ListenMode } }))}
              options={[{ value: 'always', label: 'Always' }, { value: 'screen_on', label: 'Screen on' }, { value: 'charging', label: 'While charging' }]} />
            <p className="mt-1.5 text-xs text-subtle">{s.wake.mode === 'always' ? 'Works with the screen off. Uses the most battery.' : s.wake.mode === 'screen_on' ? 'Sleeps when the screen is off.' : 'Only while plugged in: almost no battery cost.'}</p>
          </Field>
          <PhraseEditor phrases={s.wake.phrases} unknown={st?.wake.unknownWords ?? []} onChange={(phrases) => set((x) => ({ ...x, wake: { ...x.wake, phrases } }))} />
          <Field label={`Strictness: ${Math.round(s.wake.threshold * 100)}%`} hint="Lower if Jarvis misses you; higher if it wakes up by mistake.">
            <input type="range" min={0.3} max={0.9} step={0.05} value={s.wake.threshold} onChange={(e) => set((x) => ({ ...x, wake: { ...x.wake, threshold: Number(e.target.value) } }))} className="w-full accent-[var(--primary)]" aria-label="Wake word strictness" />
          </Field>
          {native && st && (
            <p className={cn('text-xs font-semibold', st.wake.listening ? 'text-success' : 'text-muted')}>
              {st.wake.error ? `Problem: ${st.wake.error}` : !st.wake.running ? 'Not running.' : !st.wake.modelReady ? 'Preparing the offline voice model…' : st.wake.paused ? 'Paused while Jarvis is open.' : st.wake.listening ? 'Listening for your wake words.' : 'Waiting (outside the chosen listening mode).'}
            </p>
          )}
        </Block>

        <Block title="Voice" icon={<Volume2 className="h-4 w-4" />}>
          <Switch label="Speak replies" checked={s.voice.speak} onChange={(v) => set((x) => ({ ...x, voice: { ...x.voice, speak: v } }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Language" htmlFor="jv-lang" hint="English (India) understands Hinglish best.">
              <Select id="jv-lang" value={s.voice.language} onChange={(e) => set((x) => ({ ...x, voice: { ...x.voice, language: e.target.value as JarvisSettings['voice']['language'] } }))}>
                <option value="en-IN">English (India)</option><option value="hi-IN">Hindi</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option>
              </Select>
            </Field>
            <Field label={`Speed: ${s.voice.rate.toFixed(1)}×`}>
              <input type="range" min={0.7} max={1.5} step={0.1} value={s.voice.rate} onChange={(e) => set((x) => ({ ...x, voice: { ...x.voice, rate: Number(e.target.value) } }))} className="mt-2 w-full accent-[var(--primary)]" aria-label="Speech speed" />
            </Field>
          </div>
          <Button variant="soft" size="sm" onClick={() => void createVoice().speak('Radhe Radhe! I am Jarvis. Ready when you are.', s.voice)}>Test voice</Button>
          <Field label="What should Jarvis call you?" htmlFor="jv-name" hint="Leave empty to use your first name.">
            <Input id="jv-name" value={s.callMe} maxLength={40} placeholder="e.g. Sir, Boss, your name" onChange={(e) => set((x) => ({ ...x, callMe: e.target.value }))} />
          </Field>
        </Block>

        <Block title="Behaviour" icon={<Layers className="h-4 w-4" />}>
          <Switch label="Ask before saving" description="Off: Jarvis saves immediately and you can say “undo”." checked={s.confirmBeforeSave} onChange={(v) => set((x) => ({ ...x, confirmBeforeSave: v }))} />
          <Switch label="Ask before cancelling or deleting" description="Recommended: a misheard word won't remove a meeting." checked={s.confirmDeletes} onChange={(v) => set((x) => ({ ...x, confirmDeletes: v }))} />
          <Switch label="Autocorrect" description="Fixes misspelled and misheard words like “calender” or “remainder”." checked={s.autocorrect} onChange={(v) => set((x) => ({ ...x, autocorrect: v }))} />
          <Switch label="Go back to the previous app" description="After a “Hey Jarvis” session, return to what you were doing." checked={s.returnToPreviousApp} onChange={(v) => set((x) => ({ ...x, returnToPreviousApp: v }))} />
          <Switch label="Work on the lock screen without unlocking" description="Off is safer: anyone could otherwise ask Jarvis about your day." checked={s.allowOnLockScreen} onChange={(v) => set((x) => ({ ...x, allowOnLockScreen: v }))} />
        </Block>

        <Block title="Morning briefing" icon={<Bell className="h-4 w-4" />} description="A daily notification; tap it and Jarvis reads your day, a balance tip and a motivational quote.">
          <Switch label="Daily briefing" checked={s.briefing.enabled} onChange={(v) => set((x) => ({ ...x, briefing: { ...x.briefing, enabled: v } }))} />
          <Field label="Time" htmlFor="jv-brief"><Input id="jv-brief" type="time" value={s.briefing.time} onChange={(e) => e.target.value && set((x) => ({ ...x, briefing: { ...x.briefing, time: e.target.value } }))} className="max-w-40" /></Field>
        </Block>

        <Block title="Ringing alerts" icon={<BellRing className="h-4 w-4" />} description="Rings like a call (looping sound, full screen) so you don't miss what matters. Works offline and with the app closed.">
          <Switch label="Phone alerts" checked={s.alarms.enabled} onChange={(v) => set((x) => ({ ...x, alarms: { ...x.alarms, enabled: v } }))} />
          <div className="grid gap-1 sm:grid-cols-2">
            {([['meetings', 'Meetings'], ['exams', 'Exams'], ['deadlines', 'Project deadlines'], ['importantEvents', 'High-priority events'], ['reminders', '“Remind me” and urgent tasks']] as const).map(([k, label]) => (
              <Switch key={k} label={label} checked={s.alarms.ring[k]} onChange={(v) => set((x) => ({ ...x, alarms: { ...x.alarms, ring: { ...x.alarms.ring, [k]: v } } }))} />
            ))}
          </div>
          <Field label="Default alert time for meetings" htmlFor="jv-lead" hint="Used when a meeting has no reminder of its own.">
            <Select id="jv-lead" value={s.alarms.defaultLeadMinutes} onChange={(e) => set((x) => ({ ...x, alarms: { ...x.alarms, defaultLeadMinutes: Number(e.target.value) } }))} className="max-w-48">
              {[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} minutes before` : 'At start time'}</option>)}
            </Select>
          </Field>
          {native && (
            <Button variant="soft" size="sm" onClick={() => { addCustomAlarm({ id: crypto.randomUUID(), at: new Date(Date.now() + 60_000).toISOString(), label: 'Jarvis test alert' }); requestAlarmSync(); toast.success('A test alert will ring in about a minute. Lock your phone to see the full-screen version.') }}>
              Test a ringing alert in 1 minute
            </Button>
          )}
        </Block>

        <Training s={s} set={set} />
      </div>
    </section>
  )
}

function Permissions({ st, refresh, s }: { st: NativeStatus; refresh: () => Promise<void>; s: JarvisSettings }) {
  const p = st.permissions
  const ask = async (kind: PermissionKind) => {
    await JarvisNative.requestPermission({ kind }).catch(() => undefined)
    if (kind === 'microphone' && s.wake.enabled) await JarvisNative.startWakeWord({ phrases: s.wake.phrases, mode: s.wake.mode, threshold: s.wake.threshold, allowOnLockScreen: s.allowOnLockScreen }).catch(() => undefined)
    await refresh()
  }
  const open = (kind: SettingsKind) => void JarvisNative.openSettings({ kind })
  const rows: { ok: boolean; title: string; why: string; action: () => void; label: string; hide?: boolean }[] = [
    { ok: p.microphone, title: 'Microphone', why: 'To hear your wake word and commands.', action: () => void ask('microphone'), label: 'Allow' },
    { ok: p.notifications, title: 'Notifications', why: 'For reminders, alarms and the listening indicator.', action: () => void ask('notifications'), label: 'Allow' },
    { ok: p.contacts, title: 'Contacts', why: 'So “call Mom” finds the right person. Stays on your phone.', action: () => void ask('contacts'), label: 'Allow' },
    { ok: p.phone, title: 'Phone calls', why: 'Jarvis places the call itself; otherwise the dialer opens and you tap call.', action: () => void ask('phone'), label: 'Allow' },
    { ok: p.overlay, title: 'Display over other apps', why: '“Hey Jarvis” can then open the app while you use another one.', action: () => open('overlay'), label: 'Open settings' },
    { ok: p.batteryUnrestricted, title: 'Unrestricted battery', why: 'Stops Android from silently stopping the listener and alarms.', action: () => open('battery'), label: 'Allow' },
    { ok: p.fullScreen, title: 'Full-screen alerts', why: 'Ringing alerts can light up the lock screen like a call.', action: () => open('fullScreen'), label: 'Open settings', hide: st.sdk < 34 },
    { ok: p.exactAlarms, title: 'Alarms & reminders', why: 'Alerts ring at the exact minute.', action: () => open('exactAlarm'), label: 'Open settings', hide: st.sdk < 31 },
  ]
  const missing = rows.filter((r) => !r.hide && !r.ok).length
  return (
    <Block title={missing ? `Setup: ${missing} step${missing === 1 ? '' : 's'} left` : 'All set up'} icon={<Check className="h-4 w-4" />}>
      <ul className="divide-y divide-line">
        {rows.filter((r) => !r.hide).map((r) => (
          <li key={r.title} className="flex items-center gap-3 py-2.5">
            <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full', r.ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>{r.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</span>
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{r.title}</div><div className="text-xs text-muted">{r.why}</div></div>
            {!r.ok && <Button size="sm" variant="soft" className="shrink-0" onClick={r.action}>{r.label}</Button>}
          </li>
        ))}
      </ul>
      {OEM.test(st.manufacturer) && (
        <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
          <BatteryCharging className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">On {st.manufacturer} phones, also turn on <b>Autostart</b> (or “Allow background activity”) for Lakshya Jarvis, or the phone may stop the listener.
            <button onClick={() => open('app')} className="ml-1 font-semibold text-primary">Open app settings</button>
          </div>
        </div>
      )}
    </Block>
  )
}

function PhraseEditor({ phrases, unknown, onChange }: { phrases: string[]; unknown: string[]; onChange: (p: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const p = draft.trim().toLowerCase().replace(/[^\p{L}\s']/gu, '').replace(/\s+/g, ' ')
    if (!p || p.split(' ').length < 2) return toast.error('Use at least two words, e.g. “hey jarvis”, so it doesn’t wake by mistake.')
    if (phrases.includes(p)) return setDraft('')
    onChange([...phrases, p])
    setDraft('')
  }
  return (
    <Field label="Wake phrases">
      <div className="flex flex-wrap gap-2">
        {phrases.map((p) => (
          <span key={p} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-3 text-xs font-semibold text-primary-soft-fg">
            {p}
            <button onClick={() => phrases.length > 1 && onChange(phrases.filter((x) => x !== p))} className="grid h-5 w-5 place-items-center rounded-full hover:bg-black/10" aria-label={`Remove ${p}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Add a phrase, e.g. ok jarvis" aria-label="New wake phrase" />
        <Button variant="soft" className="shrink-0" icon={<Plus className="h-4 w-4" />} onClick={add}>Add</Button>
        <Button variant="ghost" className="shrink-0" onClick={() => onChange(DEFAULT_WAKE_PHRASES)} aria-label="Reset wake phrases"><RotateCcw className="h-4 w-4" /></Button>
      </div>
      {unknown.length > 0 && <p className="mt-1.5 text-xs text-warning">The offline model doesn't know: {unknown.join(', ')}. Try spelling it how it sounds, using common English words.</p>}
    </Field>
  )
}

function Training({ s, set }: { s: JarvisSettings; set: (fn: (s: JarvisSettings) => JarvisSettings) => void }) {
  const { tz, h24 } = useAppData()
  const [probe, setProbe] = useState('')
  const [heard, setHeard] = useState('')
  const [meant, setMeant] = useState('')
  const [sc, setSc] = useState<Shortcut>({ phrase: '', action: 'command', value: '' })

  const understood = useMemo(() => {
    if (!probe.trim()) return null
    const now = new Date()
    const { command: c } = parseCommand(probe, { now, tz, corrections: s.corrections, shortcuts: s.shortcuts, autocorrect: s.autocorrect })
    const when = (w: Parameters<typeof resolveWhen>[0], purpose: Parameters<typeof resolveWhen>[1]['purpose']) => {
      const r = resolveWhen(w, { now, tz, purpose })
      if (!r.dateKey) return ''
      return `${spokenDay(r.dateKey, now, tz)}${r.hasTime && r.start ? ` at ${spokenTime(r.start, tz, h24)}` : ''}`
    }
    switch (c.kind) {
      case 'create': return `${({ event: 'Calendar event', meeting: 'Meeting', task: c.remind ? 'Reminder' : 'Task', note: 'Note' })[c.target]}: “${c.title || '(asks for a name)'}”${c.target !== 'note' ? ` ${when(c.when, c.target === 'meeting' ? 'meeting' : c.target === 'task' ? 'task' : 'event') || '(asks when)'}` : ''}${c.participants.length ? ` · with ${c.participants.join(', ')}` : ''}`
      case 'alarm': return `Alarm ${when(c.when, 'alarm') || '(asks the time)'}`
      case 'agenda': return `Reads your ${c.focus === 'all' ? 'schedule' : c.focus} ${c.when.dateKey ? when(c.when, 'agenda') : ''}`.trim()
      case 'navigate': return `Opens ${c.label}`
      case 'shortcut': return `Runs your shortcut “${s.shortcuts[c.index]?.phrase}”`
      case 'call': return c.number ? `Calls ${c.number}` : `Calls “${c.who}” from your contacts${c.label ? ` (${c.label})` : ''}`
      case 'learn': return `Learns: “${c.heard}” means “${c.meant}”`
      case 'info': return c.say
      case 'item': {
        const what = [c.ref.next ? 'next' : '', c.ref.all ? 'all' : '', c.ref.words.join(' ') || c.ref.kind || 'item'].filter(Boolean).join(' ')
        const day = c.ref.when.dateKey ? ` ${when(c.ref.when, 'agenda')}` : ''
        const a = c.action
        const did = a.op === 'delete' ? 'Cancels / deletes' : a.op === 'complete' ? 'Marks done:' : a.op === 'rename' ? `Renames to “${a.title}”:` : a.op === 'extend' ? `${a.minutes > 0 ? 'Extends' : 'Shortens'} by ${Math.abs(a.minutes)} min:` : 'Moves'
        const to = a.op === 'move' ? (a.shiftMin !== undefined ? ` by ${a.shiftMin} min` : a.when ? ' to the new time' : ' (asks when)') : ''
        return `${did} “${what}”${day}${to}`
      }
      case 'unknown': return c.title ? `Not sure. Jarvis will ask what to do with “${c.title}”.` : 'Not understood yet. Add a shortcut or correction below.'
      default: return ({ motivate: 'Motivates you', balance: 'Work–life balance check', briefing: 'Daily briefing', timer: 'Timer', focus: 'Starts focus mode', undo: 'Undo the last item', help: 'Shows help', greet: 'Greets you', thanks: "You're welcome", cancel: 'Closes Jarvis', time: 'Tells the time', date: 'Tells the date', yes: 'Yes', no: 'No' } as Record<string, string>)[c.kind] ?? c.kind
    }
  }, [probe, tz, h24, s.corrections, s.shortcuts])

  return (
    <Block title="Train Jarvis" icon={<GraduationCap className="h-4 w-4" />} description="Jarvis follows fixed rules, so you can predict and teach it. Test a sentence, fix words it mishears, and add your own shortcuts.">
      <Field label="Try a sentence" htmlFor="jv-probe" hint={understood ?? 'e.g. “kal shaam 6 baje Rahul ke saath meeting”'}>
        <Input id="jv-probe" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Type what you would say" />
      </Field>

      <div>
        <div className="label">Corrections (when it hears X, it means Y)</div>
        {s.corrections.length > 0 && (
          <ul className="mb-2 divide-y divide-line rounded-xl border border-line">
            {s.corrections.map((c, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate"><span className="text-muted">“{c.heard}”</span> → <b>{c.meant}</b></span>
                <button onClick={() => set((x) => ({ ...x, corrections: x.corrections.filter((_, j) => j !== i) }))} aria-label={`Remove correction ${c.heard}`}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!heard.trim() || !meant.trim()) return; set((x) => ({ ...x, corrections: [...x.corrections, { heard: heard.trim(), meant: meant.trim() }] })); setHeard(''); setMeant('') }}>
          <Input value={heard} onChange={(e) => setHeard(e.target.value)} placeholder="It hears… (lucky shah)" aria-label="Misheard words" className="min-w-0 flex-1 basis-32" />
          <Input value={meant} onChange={(e) => setMeant(e.target.value)} placeholder="You mean… (Lakshya)" aria-label="Correct words" className="min-w-0 flex-1 basis-32" />
          <Button type="submit" variant="soft" icon={<Plus className="h-4 w-4" />}>Add</Button>
        </form>
      </div>

      <div>
        <div className="label">Shortcuts</div>
        {s.shortcuts.length > 0 && (
          <ul className="mb-2 divide-y divide-line rounded-xl border border-line">
            {s.shortcuts.map((x, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">“{x.phrase}” → <span className="text-muted">{x.action === 'command' ? 'runs' : x.action === 'open' ? 'opens' : 'says'}</span> <b>{x.value}</b></span>
                <button onClick={() => set((y) => ({ ...y, shortcuts: y.shortcuts.filter((_, j) => j !== i) }))} aria-label={`Remove shortcut ${x.phrase}`}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]" onSubmit={(e) => {
          e.preventDefault()
          if (!sc.phrase.trim() || !sc.value.trim()) return
          set((x) => ({ ...x, shortcuts: [...x.shortcuts, { phrase: sc.phrase.trim(), action: sc.action, value: sc.value.trim() }] }))
          setSc({ phrase: '', action: 'command', value: '' })
        }}>
          <Input value={sc.phrase} onChange={(e) => setSc({ ...sc, phrase: e.target.value })} placeholder="When I say… (office mode)" aria-label="Shortcut phrase" />
          <Select value={sc.action} onChange={(e) => setSc({ ...sc, action: e.target.value as Shortcut['action'] })} aria-label="Shortcut action">
            <option value="command">run</option><option value="open">open page</option><option value="say">reply</option>
          </Select>
          <Input value={sc.value} onChange={(e) => setSc({ ...sc, value: e.target.value })} placeholder={sc.action === 'open' ? '/work' : sc.action === 'say' ? 'Reply text' : "what's my schedule today"} aria-label="Shortcut value" />
          <Button type="submit" variant="soft" icon={<Plus className="h-4 w-4" />}>Add</Button>
        </form>
      </div>
    </Block>
  )
}
