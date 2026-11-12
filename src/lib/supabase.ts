import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'))

// The anon key is public by design; Row Level Security protects the data.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  realtime: { params: { eventsPerSecond: 5 } },
})

/** Throws a readable error for a Supabase response, otherwise returns data. */
export function unwrap<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new AppError(friendlyError(res.error), res.error.code)
  return res.data
}

export class AppError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
  }
}

/** Map database errors to safe, human messages (never leak internals). */
export function friendlyError(err: { message: string; code?: string }): string {
  const m = err.message ?? ''
  if (err.code === '23505') return 'That item already exists.'
  if (err.code === '23503') return 'A linked item no longer exists or is not yours.'
  if (err.code === '23514') return 'Some values are out of the allowed range.'
  if (err.code === '22023' || err.code === 'P0001') return m.slice(0, 160)
  if (err.code === '42501' || /row-level security/i.test(m)) return 'You do not have permission to do that.'
  if (/JWT|token/i.test(m)) return 'Your session expired. Please sign in again.'
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Network error. Check your connection.'
  if (/rate limit/i.test(m)) return 'Too many attempts. Please wait a moment.'
  return m.length < 160 ? m : 'Something went wrong. Please try again.'
}
