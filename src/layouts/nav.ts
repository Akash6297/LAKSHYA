import {
  Bell, BookOpen, BriefcaseBusiness, CalendarDays, ChartNoAxesColumn, CheckSquare, FolderKanban, LayoutDashboard,
  Settings, StickyNote, Sun, Target, Timer, Users,
} from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/my-day', label: 'My Day', icon: Sun },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/work', label: 'Work', icon: BriefcaseBusiness },
  { to: '/study', label: 'Study Planner', icon: BookOpen },
  { to: '/meetings', label: 'Meetings', icon: Users },
  { to: '/notes', label: 'Notes', icon: StickyNote },
  { to: '/goals', label: 'Goals & Habits', icon: Target },
  { to: '/focus', label: 'Focus', icon: Timer },
  { to: '/analytics', label: 'Analytics', icon: ChartNoAxesColumn },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export const MOBILE_NAV = ['/', '/my-day', '/calendar', '/tasks']
