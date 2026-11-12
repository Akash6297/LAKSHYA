import { useState } from 'react'
import { Bell, Check, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { REMINDER_PRESETS, SWATCHES, reminderLabel } from '@/lib/constants'
import { useAppData } from '@/providers/AppDataProvider'
import { Select } from './form'

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SWATCHES.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Color ${c}`}
          className="grid h-7 w-7 place-items-center rounded-full ring-offset-2 ring-offset-surface transition hover:scale-110"
          style={{ background: c, boxShadow: value.toLowerCase() === c.toLowerCase() ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined }}>
          {value.toLowerCase() === c.toLowerCase() && <Check className="h-3.5 w-3.5 text-white" />}
        </button>
      ))}
      <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-dashed border-line-strong" title="Custom color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        <Plus className="m-auto mt-1.5 h-3.5 w-3.5 text-muted" />
      </label>
    </div>
  )
}

export function CategorySelect({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) {
  const { categories } = useAppData()
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No category</option>
      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </Select>
  )
}

/** Choose any number of reminder offsets (minutes before). */
export function ReminderPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [custom, setCustom] = useState('')
  const [unit, setUnit] = useState<'m' | 'h' | 'd'>('m')
  const sorted = [...value].sort((a, b) => b - a)
  const add = (m: number) => {
    if (m >= 0 && m <= 10080 && !value.includes(m)) onChange([...value, m])
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((m) => (
          <span key={m} className="chip bg-primary-soft py-1 text-primary-soft-fg">
            <Bell className="h-3 w-3" /> {reminderLabel(m)}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== m))} aria-label={`Remove reminder ${reminderLabel(m)}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {!value.length && <span className="text-xs text-subtle">No reminders</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REMINDER_PRESETS.filter((p) => !value.includes(p.value)).map((p) => (
          <button key={p.value} type="button" onClick={() => add(p.value)}
            className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-muted hover:border-primary hover:text-primary">
            + {p.label.replace(' before', '')}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="number" min={1} max={unit === 'd' ? 7 : unit === 'h' ? 168 : 10080} value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder="Custom" className="field h-8 w-24 py-1 text-xs" aria-label="Custom reminder amount" />
        <select value={unit} onChange={(e) => setUnit(e.target.value as 'm' | 'h' | 'd')} className="field h-8 w-28 py-1 text-xs" aria-label="Custom reminder unit">
          <option value="m">minutes</option><option value="h">hours</option><option value="d">days</option>
        </select>
        <button type="button" className="text-xs font-semibold text-primary disabled:opacity-40" disabled={!custom}
          onClick={() => {
            const n = Number(custom)
            if (n > 0) add(n * (unit === 'd' ? 1440 : unit === 'h' ? 60 : 1))
            setCustom('')
          }}>Add</button>
      </div>
    </div>
  )
}

export function TagInput({ value, onChange, placeholder = 'Add tag…' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const t = draft.trim().toLowerCase().replace(/,/g, '')
    if (t && !value.includes(t) && value.length < 20 && t.length <= 30) onChange([...value, t])
    setDraft('')
  }
  return (
    <div className={cn('field flex min-h-[42px] flex-wrap items-center gap-1.5 py-1.5')}>
      {value.map((t) => (
        <span key={t} className="chip bg-surface-2 py-1 text-fg">
          #{t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={commit}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[80px] flex-1 bg-transparent text-sm outline-none"
        aria-label="Tags"
      />
    </div>
  )
}
