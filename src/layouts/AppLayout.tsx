import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Bell, ChevronsLeft, ChevronsRight, CloudOff, LogOut, Menu, Moon, Plus, RefreshCw, Search, Sun, Timer, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/brand/Logo'
import { Avatar, Kbd } from '@/components/ui/display'
import { Button } from '@/components/ui/Button'
import { FullPageLoader } from '@/components/ui/feedback'
import { NAV_ITEMS, MOBILE_NAV } from './nav'
import { useAuth } from '@/providers/AuthProvider'
import { useAppData } from '@/providers/AppDataProvider'
import { useTheme } from '@/providers/ThemeProvider'
import { useQuickCreate } from '@/providers/QuickCreateProvider'
import { useSync } from '@/providers/SyncProvider'
import { useFocus } from '@/providers/FocusProvider'
import { useUnreadNotifications } from '@/features/notifications/useNotifications'
import { UpdatePrompt } from '@/features/pwa/UpdatePrompt'

const COLLAPSE_KEY = 'lakshya-sidebar'

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const unread = useUnreadNotifications()
  const { openQuickAdd, openSearch } = useQuickCreate()

  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* ignore */ }
      return !c
    })
  }

  return (
    <div className="min-h-[100dvh]">
      <a href="#main" className="sr-only z-50 rounded bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface/80 backdrop-blur-xl transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        <SidebarContent collapsed={collapsed} unread={unread} />
        <button onClick={toggle} className="m-3 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-fg" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
        </button>
      </aside>

      {/* Mobile / tablet drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-slide-up flex-col bg-surface shadow-pop">
            <button onClick={() => setDrawer(false)} className="absolute top-4 right-3 rounded-lg p-1.5 text-muted" aria-label="Close menu"><X className="h-5 w-5" /></button>
            <SidebarContent unread={unread} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <TopBar onMenu={() => setDrawer(true)} unread={unread} onSearch={openSearch} onQuickAdd={openQuickAdd} />
        <SyncBanner />
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:px-8 lg:pb-10" key={location.pathname.split('/')[1]}>
          <Suspense fallback={<FullPageLoader />}>
            <div className="animate-fade-in"><Outlet /></div>
          </Suspense>
        </main>
      </div>

      <MobileNav onQuickAdd={openQuickAdd} />
      <UpdatePrompt />
    </div>
  )
}

function SidebarContent({ collapsed, unread, onNavigate }: { collapsed?: boolean; unread: number; onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const { profile } = useAppData()
  const name = profile?.full_name || user?.email || ''
  return (
    <>
      <div className={cn('flex h-16 items-center px-5', collapsed && 'justify-center px-0')}>
        <Link to="/" onClick={onNavigate} aria-label="LAKSHYA home"><Logo collapsed={collapsed} /></Link>
      </div>
      <nav className="scrollbar-none flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
        {NAV_ITEMS.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onNavigate} title={collapsed ? n.label : undefined}
            className={({ isActive }) => cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
              collapsed && 'justify-center px-0',
              isActive ? 'bg-primary-soft text-primary-soft-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-primary" />}
                <n.icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
                {n.to === '/notifications' && unread > 0 && (
                  <span className={cn('grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white', collapsed && 'absolute top-1 right-3')}>{unread > 99 ? '99+' : unread}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className={cn('flex items-center gap-3 border-t border-line p-3', collapsed && 'flex-col')}>
        <Avatar name={name} size={34} />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{profile?.full_name || 'You'}</div>
            <div className="truncate text-xs text-muted">{user?.email}</div>
          </div>
        )}
        <button onClick={() => void signOut()} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
      </div>
    </>
  )
}

function TopBar({ onMenu, unread, onSearch, onQuickAdd }: { onMenu: () => void; unread: number; onSearch: () => void; onQuickAdd: () => void }) {
  const { resolved, setTheme } = useTheme()
  const { updateSettings } = useAppData()
  const focus = useFocus()
  const mm = Math.floor(focus.remainingMs / 60_000)
  const ss = Math.floor((focus.remainingMs % 60_000) / 1000)
  const flip = () => {
    const t = resolved === 'dark' ? 'light' : 'dark'
    setTheme(t)
    void updateSettings({ theme: t }).catch(() => undefined)
  }
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 px-4 sm:px-6 lg:px-8">
        <button onClick={onMenu} className="-ml-1 rounded-lg p-2 text-muted lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <div className="lg:hidden"><Logo collapsed /></div>
        <button onClick={onSearch} className="ml-1 flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-subtle shadow-soft transition hover:border-line-strong sm:max-w-md">
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Search everything…</span>
          <span className="ml-auto hidden gap-1 sm:flex"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          {(focus.running || focus.startedAt) && (
            <Link to="/focus" className={cn('hidden items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold tabular-nums sm:flex', focus.mode === 'focus' ? 'bg-primary-soft text-primary-soft-fg' : 'bg-success-soft text-success')}>
              <Timer className="h-4 w-4" />{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </Link>
          )}
          <Button variant="ghost" size="icon" onClick={flip} aria-label="Toggle theme">{resolved === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</Button>
          <Link to="/notifications" className="relative grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Notifications, ${unread} unread`}>
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute top-1.5 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
          </Link>
          <span className="hidden sm:block"><Button onClick={onQuickAdd} icon={<Plus className="h-4 w-4" />}>New <Kbd>Q</Kbd></Button></span>
        </div>
      </div>
    </header>
  )
}

function SyncBanner() {
  const { online, pending, syncing, syncNow, conflicts } = useSync()
  if (online && !pending && !conflicts.length) return null
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-2 px-4 py-2 text-xs font-semibold', online ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-muted')} role="status">
      {!online && <><CloudOff className="h-3.5 w-3.5" /> You're offline. Tasks you view and create are saved on this device.</>}
      {pending > 0 && <span>{pending} change{pending === 1 ? '' : 's'} waiting to sync.</span>}
      {conflicts.length > 0 && <Link to="/tasks?conflicts=1" className="underline">{conflicts.length} sync conflict{conflicts.length === 1 ? '' : 's'} to review</Link>}
      {online && pending > 0 && (
        <button onClick={() => void syncNow()} className="inline-flex items-center gap-1 underline" disabled={syncing}>
          <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} /> Sync now
        </button>
      )}
    </div>
  )
}

function MobileNav({ onQuickAdd }: { onQuickAdd: () => void }) {
  const items = NAV_ITEMS.filter((n) => MOBILE_NAV.includes(n.to))
  const left = items.slice(0, 2), right = items.slice(2)
  const link = (n: (typeof NAV_ITEMS)[number]) => (
    <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold', isActive ? 'text-primary' : 'text-muted')}>
      <n.icon className="h-5 w-5" />{n.label}
    </NavLink>
  )
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-xl lg:hidden" aria-label="Quick navigation">
      <div className="mx-auto flex max-w-md items-center px-2">
        {left.map(link)}
        <button onClick={onQuickAdd} className="-mt-6 grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-fg shadow-pop" aria-label="Quick add">
          <Plus className="h-6 w-6" />
        </button>
        {right.map(link)}
      </div>
    </nav>
  )
}
