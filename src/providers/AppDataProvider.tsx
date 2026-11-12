// Loads per-user settings, profile and categories once and exposes them app-wide.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { useAuth } from './AuthProvider'
import { useTheme } from './ThemeProvider'
import type { Category, NotificationPrefs, Profile, UserSettings } from '@/types/db'

interface AppData {
  profile: Profile | null
  settings: UserSettings
  prefs: NotificationPrefs | null
  categories: Category[]
  categoryById: Map<string, Category>
  tz: string
  h24: boolean
  ready: boolean
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>
  updatePrefs: (patch: Partial<NotificationPrefs>) => Promise<void>
  updateProfile: (patch: Partial<Profile>) => Promise<void>
}

const Ctx = createContext<AppData | null>(null)

export const DEFAULT_SETTINGS: UserSettings = {
  user_id: '',
  timezone: 'Asia/Kolkata',
  theme: 'system',
  week_starts_on: 1,
  time_format: '12h',
  default_calendar_view: 'timeGridWeek',
  default_event_minutes: 60,
  working_hours: {},
  focus_minutes: 25,
  short_break_minutes: 5,
  long_break_minutes: 15,
  daily_focus_target_min: 120,
  daily_study_target_min: 120,
  weekly_study_target_min: 600,
  whatsapp_number: null,
  updated_at: '',
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { setTheme } = useTheme()
  const qc = useQueryClient()
  const uid = user?.id

  const settingsQ = useQuery({
    queryKey: ['user_settings', uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('user_settings').select('*').eq('user_id', uid!).maybeSingle()) as UserSettings | null,
  })
  const profileQ = useQuery({
    queryKey: ['profiles', uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('profiles').select('*').eq('id', uid!).maybeSingle()) as Profile | null,
  })
  const prefsQ = useQuery({
    queryKey: ['notification_preferences', uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('notification_preferences').select('*').eq('user_id', uid!).maybeSingle()) as NotificationPrefs | null,
  })
  const catsQ = useQuery({
    queryKey: ['categories'],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('categories').select('*').order('sort_order')) as Category[],
  })

  // keep theme in sync with the account (cross-device)
  useEffect(() => {
    if (settingsQ.data?.theme) setTheme(settingsQ.data.theme)
  }, [settingsQ.data?.theme, setTheme])

  const settingsM = useMutation({
    mutationFn: async (patch: Partial<UserSettings>) => {
      unwrap(await supabase.from('user_settings').upsert({ ...patch, user_id: uid }).select().single())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user_settings'] }),
  })
  const prefsM = useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) => {
      unwrap(await supabase.from('notification_preferences').upsert({ ...patch, user_id: uid }).select().single())
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification_preferences'] }),
  })
  const profileM = useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      unwrap(await supabase.from('profiles').update(patch).eq('id', uid!))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })

  const value = useMemo<AppData>(() => {
    const settings = { ...DEFAULT_SETTINGS, ...(settingsQ.data ?? {}) }
    const categories = catsQ.data ?? []
    return {
      profile: profileQ.data ?? null,
      settings,
      prefs: prefsQ.data ?? null,
      categories,
      categoryById: new Map(categories.map((c) => [c.id, c])),
      tz: settings.timezone,
      h24: settings.time_format === '24h',
      ready: settingsQ.isFetched && catsQ.isFetched,
      updateSettings: async (p) => settingsM.mutateAsync(p),
      updatePrefs: async (p) => prefsM.mutateAsync(p),
      updateProfile: async (p) => profileM.mutateAsync(p),
    }
  }, [settingsQ.data, settingsQ.isFetched, profileQ.data, prefsQ.data, catsQ.data, catsQ.isFetched, settingsM, prefsM, profileM])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAppData outside AppDataProvider')
  return c
}
