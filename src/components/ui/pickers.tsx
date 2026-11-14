import { useState } from 'react'
import { Bell, Check, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { REMINDER_PRESETS, SWATCHES, reminderLabel } from '@/lib/constants'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAppData } from '@/providers/AppDataProvider'
import { useCrud } from '@/services/resource'
import { Button } from './Button'
import { Input, Select } from './form'

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

const DEFAULT_CATEGORIES: [string, string][] = [
  ['Office', '#6366F1'], ['Projects', '#8B5CF6'], ['Studies', '#0EA5E9'], ['Meetings', '#14B8A6'], ['Personal', '#F59E0B'],
  ['Exams', '#EF4444'], ['Deadlines', '#F43F5E'], ['Health', '#10B981'], ['Family', '#EC4899'], ['Other', '#64748B'],
]

/**
 * Create categories with friendly validation: duplicate names are rejected
 * up front (instead of a raw unique-constraint error) and slugs never collide,
 * even for names with no Latin characters (e.g. Hindi).
 */
export function useCreateCategory() {
  const { categories } = useAppData()
  const { create, createMany } = useCrud('categories')
  const taken = new Set(categories.map((c) => c.slug))
  const slugFor = (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'cat'
    let slug = base
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
    taken.add(slug)
    return slug
  }
  const add = async (rawName: string, color?: string) => {
    const name = rawName.trim().slice(0, 40)
    if (!name) throw new Error('Enter a category name')
    const dup = categories.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (dup) throw new Error(`“${dup.name}” already exists`)
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0)
    return create.mutateAsync({ name, slug: slugFor(name), color: color ?? SWATCHES[categories.length % SWATCHES.length], sort_order: maxOrder + 1 })
  }
  const restoreDefaults = () => {
    const have = new Set(categories.map((c) => c.name.toLowerCase()))
    const rows = DEFAULT_CATEGORIES.filter(([n]) => !have.has(n.toLowerCase()))
      .map(([name, color], i) => ({ name, slug: slugFor(name), color, sort_order: categories.length + i + 1 }))
    return rows.length ? createMany.mutateAsync(rows) : Promise.resolve([])
  }
  return { add, restoreDefaults, pending: create.isPending || createMany.isPending }
}

const NEW = '__new__'

export function CategorySelect({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) {
  const { categories } = useAppData()
  const { add, pending } = useCreateCategory()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    try {
      const row = await add(name)
      onChange(row.id)
      setAdding(false); setName(''); setErr(null)
      toast.success(`Category “${row.name}” created`)
    } catch (e) { setErr((e as Error).message) }
  }
  if (adding) {
    return (
      <div>
        <div className="flex gap-2">
          <Input id={id} autoFocus value={name} maxLength={40} placeholder="New category name" aria-label="New category name" invalid={!!err}
            onChange={(e) => { setName(e.target.value); setErr(null) }}
            // Enter must not submit the surrounding task/event form
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } if (e.key === 'Escape') { e.stopPropagation(); setAdding(false) } }} />
          <Button size="sm" className="h-auto shrink-0" aria-label="Add category" loading={pending} onClick={() => void submit()}>Add</Button>
          <button type="button" className="shrink-0 rounded-lg px-1 text-muted hover:text-fg" onClick={() => { setAdding(false); setErr(null) }} aria-label="Cancel new category"><X className="h-4 w-4" /></button>
        </div>
        {err && <p role="alert" className="mt-1 text-xs font-medium text-danger">{err}</p>}
      </div>
    )
  }
  return (
    <div>
      <Select id={id} value={value ?? ''} onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value || null))}>
        <option value="">No category</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value={NEW}>+ New category…</option>
      </Select>
      {!categories.length && <p className="mt-1 text-xs text-subtle">No categories yet – choose “+ New category…” or restore the defaults in <Link to="/settings#categories" className="font-semibold text-primary">Settings → Categories</Link>.</p>}
    </div>
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
