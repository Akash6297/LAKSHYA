// Shared chart chrome. Palette comes from validated --series-N tokens (fixed
// order, never cycled). Every chart offers a table view (contrast relief rule)
// and a hover tooltip; ≥2 series always get a legend.
import { useState, type ReactNode } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

export const axisProps = {
  stroke: 'var(--chart-axis)',
  tick: { fill: 'var(--chart-axis)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--line-strong)' },
} as const

export const gridProps = { stroke: 'var(--chart-grid)', strokeDasharray: '0', vertical: false } as const

interface TipEntry { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }

export function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: TipEntry[]; label?: string | number; format?: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <div className="mb-1 font-semibold text-fg">{label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-semibold text-fg tabular-nums">{typeof p.value === 'number' && format ? format(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => <li key={i.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</li>)}
    </ul>
  )
}

/** Card with a chart ↔ table toggle. `rows` feeds the table view. */
export function ChartCard({ title, subtitle, children, rows, columns, className, empty }: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  rows: Record<string, string | number>[]
  columns: { key: string; label: string }[]
  className?: string
  empty?: boolean
}) {
  const [table, setTable] = useState(false)
  return (
    <section className={cn('card min-w-0 p-4 sm:p-5', className)}>
      <header className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <button onClick={() => setTable(!table)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={table ? 'Show chart' : 'Show table'} title={table ? 'Show chart' : 'Show table'}>
          {table ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
        </button>
      </header>
      {empty ? <div className="grid h-48 place-items-center text-sm text-muted">No data for this period yet.</div> : table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr>{columns.map((c) => <th key={c.key} className="sticky top-0 bg-surface py-1.5 text-left text-xs font-semibold text-muted">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{columns.map((c) => <td key={c.key} className="py-1.5 tabular-nums">{r[c.key]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  )
}
