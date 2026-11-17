// Jarvis preferences. They live on this phone only (the APK is single-device);
// everything Jarvis creates is saved to your LAKSHYA account on the server.
import { useEffect, useState } from 'react'

export type ListenMode = 'always' | 'screen_on' | 'charging'

export interface Shortcut {
  /** what you say, e.g. "start my day" */
  phrase: string
  /** say a fixed reply, open a page, or run another command */
  action: 'command' | 'open' | 'say'
  value: string
}

export interface JarvisSettings {
  wake: {
    enabled: boolean
    mode: ListenMode
    phrases: string[]
    /** 0.3 (more sensitive) … 0.9 (stricter) */
    threshold: number
  }
  voice: {
    speak: boolean
    language: 'en-IN' | 'hi-IN' | 'en-US' | 'en-GB'
    rate: number
    pitch: number
  }
  /** how Jarvis addresses you; empty = first name from your profile */
  callMe: string
  confirmBeforeSave: boolean
  /** after a wake-word session, return to the app you were using */
  returnToPreviousApp: boolean
  /** let Jarvis answer over the lock screen without unlocking */
  allowOnLockScreen: boolean
  briefing: { enabled: boolean; time: string }
  alarms: {
    enabled: boolean
    ring: { meetings: boolean; exams: boolean; deadlines: boolean; importantEvents: boolean; reminders: boolean }
    /** used when an item has no reminder of its own */
    defaultLeadMinutes: number
  }
  corrections: { heard: string; meant: string }[]
  shortcuts: Shortcut[]
}

export const DEFAULT_WAKE_PHRASES = ['hey jarvis', 'hey lakshya', 'radhe radhe jarvis', 'radhe radhe lakshya']

export const DEFAULT_JARVIS: JarvisSettings = {
  wake: { enabled: true, mode: 'always', phrases: DEFAULT_WAKE_PHRASES, threshold: 0.55 },
  voice: { speak: true, language: 'en-IN', rate: 1, pitch: 1 },
  callMe: '',
  confirmBeforeSave: false,
  returnToPreviousApp: true,
  allowOnLockScreen: false,
  briefing: { enabled: true, time: '07:30' },
  alarms: {
    enabled: true,
    ring: { meetings: true, exams: true, deadlines: true, importantEvents: true, reminders: true },
    defaultLeadMinutes: 10,
  },
  corrections: [],
  shortcuts: [
    { phrase: 'start my day', action: 'command', value: 'good morning' },
    { phrase: 'gym time', action: 'command', value: 'block 1 hour now for gym' },
  ],
}

const KEY = 'lakshya-jarvis'
const EVENT = 'lakshya:jarvis-settings'

function merge(saved: Partial<JarvisSettings>): JarvisSettings {
  return {
    ...DEFAULT_JARVIS,
    ...saved,
    wake: { ...DEFAULT_JARVIS.wake, ...saved.wake },
    voice: { ...DEFAULT_JARVIS.voice, ...saved.voice },
    briefing: { ...DEFAULT_JARVIS.briefing, ...saved.briefing },
    alarms: { ...DEFAULT_JARVIS.alarms, ...saved.alarms, ring: { ...DEFAULT_JARVIS.alarms.ring, ...saved.alarms?.ring } },
    corrections: saved.corrections ?? DEFAULT_JARVIS.corrections,
    shortcuts: saved.shortcuts ?? DEFAULT_JARVIS.shortcuts,
  }
}

export function loadJarvisSettings(): JarvisSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? merge(JSON.parse(raw) as Partial<JarvisSettings>) : DEFAULT_JARVIS
  } catch {
    return DEFAULT_JARVIS
  }
}

export function saveJarvisSettings(s: JarvisSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage full or blocked: keep in memory */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: s }))
}

export function useJarvisSettings(): [JarvisSettings, (patch: (s: JarvisSettings) => JarvisSettings) => void] {
  const [s, setS] = useState(loadJarvisSettings)
  useEffect(() => {
    const on = (e: Event) => setS((e as CustomEvent<JarvisSettings>).detail)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  const update = (fn: (s: JarvisSettings) => JarvisSettings) => saveJarvisSettings(fn(loadJarvisSettings()))
  return [s, update]
}
