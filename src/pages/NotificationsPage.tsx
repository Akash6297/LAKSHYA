import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bell, CalendarClock, CheckCheck, ClipboardList, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge, Card, PageHeader, Segmented } from '@/components/ui/display'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback'
import { fmt, fromNow } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { supabase, unwrap } from '@/lib/supabase'
import { useAppData } from '@/providers/AppDataProvider'
import { useCrud, useRows } from '@/services/resource'
import type { AppNotification, NotificationLog } from '@/types/db'

const PAGE = 30

export default function NotificationsPage() {
  const { tz } = useAppData()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'all' | 'unread' | 'log'>('all')
  const [limit, setLimit] = useState(PAGE)
  const list = useRows('notifications', [tab, limit], (q) => (tab === 'unread' ? q.eq('is_read', false) : q).order('created_at', { ascending: false }).limit(limit), { enabled: tab !== 'log' })
  const logs = useRows('notification_logs', ['recent'], (q) => q.order('created_at', { ascending: false }).limit(100), { enabled: tab === 'log' })
  const { update, remove, invalidate } = useCrud('notifications')
  const heartbeat = useQuery({
    queryKey: ['scheduler_heartbeat'],
    queryFn: async () => unwrap(await supabase.from('scheduler_heartbeat').select('last_run_at').maybeSingle()) as { last_run_at: string } | null,
    refetchInterval: 60_000,
  })
  const rows = (list.data ?? []) as AppNotification[]
  const stale = !heartbeat.data || Date.now() - new Date(heartbeat.data.last_run_at).getTime() > 20 * 60_000

  const open = (n: AppNotification) => {
    if (!n.is_read) update.mutate({ id: n.id, is_read: true, read_at: new Date().toISOString() })
    if (n.link?.startsWith('/')) navigate(n.link)
  }
  const markAll = async () => {
    try { unwrap(await supabase.rpc('mark_all_notifications_read')); await invalidate(); toast.success('All caught up') } catch (e) { toast.error((e as Error).message) }
  }
  const icon = (k: AppNotification['kind']) => k === 'overdue' ? <AlertTriangle className="h-4 w-4 text-danger" /> : k === 'agenda' ? <CalendarClock className="h-4 w-4 text-primary" /> : k === 'summary' ? <ClipboardList className="h-4 w-4 text-success" /> : <Bell className="h-4 w-4 text-primary" />

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Reminders, daily agendas and weekly summaries."
        actions={<><Link to="/settings#notifications"><Button variant="outline" icon={<Settings className="h-4 w-4" />}>Preferences</Button></Link><Button variant="soft" icon={<CheckCheck className="h-4 w-4" />} onClick={() => void markAll()}>Mark all read</Button></>} />
      <div className={cn('mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs', stale ? 'border-warning/40 bg-warning-soft text-warning' : 'border-line bg-surface text-muted')} role="status">
        <span className={cn('h-2 w-2 rounded-full', stale ? 'bg-warning' : 'bg-success')} />
        {heartbeat.data ? `Reminder scheduler last ran ${fromNow(heartbeat.data.last_run_at)}.` : 'Reminder scheduler has not run yet.'}
        {stale && ' Scheduled reminders will not be delivered until it is set up (README → Reminder scheduler). In-app features keep working.'}
      </div>
      <Segmented className="mb-4" value={tab} onChange={(t) => { setTab(t); setLimit(PAGE) }} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'log', label: 'Delivery log' }]} />

      {tab === 'log' ? (
        <Card>
          {logs.isLoading ? <ListSkeleton /> : ((logs.data ?? []) as NotificationLog[]).length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2">When</th><th>Channel</th><th>Status</th><th>Attempt</th><th>Details</th></tr></thead>
                <tbody>
                  {((logs.data ?? []) as NotificationLog[]).map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="py-2 whitespace-nowrap">{fmt(l.created_at, tz, 'd MMM, HH:mm')}</td>
                      <td className="capitalize">{l.channel.replace('_', '-')}</td>
                      <td><Badge color={l.status === 'sent' ? '#10B981' : l.status === 'failed' ? '#EF4444' : '#94A3B8'}>{l.status}</Badge></td>
                      <td>{l.attempt}</td>
                      <td className="max-w-xs truncate text-xs text-muted" title={l.error ?? ''}>{l.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState compact art="inbox" title="No deliveries yet" />}
        </Card>
      ) : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <ListSkeleton rows={6} /> : rows.length ? (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id} className={cn('group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2', !n.is_read && 'bg-primary-soft/40')}>
                <div className="mt-0.5">{icon(n.kind)}</div>
                <button className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                  <div className={cn('text-sm', !n.is_read ? 'font-bold' : 'font-semibold')}>{n.title}</div>
                  {n.body && <div className="mt-0.5 line-clamp-4 text-sm whitespace-pre-line text-muted">{n.body}</div>}
                  <div className="mt-1 text-[11px] text-subtle">{fromNow(n.created_at)}</div>
                </button>
                {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                <button className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => remove.mutate(n.id)} aria-label="Delete notification"><Trash2 className="h-4 w-4 text-muted" /></button>
              </li>
            ))}
          </ul>
          {rows.length >= limit && <div className="p-3 text-center"><Button variant="outline" size="sm" onClick={() => setLimit(limit + PAGE)}>Load more</Button></div>}
        </Card>
      ) : <EmptyState art="inbox" title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'} description="Reminders for events, tasks, meetings and exams appear here." />}
    </div>
  )
}
