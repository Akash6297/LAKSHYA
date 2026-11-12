import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, CalendarDays, Database, Download, KeyRound, Mail, MessageCircle, Monitor, Moon, Palette, Plus, Send, Shield, Smartphone, Sun, Timer, Trash2, Upload, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/display'
import { Field, Input, Select, Switch } from '@/components/ui/form'
import { ColorPicker, ReminderPicker } from '@/components/ui/pickers'
import { COMMON_TIMEZONES } from '@/lib/constants'
import { exportAll, restoreBackup, toCsv, validateBackup } from '@/lib/backup'
import { downloadFile } from '@/lib/utils'
import { supabase, unwrap } from '@/lib/supabase'
import { isValidTimeZone } from '@shared/time.ts'
import { useAuth } from '@/providers/AuthProvider'
import { useAppData } from '@/providers/AppDataProvider'
import { useTheme, type ThemePref } from '@/providers/ThemeProvider'
import { useConfirm } from '@/providers/ConfirmProvider'
import { useCrud, useRows } from '@/services/resource'
import { currentSubscription, disablePush, enablePush, pushConfigured, pushSupported } from '@/features/pwa/push'
import { whatsappLink } from '@/features/notifications/WhatsAppShare'
import type { Category, Integration, NotificationPrefs } from '@/types/db'

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User }, { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'calendar', label: 'Calendar & time', icon: CalendarDays }, { id: 'focus', label: 'Focus & study', icon: Timer },
  { id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'integrations', label: 'Integrations', icon: Send },
  { id: 'security', label: 'Security', icon: Shield }, { id: 'data', label: 'Data & privacy', icon: Database },
]

function Section({ id, title, icon, children, description }: { id: string; title: string; icon: ReactNode; children: ReactNode; description?: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-24 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold"><span className="text-primary">{icon}</span>{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

const errToast = (e: unknown) => toast.error((e as Error).message)

export default function SettingsPage() {
  useEffect(() => {
    const h = location.hash.slice(1)
    if (h) setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: 'smooth' }), 150)
  }, [])
  return (
    <div>
      <PageHeader title="Settings" subtitle="Make LAKSHYA yours." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-24 lg:mx-0 lg:flex-col lg:self-start lg:px-0" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-fg">
              <s.icon className="h-4 w-4" />{s.label}
            </a>
          ))}
        </nav>
        <div className="min-w-0 space-y-5">
          <ProfileSection />
          <AppearanceSection />
          <CalendarSection />
          <FocusSection />
          <NotificationSection />
          <IntegrationsSection />
          <SecuritySection />
          <DataSection />
        </div>
      </div>
    </div>
  )
}

function ProfileSection() {
  const { profile, updateProfile } = useAppData()
  const { user } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  useEffect(() => setName(profile?.full_name ?? ''), [profile?.full_name])
  return (
    <Section id="profile" title="Profile" icon={<User className="h-4 w-4" />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="pf-n"><Input id="pf-n" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" htmlFor="pf-e" hint="Sign-in email (change via Supabase Auth email change)"><Input id="pf-e" value={user?.email ?? ''} disabled /></Field>
      </div>
      <Button size="sm" disabled={name.trim() === (profile?.full_name ?? '')} onClick={() => updateProfile({ full_name: name.trim() || null }).then(() => toast.success('Profile saved'), errToast)}>Save profile</Button>
    </Section>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const { updateSettings } = useAppData()
  const pick = (t: ThemePref) => { setTheme(t); void updateSettings({ theme: t }).catch(errToast) }
  const opts: { v: ThemePref; label: string; icon: ReactNode }[] = [
    { v: 'light', label: 'Light', icon: <Sun className="h-5 w-5" /> }, { v: 'dark', label: 'Dark', icon: <Moon className="h-5 w-5" /> }, { v: 'system', label: 'System', icon: <Monitor className="h-5 w-5" /> },
  ]
  return (
    <Section id="appearance" title="Appearance" icon={<Palette className="h-4 w-4" />} description="Your choice is saved to your account and synced across devices.">
      <div className="grid grid-cols-3 gap-3">
        {opts.map((o) => (
          <button key={o.v} onClick={() => pick(o.v)} aria-pressed={theme === o.v} className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-semibold transition ${theme === o.v ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line hover:border-line-strong'}`}>
            {o.icon}{o.label}
          </button>
        ))}
      </div>
    </Section>
  )
}

function CalendarSection() {
  const { settings, updateSettings, categories } = useAppData()
  const [tz, setTz] = useState(settings.timezone)
  useEffect(() => setTz(settings.timezone), [settings.timezone])
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const allZones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? COMMON_TIMEZONES
  const save = (p: Parameters<typeof updateSettings>[0]) => updateSettings(p).then(() => toast.success('Saved'), errToast)
  return (
    <Section id="calendar" title="Calendar & time" icon={<CalendarDays className="h-4 w-4" />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Timezone" htmlFor="st-tz" hint={browserTz !== settings.timezone ? `This device is in ${browserTz}.` : 'Matches this device.'}>
          <div className="flex gap-2">
            <Input id="st-tz" list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} />
            <datalist id="tz-list">{[...new Set([...COMMON_TIMEZONES, ...allZones])].map((z) => <option key={z} value={z} />)}</datalist>
            <Button variant="soft" disabled={tz === settings.timezone} onClick={() => isValidTimeZone(tz) ? void save({ timezone: tz }) : toast.error('Unknown timezone')}>Save</Button>
          </div>
        </Field>
        <Field label="Week starts on" htmlFor="st-ws">
          <Select id="st-ws" value={settings.week_starts_on} onChange={(e) => void save({ week_starts_on: Number(e.target.value) })}>
            <option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option>
          </Select>
        </Field>
        <Field label="Time format" htmlFor="st-tf">
          <Select id="st-tf" value={settings.time_format} onChange={(e) => void save({ time_format: e.target.value as '12h' | '24h' })}><option value="12h">12-hour (2:30 PM)</option><option value="24h">24-hour (14:30)</option></Select>
        </Field>
        <Field label="Default calendar view" htmlFor="st-dv">
          <Select id="st-dv" value={settings.default_calendar_view} onChange={(e) => void save({ default_calendar_view: e.target.value })}>
            <option value="timeGridDay">Day</option><option value="timeGridWeek">Week</option><option value="dayGridMonth">Month</option><option value="listMonth">Agenda</option>
          </Select>
        </Field>
        <Field label="Default event length (minutes)" htmlFor="st-de">
          <Select id="st-de" value={settings.default_event_minutes} onChange={(e) => void save({ default_event_minutes: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Working hours"><Link to="/work" className="text-sm font-semibold text-primary">Edit working days and hours in Work →</Link></Field>
      </div>
      <CategoryEditor categories={categories} />
    </Section>
  )
}

function CategoryEditor({ categories }: { categories: Category[] }) {
  const { create, update, remove } = useCrud('categories')
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div>
      <div className="label">Categories & colors</div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {categories.map((c) => (
          <li key={c.id} className="p-2.5">
            <div className="flex items-center gap-3">
              <button className="h-5 w-5 rounded-full ring-2 ring-surface" style={{ background: c.color }} onClick={() => setEditing(editing === c.id ? null : c.id)} aria-label={`Change color of ${c.name}`} />
              <input defaultValue={c.name} maxLength={40} className="flex-1 bg-transparent text-sm font-semibold outline-none" aria-label="Category name"
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && update.mutate({ id: c.id, name: e.target.value.trim() })} />
              <button onClick={async () => { if (await confirm({ title: `Delete “${c.name}”?`, message: 'Items in this category become uncategorised.', danger: true, confirmLabel: 'Delete' })) remove.mutate(c.id) }} aria-label={`Delete ${c.name}`}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button>
            </div>
            {editing === c.id && <div className="mt-2 pl-8"><ColorPicker value={c.color} onChange={(color) => update.mutate({ id: c.id, color })} /></div>}
          </li>
        ))}
      </ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => {
        e.preventDefault()
        const n = name.trim()
        if (!n) return
        const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || crypto.randomUUID().slice(0, 8)
        create.mutate({ name: n, slug, color: '#6366F1', sort_order: categories.length + 1 }, { onSuccess: () => setName('') })
      }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" maxLength={40} aria-label="New category name" />
        <Button type="submit" variant="soft" icon={<Plus className="h-4 w-4" />}>Add</Button>
      </form>
    </div>
  )
}

function FocusSection() {
  const { settings, updateSettings } = useAppData()
  const num = (k: keyof typeof settings, label: string, min: number, max: number) => (
    <Field label={label} htmlFor={`fs-${k}`}>
      <Input id={`fs-${k}`} type="number" min={min} max={max} defaultValue={settings[k] as number} key={settings[k] as number}
        onBlur={(e) => { const v = Number(e.target.value); if (v >= min && v <= max && v !== settings[k]) void updateSettings({ [k]: v }).then(() => toast.success('Saved'), errToast) }} />
    </Field>
  )
  return (
    <Section id="focus" title="Focus & study" icon={<Timer className="h-4 w-4" />}>
      <div className="grid gap-4 sm:grid-cols-3">
        {num('focus_minutes', 'Focus (min)', 1, 240)}
        {num('short_break_minutes', 'Short break (min)', 1, 60)}
        {num('long_break_minutes', 'Long break (min)', 1, 120)}
        {num('daily_focus_target_min', 'Daily focus target (min)', 0, 1440)}
        {num('daily_study_target_min', 'Daily study target (min)', 0, 1440)}
        {num('weekly_study_target_min', 'Weekly study target (min)', 0, 10080)}
      </div>
    </Section>
  )
}

function NotificationSection() {
  const { prefs, updatePrefs } = useAppData()
  if (!prefs) return null
  const set = (p: Partial<NotificationPrefs>) => updatePrefs(p).catch(errToast)
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return (
    <Section id="notifications" title="Notification preferences" icon={<Bell className="h-4 w-4" />} description="Reminders are scheduled on the server and delivered to every enabled channel.">
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <Switch label="In-app notifications" checked={prefs.in_app_enabled} onChange={(v) => void set({ in_app_enabled: v })} />
        <Switch label="Browser push" description="Configure below under Integrations" checked={prefs.push_enabled} onChange={(v) => void set({ push_enabled: v })} />
        <Switch label="Email" checked={prefs.email_enabled} onChange={(v) => void set({ email_enabled: v })} />
        <Switch label="Telegram" checked={prefs.telegram_enabled} onChange={(v) => void set({ telegram_enabled: v })} />
      </div>
      <div className="label mt-2">Remind me about</div>
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
        <Switch label="Events" checked={prefs.notify_events} onChange={(v) => void set({ notify_events: v })} />
        <Switch label="Tasks" checked={prefs.notify_tasks} onChange={(v) => void set({ notify_tasks: v })} />
        <Switch label="Meetings" checked={prefs.notify_meetings} onChange={(v) => void set({ notify_meetings: v })} />
        <Switch label="Exams" checked={prefs.notify_exams} onChange={(v) => void set({ notify_exams: v })} />
        <Switch label="Study sessions" checked={prefs.notify_study} onChange={(v) => void set({ notify_study: v })} />
        <Switch label="Project deadlines" checked={prefs.notify_projects} onChange={(v) => void set({ notify_projects: v })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-3">
          <Switch label="Daily agenda" description="Today's schedule, due tasks and overdue count" checked={prefs.daily_agenda_enabled} onChange={(v) => void set({ daily_agenda_enabled: v })} />
          <Input type="time" className="mt-2" value={prefs.daily_agenda_time.slice(0, 5)} onChange={(e) => e.target.value && void set({ daily_agenda_time: e.target.value })} aria-label="Daily agenda time" disabled={!prefs.daily_agenda_enabled} />
        </div>
        <div className="rounded-xl border border-line p-3">
          <Switch label="Weekly summary" description="Completed tasks, focus & study time" checked={prefs.weekly_summary_enabled} onChange={(v) => void set({ weekly_summary_enabled: v })} />
          <div className="mt-2 flex gap-2">
            <Select value={prefs.weekly_summary_dow} onChange={(e) => void set({ weekly_summary_dow: Number(e.target.value) })} disabled={!prefs.weekly_summary_enabled} aria-label="Weekly summary day">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
            <Input type="time" value={prefs.weekly_summary_time.slice(0, 5)} onChange={(e) => e.target.value && void set({ weekly_summary_time: e.target.value })} disabled={!prefs.weekly_summary_enabled} aria-label="Weekly summary time" />
          </div>
        </div>
        <div className="rounded-xl border border-line p-3 sm:col-span-2">
          <Switch label="Quiet hours" description="Push, email and Telegram are held back; in-app notifications are still recorded." checked={prefs.quiet_hours_enabled} onChange={(v) => void set({ quiet_hours_enabled: v })} />
          <div className="mt-2 flex items-center gap-2">
            <Input type="time" value={prefs.quiet_start.slice(0, 5)} onChange={(e) => e.target.value && void set({ quiet_start: e.target.value })} disabled={!prefs.quiet_hours_enabled} aria-label="Quiet hours start" />
            <span className="text-muted">to</span>
            <Input type="time" value={prefs.quiet_end.slice(0, 5)} onChange={(e) => e.target.value && void set({ quiet_end: e.target.value })} disabled={!prefs.quiet_hours_enabled} aria-label="Quiet hours end" />
          </div>
        </div>
      </div>
      <Field label="Default task reminders" hint="Used when a task with a time has no reminders of its own"><ReminderPicker value={prefs.task_default_reminders} onChange={(v) => void set({ task_default_reminders: v })} /></Field>
      <Field label="Project deadline reminders" hint="Relative to 09:00 on the deadline day"><ReminderPicker value={prefs.project_deadline_reminders} onChange={(v) => void set({ project_deadline_reminders: v })} /></Field>
    </Section>
  )
}

async function sendTest(channel: 'push' | 'email' | 'telegram') {
  const { data, error } = await supabase.functions.invoke('notify-test', { body: { channel } })
  if (error) {
    // FunctionsFetchError = the request never got a response (function not deployed, or CORS rejected)
    if (error.name === 'FunctionsFetchError') throw new Error('Could not reach the notify-test function. Deploy it with `npx supabase functions deploy notify-test` (README §6).')
    let msg = error.message
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg } catch { /* keep generic */ }
    throw new Error(msg)
  }
  if (!data?.ok) throw new Error(data?.error ?? 'Test failed')
}

function IntegrationsSection() {
  const { prefs, updatePrefs, settings, updateSettings } = useAppData()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const integrations = useRows('integrations', ['all'])
  const telegram = ((integrations.data ?? []) as Integration[]).find((i) => i.provider === 'telegram')
  const [busy, setBusy] = useState<string | null>(null)
  const [pushOn, setPushOn] = useState(false)
  const [email, setEmail] = useState(prefs?.email_address ?? '')
  const [tg, setTg] = useState({ token: '', chat: '' })
  const [wa, setWa] = useState(settings.whatsapp_number ?? '')
  useEffect(() => { void currentSubscription().then((s) => setPushOn(!!s)) }, [])
  useEffect(() => setEmail(prefs?.email_address ?? ''), [prefs?.email_address])

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key)
    try { await fn(); toast.success(ok) } catch (e) { errToast(e) } finally { setBusy(null) }
  }

  return (
    <Section id="integrations" title="Integrations" icon={<Send className="h-4 w-4" />} description="All secrets stay on the server. Nothing here costs money.">
      {/* Push */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Smartphone className="h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1"><div className="font-semibold">Browser push on this device</div>
            <div className="text-xs text-muted">{!pushSupported() ? 'Not supported in this browser. On iPhone/iPad: Share → Add to Home Screen, then open LAKSHYA from there (iOS 16.4+).' : !pushConfigured() ? 'Server owner must set VITE_VAPID_PUBLIC_KEY.' : pushOn ? 'Enabled on this device. Works when the browser is closed if your OS allows background notifications.' : 'Disabled on this device.'}</div></div>
          {pushSupported() && pushConfigured() && (pushOn
            ? <><Button size="sm" variant="outline" loading={busy === 'push-test'} onClick={() => void run('push-test', () => sendTest('push'), 'Test sent – check your notifications')}>Test</Button>
              <Button size="sm" variant="ghost" onClick={() => void run('push', async () => { await disablePush(); setPushOn(false) }, 'Push disabled on this device')}>Disable</Button></>
            : <Button size="sm" loading={busy === 'push'} onClick={() => void run('push', async () => { await enablePush(); setPushOn(true); if (!prefs?.push_enabled) await updatePrefs({ push_enabled: true }) }, 'Push enabled')}>Enable</Button>)}
        </div>
      </div>

      {/* Email */}
      <div className="rounded-xl border border-line p-4">
        <div className="mb-3 flex items-center gap-3"><Mail className="h-5 w-5 text-primary" /><div className="flex-1"><div className="font-semibold">Email reminders</div><div className="text-xs text-muted">Sent from the server via the owner's SMTP (e.g. Gmail app password) or Brevo free tier.</div></div></div>
        <div className="flex flex-wrap gap-2">
          <Input type="email" className="min-w-0 flex-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Reminder email address" />
          <Button variant="soft" disabled={email === (prefs?.email_address ?? '')} onClick={() => void run('email-save', () => updatePrefs({ email_address: email.trim() || null }), 'Email saved')}>Save</Button>
          <Button variant="outline" loading={busy === 'email'} onClick={() => void run('email', () => sendTest('email'), 'Test email sent')}>Test</Button>
        </div>
      </div>

      {/* Telegram */}
      <div className="rounded-xl border border-line p-4">
        <div className="mb-3 flex items-center gap-3"><Send className="h-5 w-5 text-[#229ED9]" /><div className="flex-1"><div className="font-semibold">Telegram</div>
          <div className="text-xs text-muted">{telegram?.is_configured ? `Connected · ${telegram.display_hint}${telegram.last_error ? ` · last error: ${telegram.last_error}` : ''}` : 'Official Bot API. Free.'}</div></div></div>
        <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-xs text-muted">
          <li>Optional: create your own bot with <b>@BotFather</b> and paste its token. Leave empty to use the server's shared bot (if configured).</li>
          <li>Send any message to the bot, then get your chat id from <b>@userinfobot</b>.</li>
        </ol>
        <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
          <Input type="password" autoComplete="off" value={tg.token} onChange={(e) => setTg({ ...tg, token: e.target.value })} placeholder={telegram?.is_configured ? 'Bot token saved (hidden) – enter to replace' : 'Bot token (optional)'} aria-label="Telegram bot token" />
          <Input inputMode="numeric" value={tg.chat} onChange={(e) => setTg({ ...tg, chat: e.target.value })} placeholder="Chat id" aria-label="Telegram chat id" />
          <Button variant="soft" disabled={!tg.chat} loading={busy === 'tg-save'} onClick={() => void run('tg-save', async () => {
            unwrap(await supabase.rpc('save_telegram_integration', { p_bot_token: tg.token.trim(), p_chat_id: tg.chat.trim() }))
            setTg({ token: '', chat: '' })
            await qc.invalidateQueries({ queryKey: ['integrations'] })
            if (!prefs?.telegram_enabled) await updatePrefs({ telegram_enabled: true })
          }, 'Telegram saved')}>Save</Button>
        </div>
        {telegram?.is_configured && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" loading={busy === 'tg'} onClick={() => void run('tg', async () => { await sendTest('telegram'); await qc.invalidateQueries({ queryKey: ['integrations'] }) }, 'Telegram message sent')}>Send test</Button>
            <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Disconnect Telegram?', danger: true, confirmLabel: 'Disconnect' })) void run('tg-rm', async () => { unwrap(await supabase.rpc('remove_integration', { p_provider: 'telegram' })); await qc.invalidateQueries({ queryKey: ['integrations'] }) }, 'Telegram disconnected') }}>Disconnect</Button>
          </div>
        )}
      </div>

      {/* WhatsApp */}
      <div className="rounded-xl border border-line p-4">
        <div className="mb-2 flex items-center gap-3"><MessageCircle className="h-5 w-5 text-[#25D366]" /><div className="flex-1"><div className="font-semibold">WhatsApp (click-to-chat)</div>
          <div className="text-xs text-muted">LAKSHYA can <b>not</b> send WhatsApp messages automatically – that needs a paid API. Share buttons open WhatsApp with a prefilled message and <b>you press send</b>.</div></div></div>
        <div className="flex flex-wrap gap-2">
          <Input inputMode="tel" className="min-w-0 flex-1" value={wa} onChange={(e) => setWa(e.target.value.replace(/\D/g, ''))} placeholder="Default number with country code, e.g. 919876543210 (optional)" aria-label="WhatsApp number" />
          <Button variant="soft" onClick={() => void updateSettings({ whatsapp_number: wa || null }).then(() => toast.success('Saved'), errToast)}>Save</Button>
          <a href={whatsappLink('Hello from LAKSHYA 🎯', wa || null)} target="_blank" rel="noopener noreferrer"><Button variant="outline">Try it</Button></a>
        </div>
      </div>
    </Section>
  )
}

function SecuritySection() {
  const { updatePassword, signOut } = useAuth()
  const [pw, setPw] = useState('')
  const valid = pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw)
  return (
    <Section id="security" title="Security" icon={<Shield className="h-4 w-4" />} description="Your data is isolated with Postgres Row Level Security; only your signed-in session can read it.">
      <Field label="Change password" hint="8+ characters with a letter and a number" htmlFor="sec-pw">
        <div className="flex gap-2">
          <Input id="sec-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Button variant="soft" icon={<KeyRound className="h-4 w-4" />} disabled={!valid} onClick={() => updatePassword(pw).then(() => { setPw(''); toast.success('Password updated') }, errToast)}>Update</Button>
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void supabase.auth.signOut({ scope: 'global' }).then(() => signOut())}>Sign out of all devices</Button>
      </div>
    </Section>
  )
}

function DataSection() {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { signOut } = useAuth()
  const { tz } = useAppData()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const stamp = () => new Date().toISOString().slice(0, 10)

  const exportJson = async () => {
    setBusy('json')
    try { const b = await exportAll((t) => setBusy(`json:${t}`)); downloadFile(`lakshya-backup-${stamp()}.json`, JSON.stringify(b, null, 1)); toast.success('Backup downloaded') } catch (e) { errToast(e) } finally { setBusy(null) }
  }
  const exportCsv = async (kind: 'tasks' | 'events') => {
    setBusy(kind)
    try {
      const b = await exportAll()
      const rows = (b.tables[kind] ?? []) as Record<string, unknown>[]
      const cols = kind === 'tasks'
        ? ['title', 'status', 'priority', 'start_date', 'due_date', 'due_at', 'completed_at', 'tags', 'description', 'created_at']
        : ['title', 'start_at', 'end_at', 'all_day', 'timezone', 'rrule', 'location', 'meeting_url', 'description', 'tags']
      downloadFile(`lakshya-${kind === 'tasks' ? 'tasks' : 'calendar'}-${stamp()}.csv`, '﻿' + toCsv(rows, cols), 'text/csv;charset=utf-8')
    } catch (e) { errToast(e) } finally { setBusy(null) }
  }
  const restore = async (f: File) => {
    try {
      if (f.size > 50 * 1024 * 1024) throw new Error('Backup file is too large (max 50 MB).')
      const b = validateBackup(JSON.parse(await f.text()))
      const total = Object.values(b.tables).reduce((a, r) => a + (r?.length ?? 0), 0)
      if (!(await confirm({ title: 'Restore backup?', message: `${total} records from ${new Date(b.exported_at).toLocaleString('en-IN', { timeZone: tz })} will be ADDED to your account as copies. Existing data is not modified. The restore runs as one transaction – it fully succeeds or changes nothing.`, confirmLabel: 'Restore' }))) return
      setBusy('restore')
      const counts = await restoreBackup(b)
      await qc.invalidateQueries()
      toast.success(`Restored ${Object.values(counts).reduce((a, n) => a + n, 0)} records`)
    } catch (e) { errToast(e) } finally { setBusy(null) }
  }
  const wipe = async () => {
    if (!(await confirm({ title: 'Delete all personal data?', message: 'Every task, event, project, note, goal, habit and log is permanently deleted. Your account and settings remain. Download a backup first.', danger: true, confirmLabel: 'Delete everything', typeToConfirm: 'DELETE ALL DATA' }))) return
    try { unwrap(await supabase.rpc('delete_all_my_data')); await qc.invalidateQueries(); toast.success('All personal data deleted') } catch (e) { errToast(e) }
  }
  const deleteAccount = async () => {
    if (!(await confirm({ title: 'Delete your account?', message: 'Your account and ALL data are permanently deleted. This cannot be undone.', danger: true, confirmLabel: 'Delete account', typeToConfirm: 'DELETE MY ACCOUNT' }))) return
    setDeleting(true)
    try {
      const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE MY ACCOUNT' } })
      if (error) throw new Error('Could not delete account. Is the delete-account function deployed?')
      await signOut()
    } catch (e) { errToast(e) } finally { setDeleting(false) }
  }

  return (
    <Section id="data" title="Data & privacy" icon={<Database className="h-4 w-4" />}
      description="You own your data. It lives in your own Supabase project. LAKSHYA has no analytics, ads or trackers. Backups are manual: download one regularly – Supabase's free plan does not include automatic backups.">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Download className="h-4 w-4" />} loading={busy?.startsWith('json')} onClick={() => void exportJson()}>{busy?.startsWith('json:') ? `Exporting ${busy.slice(5)}…` : 'Full backup (JSON)'}</Button>
        <Button variant="outline" icon={<Download className="h-4 w-4" />} loading={busy === 'tasks'} onClick={() => void exportCsv('tasks')}>Tasks (CSV)</Button>
        <Button variant="outline" icon={<Download className="h-4 w-4" />} loading={busy === 'events'} onClick={() => void exportCsv('events')}>Calendar (CSV)</Button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = '' }} />
        <Button variant="outline" icon={<Upload className="h-4 w-4" />} loading={busy === 'restore'} onClick={() => file.current?.click()}>Import / restore backup</Button>
      </div>
      <div className="rounded-xl border border-danger/40 bg-danger-soft p-4">
        <div className="font-semibold text-danger">Danger zone</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void wipe()}>Delete all personal data</Button>
          <Button variant="danger" loading={deleting} onClick={() => void deleteAccount()}>Delete account</Button>
        </div>
      </div>
    </Section>
  )
}
