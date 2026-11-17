// Decides which phone alerts to schedule: "ring" alerts (looping alarm sound,
// full-screen like an incoming call) for meetings, exams, deadlines, important
// events and reminders; normal notifications for everything else with a
// reminder. Pure function → unit tested. The APK schedules them with Android's
// AlarmManager, so they fire even when the app is closed and work offline.
import { addDaysKey, localDateKey, zonedInstant } from '@/lib/dates'
import type { CalendarItem } from '@/services/calendar'
import type { EventRow, Exam, Meeting, StudySession, Task } from '@/types/db'
import type { NativeAlarm } from './native'
import type { JarvisSettings } from './settings'
import { spokenDuration, spokenTime } from './motivation'

export interface CustomAlarm { id: string; at: string; label: string }

const MAX = 60
const CUSTOM_KEY = 'lakshya-jarvis-alarms'

/** Alarms more than a day ahead (the Clock app only takes a time of day) and test alerts. */
export function loadCustomAlarms(): CustomAlarm[] {
  try {
    return (JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as CustomAlarm[]).filter((a) => new Date(a.at).getTime() > Date.now())
  } catch {
    return []
  }
}
export function addCustomAlarm(a: CustomAlarm) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify([...loadCustomAlarms(), a])) } catch { /* ignore */ }
}

export function buildAlarms(items: CalendarItem[], s: JarvisSettings, now: Date, tz: string, h24: boolean, custom: CustomAlarm[] = []): NativeAlarm[] {
  const out: NativeAlarm[] = []
  const horizon = now.getTime() + 8 * 86_400_000
  const add = (a: NativeAlarm) => { if (a.at > now.getTime() + 5_000 && a.at < horizon) out.push(a) }
  const lead = (offset: number) => (offset === 0 ? 'Now' : `In ${spokenDuration(offset)}`)
  const title = (t: string) => t.replace(/^[☐⚑🌴]\s*/u, '')

  if (s.alarms.enabled) {
    for (const i of items) {
      if (i.done) continue
      switch (i.kind) {
        case 'meeting': {
          const m = i.row as Meeting
          for (const off of offsets(m.reminder_minutes, s.alarms.defaultLeadMinutes)) {
            add({ id: `${i.key}:${off}`, at: i.start.getTime() - off * 60_000, title: title(i.title), body: `${lead(off)} · ${spokenTime(i.start, tz, h24)}`, ring: s.alarms.ring.meetings, url: m.meeting_url ?? undefined, route: '/meetings' })
          }
          break
        }
        case 'exam': {
          const x = i.row as Exam
          for (const off of offsets(x.reminder_minutes, 60)) {
            add({ id: `${i.key}:${off}`, at: i.start.getTime() - off * 60_000, title: title(i.title), body: `${lead(off)} · ${spokenTime(i.start, tz, h24)}`, ring: s.alarms.ring.exams, route: '/study' })
          }
          break
        }
        case 'deadline': {
          const key = localDateKey(i.start, tz)
          add({ id: `${i.key}:day`, at: zonedInstant(key, '09:00', tz).getTime(), title: `Deadline today: ${title(i.title)}`, body: 'Project deadline', ring: s.alarms.ring.deadlines, route: `/projects/${i.id}` })
          add({ id: `${i.key}:eve`, at: zonedInstant(addDaysKey(key, -1), '18:00', tz).getTime(), title: `Deadline tomorrow: ${title(i.title)}`, body: 'Project deadline', ring: false, route: `/projects/${i.id}` })
          break
        }
        case 'event': {
          const e = (i.master ?? i.row) as EventRow
          if (i.allDay) break
          const important = e.priority === 'high' || e.priority === 'critical'
          const offs = e.reminder_minutes?.length ? e.reminder_minutes : important ? [s.alarms.defaultLeadMinutes] : []
          for (const off of offs) {
            add({ id: `${i.key}:${off}`, at: i.start.getTime() - off * 60_000, title: title(i.title), body: `${lead(off)} · ${spokenTime(i.start, tz, h24)}`, ring: important && s.alarms.ring.importantEvents, url: e.meeting_url ?? undefined, route: '/calendar' })
          }
          break
        }
        case 'task': {
          const t = i.row as Task
          const due = t.has_due_time && t.due_at ? new Date(t.due_at) : !i.allDay ? i.start : null
          if (!due || !t.reminder_minutes?.length) break
          const urgent = t.priority === 'high' || t.priority === 'critical' || t.tags?.includes('jarvis')
          for (const off of t.reminder_minutes) {
            add({ id: `${i.key}:${off}`, at: due.getTime() - off * 60_000, title: title(i.title), body: off === 0 ? 'Reminder' : `Due ${lead(off).toLowerCase()}`, ring: urgent && s.alarms.ring.reminders, route: '/tasks' })
          }
          break
        }
        case 'study': {
          const st = i.row as StudySession
          for (const off of st.reminder_minutes ?? []) {
            add({ id: `${i.key}:${off}`, at: i.start.getTime() - off * 60_000, title: title(i.title), body: `Study session · ${spokenTime(i.start, tz, h24)}`, ring: false, route: '/study' })
          }
          break
        }
      }
    }
  }

  for (const c of custom) add({ id: `custom:${c.id}`, at: new Date(c.at).getTime(), title: c.label || 'Alarm', body: 'Alarm', ring: true })

  out.sort((a, b) => a.at - b.at)
  const list = out.slice(0, MAX)

  if (s.briefing.enabled) {
    const today = localDateKey(now, tz)
    let at = zonedInstant(today, s.briefing.time, tz)
    if (at <= now) at = zonedInstant(addDaysKey(today, 1), s.briefing.time, tz)
    list.push({ id: 'briefing', at: at.getTime(), title: 'Your day with Jarvis', body: 'Tap for your morning briefing and a boost of motivation.', ring: false, route: 'jarvis:briefing', repeatDaily: true })
  }
  return list
}

function offsets(list: number[] | null | undefined, fallback: number): number[] {
  const xs = (list?.length ? list : [fallback]).filter((n) => n >= 0 && n <= 7 * 1440)
  return [...new Set(xs)]
}
