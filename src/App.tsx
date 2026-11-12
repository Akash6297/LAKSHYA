import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AuthProvider, useAuth } from '@/providers/AuthProvider'
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider'
import { AppDataProvider } from '@/providers/AppDataProvider'
import { ConfirmProvider } from '@/providers/ConfirmProvider'
import { QuickCreateProvider } from '@/providers/QuickCreateProvider'
import { SyncProvider } from '@/providers/SyncProvider'
import { FocusProvider } from '@/providers/FocusProvider'
import { AppLayout } from '@/layouts/AppLayout'
import { FullPageLoader } from '@/components/ui/feedback'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/pages/auth/AuthPages'
import { SetupRequired } from '@/pages/SetupRequired'

const OverviewPage = lazy(() => import('@/pages/OverviewPage'))
const MyDayPage = lazy(() => import('@/pages/MyDayPage'))
const CalendarPage = lazy(() => import('@/pages/CalendarPage'))
const TasksPage = lazy(() => import('@/pages/TasksPage'))
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('@/pages/ProjectDetailPage'))
const WorkPage = lazy(() => import('@/pages/WorkPage'))
const StudyPage = lazy(() => import('@/pages/StudyPage'))
const MeetingsPage = lazy(() => import('@/pages/MeetingsPage'))
const NotesPage = lazy(() => import('@/pages/NotesPage'))
const GoalsPage = lazy(() => import('@/pages/GoalsPage'))
const FocusPage = lazy(() => import('@/pages/FocusPage'))
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

function Protected({ children }: { children: ReactNode }) {
  const { session, loading, recovering } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader />
  if (recovering) return <Navigate to="/reset-password" replace />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  return (
    <AppDataProvider>
      <SyncProvider>
        <FocusProvider>
          <QuickCreateProvider>{children}</QuickCreateProvider>
        </FocusProvider>
      </SyncProvider>
    </AppDataProvider>
  )
}

function ThemedToaster() {
  const { resolved } = useTheme()
  return <Toaster theme={resolved} position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />
}

export default function App() {
  if (!isSupabaseConfigured) return <ThemeProvider><SetupRequired /></ThemeProvider>
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <Suspense fallback={<FullPageLoader />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route element={<Protected><AppLayout /></Protected>}>
                    <Route index element={<OverviewPage />} />
                    <Route path="my-day" element={<MyDayPage />} />
                    <Route path="calendar" element={<CalendarPage />} />
                    <Route path="tasks" element={<TasksPage />} />
                    <Route path="projects" element={<ProjectsPage />} />
                    <Route path="projects/:id" element={<ProjectDetailPage />} />
                    <Route path="work" element={<WorkPage />} />
                    <Route path="study" element={<StudyPage />} />
                    <Route path="meetings" element={<MeetingsPage />} />
                    <Route path="notes" element={<NotesPage />} />
                    <Route path="notes/:id" element={<NotesPage />} />
                    <Route path="goals" element={<GoalsPage />} />
                    <Route path="focus" element={<FocusPage />} />
                    <Route path="analytics" element={<AnalyticsPage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
            <ThemedToaster />
          </ConfirmProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
