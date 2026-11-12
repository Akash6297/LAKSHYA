import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, friendlyError, AppError } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { clearOfflineData } from '@/offline/db'

interface AuthCtx {
  session: Session | null
  user: User | null
  loading: boolean
  recovering: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  sendReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

const fail = (e: { message: string; code?: string } | null) => {
  if (e) throw new AppError(friendlyError(e), e.code)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthCtx>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    recovering,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      fail(error)
    },
    async signUp(email, password, fullName) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          emailRedirectTo: `${location.origin}/`,
        },
      })
      fail(error)
      return { needsConfirmation: !data.session }
    },
    async signOut() {
      // detach this device's push subscription so the next account on this browser doesn't inherit it
      try {
        const { disablePush } = await import('@/features/pwa/push')
        await disablePush()
      } catch {
        /* best effort */
      }
      await supabase.auth.signOut()
      await clearOfflineData()
    },
    async sendReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset-password` })
      fail(error)
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password })
      fail(error)
      setRecovering(false)
    },
  }), [session, loading, recovering])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
