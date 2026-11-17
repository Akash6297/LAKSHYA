import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlarmClock, CalendarDays, CheckSquare, Keyboard, Mic, MicOff, Quote as QuoteIcon, Send, Settings2, Sparkles, StickyNote, Timer, Undo2, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmt } from '@/lib/dates'
import type { Card } from './brain'
import { HELP_EXAMPLES } from './brain'

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface Turn {
  id: number
  who: 'you' | 'jarvis'
  text: string
  card?: Card
  error?: boolean
  /** this turn created the item that Undo would remove */
  undoable?: boolean
}

const SUGGESTIONS = ["What's my day?", 'Motivate me', "What's next?", 'Add a meeting tomorrow at 11', 'Take a note', 'Am I working too much?']

const TARGET_ICON = { event: CalendarDays, meeting: Users, task: CheckSquare, note: StickyNote, alarm: AlarmClock, timer: Timer } as const

export function JarvisOverlay(props: {
  open: boolean
  phase: Phase
  partial: string
  turns: Turn[]
  level: number
  canListen: boolean
  tz: string
  h24: boolean
  onMic: () => void
  onClose: () => void
  onText: (text: string) => void
  onUndo: () => void
  onOpenItem: () => void
  onSettings: () => void
}) {
  const { open, phase, partial, turns, level, canListen, tz, h24 } = props
  const [typing, setTyping] = useState(!canListen)
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [turns.length, partial])
  useEffect(() => { if (typing && open) input.current?.focus() }, [typing, open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } }
    document.addEventListener('keydown', onKey, true)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey, true); document.body.style.overflow = '' }
  }, [open, props.onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const t = draft.trim()
    if (!t) return
    setDraft('')
    props.onText(t)
  }
  const status = phase === 'listening' ? 'Listening…' : phase === 'thinking' ? 'Thinking…' : phase === 'speaking' ? 'Speaking…' : canListen ? 'Tap the orb and speak' : 'Type a command below'

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg animate-fade-in" role="dialog" aria-modal="true" aria-label="Jarvis assistant">
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: 'radial-gradient(600px 400px at 50% 85%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 70%)' }} />

      <header className="relative flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2 sm:px-6">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-pop"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold tracking-wide">JARVIS</div>
          <div className="truncate text-xs text-muted" aria-live="polite">{status}</div>
        </div>
        <button onClick={props.onSettings} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" aria-label="Jarvis settings"><Settings2 className="h-5 w-5" /></button>
        <button onClick={props.onClose} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close Jarvis"><X className="h-5 w-5" /></button>
      </header>

      <div ref={scroller} className="relative mx-auto w-full max-w-2xl flex-1 space-y-3 overflow-y-auto px-4 pt-4 pb-6 sm:px-6">
        {!turns.length && !partial && (
          <div className="pt-6 text-center">
            <p className="text-2xl font-extrabold tracking-tight sm:text-3xl">How can I help?</p>
            <p className="mt-2 text-sm text-muted">Say “Hey Jarvis”, tap the orb, or try one of these.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => props.onText(s)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-fg shadow-soft hover:border-primary/50">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className={cn('flex animate-slide-up', t.who === 'you' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[88%] min-w-0', t.who === 'you' ? 'text-right' : '')}>
              <div className={cn(
                'inline-block rounded-2xl px-4 py-2.5 text-left break-words',
                t.who === 'you' ? 'bg-primary text-primary-fg text-sm font-semibold' : 'bg-surface text-[15px] leading-relaxed shadow-soft border border-line',
                t.error && 'border-danger/40 bg-danger-soft text-danger',
              )}>{t.text}</div>
              {t.card && <CardView card={t.card} tz={tz} h24={h24} undoable={!!t.undoable} onUndo={props.onUndo} onOpen={props.onOpenItem} onExample={props.onText} />}
            </div>
          </div>
        ))}
        {partial && (
          <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl border border-dashed border-primary/40 px-4 py-2.5 text-sm text-muted italic">{partial}</div></div>
        )}
      </div>

      <footer className="relative mx-auto w-full max-w-2xl px-4 pb-[max(env(safe-area-inset-bottom),16px)] sm:px-6">
        {typing ? (
          <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
            {canListen && <button type="button" onClick={() => { setTyping(false); props.onMic() }} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label="Speak instead"><Mic className="h-5 w-5" /></button>}
            <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a command, e.g. meeting with Rahul tomorrow at 5" aria-label="Command"
              className="h-11 min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none placeholder:text-subtle" enterKeyHint="send" autoComplete="off" />
            <button type="submit" disabled={!draft.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-fg disabled:opacity-40" aria-label="Send"><Send className="h-5 w-5" /></button>
          </form>
        ) : (
          <div className="flex items-center justify-center gap-8">
            <button onClick={() => setTyping(true)} className="grid h-12 w-12 place-items-center rounded-2xl text-muted hover:bg-surface-2 hover:text-fg" aria-label="Type instead"><Keyboard className="h-5 w-5" /></button>
            <Orb phase={phase} level={level} onClick={props.onMic} />
            <span className="h-12 w-12" aria-hidden />
          </div>
        )}
      </footer>
    </div>,
    document.body,
  )
}

function Orb({ phase, level, onClick }: { phase: Phase; level: number; onClick: () => void }) {
  // rms from the recogniser is roughly -2..10 dB; map to a 1..1.35 scale
  const scale = phase === 'listening' ? 1 + Math.min(0.35, Math.max(0, level) / 28) : 1
  const label = phase === 'listening' ? 'Stop listening' : 'Start listening'
  return (
    <button onClick={onClick} aria-label={label} className="group relative grid h-24 w-24 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]">
      {phase === 'listening' && (
        <>
          <span className="jarvis-ripple absolute inset-0 rounded-full bg-primary/40" />
          <span className="jarvis-ripple absolute inset-0 rounded-full bg-fuchsia-500/30 [animation-delay:600ms]" />
        </>
      )}
      <span className={cn('absolute inset-0 rounded-full bg-gradient-to-br from-primary via-violet-500 to-fuchsia-500 shadow-pop transition-transform duration-100',
        phase === 'thinking' && 'jarvis-spin', phase === 'idle' && 'jarvis-breathe', phase === 'speaking' && 'jarvis-speak')}
        style={{ transform: `scale(${scale})` }} />
      <span className="absolute inset-[6px] rounded-full bg-[radial-gradient(circle_at_35%_30%,rgb(255_255_255/0.55),transparent_55%)]" />
      <span className="relative text-white drop-shadow">{phase === 'listening' ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}</span>
    </button>
  )
}

function CardView({ card, tz, h24, undoable, onUndo, onOpen, onExample }: { card: Card; tz: string; h24: boolean; undoable: boolean; onUndo: () => void; onOpen: () => void; onExample: (t: string) => void }) {
  if (card.type === 'quote') {
    return (
      <figure className="mt-2 rounded-2xl border border-line bg-surface-2 p-4 text-left">
        <QuoteIcon className="h-4 w-4 text-primary" />
        <blockquote className="mt-1 text-[15px] leading-relaxed font-semibold">{card.quote.text}</blockquote>
        {card.quote.by && <figcaption className="mt-1 text-xs text-muted">— {card.quote.by}</figcaption>}
      </figure>
    )
  }
  if (card.type === 'help') {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {HELP_EXAMPLES.map((e) => <button key={e} onClick={() => onExample(e)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:border-primary/50">{e}</button>)}
      </div>
    )
  }
  if (card.type === 'list') {
    return (
      <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-soft">
        <div className="border-b border-line px-4 py-2 text-xs font-bold tracking-wide text-muted uppercase">{card.title}</div>
        <ul className="divide-y divide-line">
          {card.rows.slice(0, 8).map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-muted tabular-nums">{r.allDay ? 'All day' : fmt(r.start, tz, h24 ? 'HH:mm' : 'h:mm a')}</span>
              <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', r.done && 'text-muted line-through')}>{r.title.replace(/^[☐⚑🌴]\s*/u, '')}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const Icon = TARGET_ICON[card.target]
  return (
    <div className="mt-2 flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left shadow-soft">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-fg"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold break-words">{card.title}</div>
        {card.when && <div className="mt-0.5 text-xs font-semibold text-primary">{card.when}</div>}
        {card.detail && <div className="mt-0.5 line-clamp-3 text-xs text-muted">{card.detail}</div>}
        {undoable && (
          <div className="mt-2 flex gap-2">
            <button onClick={onOpen} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold hover:bg-surface-3">Open</button>
            <button onClick={onUndo} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger-soft"><Undo2 className="h-3.5 w-3.5" />Undo</button>
          </div>
        )}
      </div>
    </div>
  )
}
