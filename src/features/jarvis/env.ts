// Jarvis exists only in the personal Android build (npm run android:build →
// vite build --mode android). The public web app on Vercel never includes it:
// __LAKSHYA_JARVIS__ is replaced by a literal at build time (vite.config.ts) and
// the bundler drops the Jarvis code entirely.
export const JARVIS_ENABLED: boolean = __LAKSHYA_JARVIS__

export const JARVIS_OPEN_EVENT = 'lakshya:jarvis-open'
export const openJarvis = (via: 'tap' | 'type' = 'tap') => window.dispatchEvent(new CustomEvent(JARVIS_OPEN_EVENT, { detail: { via } }))

export const JARVIS_SYNC_ALARMS_EVENT = 'lakshya:jarvis-sync-alarms'
export const requestAlarmSync = () => window.dispatchEvent(new Event(JARVIS_SYNC_ALARMS_EVENT))
