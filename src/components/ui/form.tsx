import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Field({ label, error, hint, children, className, htmlFor }: {
  label?: ReactNode
  error?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && <label htmlFor={htmlFor} className="label">{label}</label>}
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...p }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn('field', invalid && 'border-danger', className)} {...p} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...p }, ref) {
    return <textarea ref={ref} rows={rows} className={cn('field resize-y leading-relaxed', className)} {...p} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...p }, ref) {
    return (
      <select ref={ref} className={cn('field cursor-pointer appearance-none bg-[length:16px] bg-[right_0.7rem_center] bg-no-repeat pr-9', className)}
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238d92a3' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
        {...p}>
        {children}
      </select>
    )
  },
)

export function Switch({ checked, onChange, label, description, disabled }: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      {label && (
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          <span className="block text-sm font-semibold">{label}</span>
          {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-surface-3 border border-line',
        )}
      >
        <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked && 'translate-x-5')} />
      </button>
    </div>
  )
}

export function Checkbox({ checked, onChange, label, className, color, size = 'md' }: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  className?: string
  color?: string
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full border-2 transition hover:scale-110',
        size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
        checked ? 'border-transparent bg-success text-white' : 'border-line-strong hover:border-primary',
        className,
      )}
      style={!checked && color ? { borderColor: color } : undefined}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
