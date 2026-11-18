// Bridge to the Android side of the Jarvis APK (android/app/src/main/java/app/lakshya/jarvis).
// In a desktop browser (dev/testing) these calls are replaced by web fallbacks in voice.ts.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { ListenMode } from './settings'

export interface PermissionState {
  microphone: boolean
  notifications: boolean
  /** "Display over other apps" – lets the wake word bring Jarvis up from the background */
  overlay: boolean
  /** battery optimisation off, so Android doesn't stop listening */
  batteryUnrestricted: boolean
  /** ringing alarm screen over the lock screen */
  fullScreen: boolean
  exactAlarms: boolean
  /** find people by name for "call Rahul" */
  contacts: boolean
  /** place calls directly (otherwise the dialer opens with the number filled in) */
  phone: boolean
}

export interface NativeContact {
  name: string
  numbers: { number: string; label: 'mobile' | 'work' | 'home' | 'other'; primary?: boolean }[]
  starred?: boolean
}

export interface WakeStatus {
  running: boolean
  paused: boolean
  listening: boolean
  modelReady: boolean
  /** wake-phrase words the offline model does not know (they are ignored) */
  unknownWords: string[]
  error?: string
}

export interface NativeStatus {
  sdk: number
  manufacturer: string
  model: string
  permissions: PermissionState
  wake: WakeStatus
  locked: boolean
  speechAvailable: boolean
}

export interface NativeAlarm {
  id: string
  /** epoch ms */
  at: number
  title: string
  body: string
  /** ring like an incoming call (looping alarm sound, full screen) instead of a normal notification */
  ring: boolean
  url?: string
  route?: string
  repeatDaily?: boolean
}

export interface LaunchInfo {
  action?: 'wake' | 'open'
  phrase?: string
  route?: string
  fromBackground?: boolean
}

export type PermissionKind = 'microphone' | 'notifications' | 'contacts' | 'phone'

export type SettingsKind = 'overlay' | 'battery' | 'fullScreen' | 'exactAlarm' | 'app' | 'notifications'

export interface JarvisNativePlugin {
  getStatus(): Promise<NativeStatus>
  requestPermission(o: { kind: PermissionKind }): Promise<{ granted: boolean }>
  /** all contacts that have a phone number (needs the contacts permission) */
  getContacts(): Promise<{ contacts: NativeContact[] }>
  /** placed: true = the call started; false = the dialer opened with the number (no call permission) */
  placeCall(o: { number: string }): Promise<{ placed: boolean }>
  openSettings(o: { kind: SettingsKind }): Promise<void>
  startWakeWord(o: { phrases: string[]; mode: ListenMode; threshold: number; allowOnLockScreen: boolean }): Promise<WakeStatus>
  stopWakeWord(): Promise<void>
  pauseWakeWord(): Promise<void>
  resumeWakeWord(): Promise<void>
  /** error: a message for the user (no internet, mic busy…) */
  listen(o: { language: string }): Promise<{ text: string; alternatives: string[]; error?: string }>
  stopListening(): Promise<void>
  speak(o: { text: string; language: string; rate: number; pitch: number }): Promise<void>
  stopSpeaking(): Promise<void>
  setAlarms(o: { alarms: NativeAlarm[] }): Promise<{ scheduled: number }>
  setSystemAlarm(o: { hour: number; minute: number; message: string }): Promise<void>
  setSystemTimer(o: { seconds: number; message: string }): Promise<void>
  openUrl(o: { url: string }): Promise<void>
  minimize(): Promise<void>
  consumeLaunch(): Promise<LaunchInfo>
  addListener(event: 'wake', fn: (e: { phrase: string; fromBackground: boolean }) => void): Promise<PluginListenerHandle>
  addListener(event: 'launch', fn: (e: LaunchInfo) => void): Promise<PluginListenerHandle>
  addListener(event: 'partial', fn: (e: { text: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'level', fn: (e: { rms: number }) => void): Promise<PluginListenerHandle>
  addListener(event: 'unlocked', fn: () => void): Promise<PluginListenerHandle>
}

export const JarvisNative = registerPlugin<JarvisNativePlugin>('Jarvis')
export const isNative = () => Capacitor.isNativePlatform()
