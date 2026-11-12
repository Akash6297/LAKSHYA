import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden />
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl p-2">
          <Skeleton className="h-5 w-5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8', className)} role="status" aria-label="Loading">
      <circle cx="32" cy="32" r="22" fill="none" stroke="var(--primary)" strokeWidth="5" strokeDasharray="110 40" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="1s" repeatCount="indefinite" />
      </circle>
      <circle cx="32" cy="32" r="6" fill="var(--primary)" />
    </svg>
  )
}

export function FullPageLoader() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner className="h-12 w-12" />
    </div>
  )
}

type Art = 'target' | 'tasks' | 'calendar' | 'notes' | 'sparkle' | 'inbox'

/** Geometric, on-brand empty-state art (no generic calendar clip-art). */
function Illustration({ art }: { art: Art }) {
  const p = 'var(--primary)'
  const common = { width: 120, height: 96, viewBox: '0 0 120 96', 'aria-hidden': true }
  switch (art) {
    case 'tasks':
      return (
        <svg {...common}>
          {[16, 40, 64].map((y, i) => (
            <g key={y} opacity={1 - i * 0.25}>
              <rect x="22" y={y} width="76" height="16" rx="8" fill="var(--surface-3)" />
              <circle cx="32" cy={y + 8} r="4.5" fill={i === 0 ? p : 'none'} stroke={p} strokeWidth="2" />
              <rect x="42" y={y + 6} width={40 - i * 8} height="4" rx="2" fill="var(--line-strong)" />
            </g>
          ))}
        </svg>
      )
    case 'calendar':
      return (
        <svg {...common}>
          {Array.from({ length: 15 }).map((_, i) => (
            <circle key={i} cx={30 + (i % 5) * 15} cy={22 + Math.floor(i / 5) * 18} r={i === 7 ? 7 : 4} fill={i === 7 ? p : 'var(--surface-3)'} />
          ))}
          <circle cx="60" cy="40" r="13" fill="none" stroke={p} strokeWidth="2" strokeDasharray="4 4" />
        </svg>
      )
    case 'notes':
      return (
        <svg {...common}>
          <rect x="34" y="14" width="50" height="64" rx="8" fill="var(--surface-3)" transform="rotate(-8 59 46)" />
          <rect x="38" y="16" width="50" height="64" rx="8" fill="var(--surface)" stroke="var(--line-strong)" />
          {[30, 40, 50, 60].map((y, i) => <rect key={y} x="46" y={y} width={i === 3 ? 18 : 34} height="4" rx="2" fill={i === 0 ? p : 'var(--line-strong)'} />)}
        </svg>
      )
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M24 52 L36 24 H84 L96 52 V74 H24 Z" fill="var(--surface-3)" />
          <path d="M24 52 H46 A14 8 0 0 0 74 52 H96" fill="none" stroke={p} strokeWidth="3" strokeLinecap="round" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M60 14 L66 40 L92 46 L66 52 L60 78 L54 52 L28 46 L54 40 Z" fill="var(--primary-soft)" stroke={p} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="90" cy="20" r="4" fill={p} opacity=".5" />
          <circle cx="28" cy="74" r="3" fill={p} opacity=".4" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="60" cy="48" r="34" fill="none" stroke="var(--surface-3)" strokeWidth="8" />
          <circle cx="60" cy="48" r="20" fill="none" stroke="var(--line-strong)" strokeWidth="6" strokeDasharray="90 36" transform="rotate(-20 60 48)" />
          <circle cx="60" cy="48" r="6" fill={p} />
          <path d="M88 18 L64 44" stroke={p} strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
  }
}

export function EmptyState({ title, description, action, art = 'target', compact }: {
  title: string
  description?: ReactNode
  action?: ReactNode
  art?: Art
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-6' : 'py-12')}>
      {!compact && <Illustration art={art} />}
      <h3 className={cn('font-bold', compact ? 'text-sm' : 'mt-3 text-base')}>{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft p-6 text-center" role="alert">
      <AlertTriangle className="h-6 w-6 text-danger" />
      <div>
        <div className="font-bold">Couldn't load this</div>
        <div className="text-sm text-muted">{(error as Error)?.message ?? 'Unknown error'}</div>
      </div>
      {onRetry && <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>Retry</Button>}
    </div>
  )
}
