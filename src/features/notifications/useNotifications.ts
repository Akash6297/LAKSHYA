import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/AuthProvider'
import type { AppNotification } from '@/types/db'

/** Unread count + realtime push of new in-app notifications (Supabase Realtime, free tier). */
export function useUnreadNotifications() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const q = useQuery({
    queryKey: ['notifications', 'unread-count'],
    enabled: !!user,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)
      if (error) throw error
      return count ?? 0
    },
  })

  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        const n = payload.new as AppNotification
        void qc.invalidateQueries({ queryKey: ['notifications'] })
        toast(n.title, { description: n.body?.split('\n').slice(0, 3).join(' · ') })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [user, qc])

  return q.data ?? 0
}
