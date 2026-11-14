import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { priorityMeta, taskStatusMeta, projectStatusMeta } from '@/lib/constants'
import type { Priority, ProjectStatus, TaskStatus } from '@/types/db'

export function Card({ children, className, title, action, icon, padded = true }: {
  children: ReactNode
  className?: string
  title?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  padded?: boolean
}) {
  return (
    <section className={cn('card min-w-0', padded && 'p-4 sm:p-5', className)}>
      {(title || action) && (
        <header className={cn('mb-3 flex items-center gap-2', !padded && 'px-4 pt-4 sm:px-5')}>
          {icon && <span className="text-primary">{icon}</span>}
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-bold tracking-[0.14em] text-primary uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Badge({ children, color, className, solid }: { children: ReactNode; color?: string; className?: string; solid?: boolean }) {
  return (
    <span
      className={cn('chip', !color && 'bg-surface-2 text-muted', className)}
      style={color ? (solid ? { background: color, color: '#fff' } : { background: `${color}1f`, color }) : undefined}
    >
      {children}
    </span>
  )
}

export function PriorityBadge({ priority, compact }: { priority: Priority; compact?: boolean }) {
  const m = priorityMeta(priority)
  return (
    <Badge color={m.color}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {!compact && m.label}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const m = taskStatusMeta(status)
  return <Badge color={m.color}>{m.label}</Badge>
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const m = projectStatusMeta(status)
  return <Badge color={m.color}>{m.label}</Badge>
}

export function ProgressBar({ value, color, className, label }: { value: number; color?: string; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v}%`, background: color ?? 'var(--primary)' }} />
    </div>
  )
}

export function ProgressRing({ value, size = 64, stroke = 7, color, children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${v}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'var(--primary)'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (v / 100) * c} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children ?? <span className="text-sm font-bold">{v}%</span>}</div>
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; icon?: ReactNode }[]
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="tablist" className={cn('scrollbar-none inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'primary' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    primary: 'bg-primary-soft text-primary-soft-fg',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  }
  return (
    <div className="card flex min-w-0 items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
      {icon && <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-10 sm:w-10', tones[tone ?? 'primary'])}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-xs leading-tight font-semibold break-words text-muted">{label}</div>
        <div className="text-lg font-extrabold tracking-tight tabular-nums sm:text-xl">{value}</div>
        {hint && <div className="truncate text-[11px] text-subtle">{hint}</div>}
      </div>
    </div>
  )
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  return (
    <div className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted">{children}</kbd>
}
