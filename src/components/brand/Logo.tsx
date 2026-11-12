import { useId } from 'react'
import { cn } from '@/lib/utils'

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  // unique per instance: a gradient defined inside a display:none SVG can't be referenced
  const gid = `lk-g${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C78F5" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gid})`} />
      <circle cx="30" cy="34" r="15" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeDasharray="78 16.25" transform="rotate(-14 30 34)" />
      <circle cx="30" cy="34" r="4.8" fill="#fff" />
      <path d="M50.5 13.5 L35 29" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M45 10.5 H53.5 V19" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ collapsed, className, showSanskrit = true }: { collapsed?: boolean; className?: string; showSanskrit?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={34} />
      {!collapsed && (
        <div className="leading-none">
          <div className="text-[15px] font-extrabold tracking-[0.18em]">LAKSHYA</div>
          {showSanskrit && <div className="mt-1 font-deva text-[11px] font-medium text-muted">लक्ष्य</div>}
        </div>
      )}
    </div>
  )
}
