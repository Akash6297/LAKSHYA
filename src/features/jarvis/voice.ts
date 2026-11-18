// Listening and speaking. On the phone: Android's speech recogniser and
// text-to-speech (free, built in). In a desktop browser: the Web Speech API.
import { isNative, JarvisNative } from './native'

export interface SpeakOptions { language: string; rate: number; pitch: number }
export interface Heard { text: string; alternatives: string[] }

export interface Voice {
  canListen: boolean
  /**
   * Resolves with the final transcript ('' when nothing was heard) and the
   * recogniser's other guesses, which Jarvis tries when the first makes no sense.
   */
  listen(language: string, onPartial: (text: string) => void, onLevel?: (rms: number) => void): Promise<Heard>

  stopListening(): void
  speak(text: string, o: SpeakOptions): Promise<void>
  stopSpeaking(): void
}

type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function nativeVoice(): Voice {
  return {
    canListen: true,
    async listen(language, onPartial, onLevel) {
      const subs = await Promise.all([
        JarvisNative.addListener('partial', (e) => onPartial(e.text)),
        onLevel ? JarvisNative.addListener('level', (e) => onLevel(e.rms)) : Promise.resolve(null),
      ])
      try {
        const r = await JarvisNative.listen({ language })
        if (r.error && !r.text) throw new Error(r.error)
        return { text: r.text ?? '', alternatives: (r.alternatives ?? []).filter((a) => a && a !== r.text) }
      } finally {
        subs.forEach((s) => void s?.remove())
      }
    },
    stopListening: () => void JarvisNative.stopListening(),
    speak: (text, o) => JarvisNative.speak({ text, ...o }),
    stopSpeaking: () => void JarvisNative.stopSpeaking(),
  }
}

function webVoice(): Voice {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  let current: Recognition | null = null
  return {
    canListen: !!Ctor,
    listen(language, onPartial) {
      if (!Ctor) return Promise.resolve({ text: '', alternatives: [] })
      return new Promise((resolve) => {
        const rec = new Ctor()
        current = rec
        rec.lang = language
        rec.interimResults = true
        rec.continuous = false
        rec.maxAlternatives = 3
        let finalText = ''
        let alternatives: string[] = []
        rec.onresult = (e) => {
          let interim = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]
            if (r.isFinal) {
              finalText += r[0].transcript
              alternatives = Array.from({ length: r.length }, (_, k) => r[k].transcript.trim()).slice(1)
            } else interim += r[0].transcript
          }
          onPartial((finalText + interim).trim())
        }
        rec.onerror = () => undefined
        rec.onend = () => { current = null; resolve({ text: finalText.trim(), alternatives }) }
        try { rec.start() } catch { resolve({ text: '', alternatives: [] }) }
      })
    },
    stopListening: () => current?.stop(),
    speak(text, o) {
      if (!('speechSynthesis' in window) || !text) return Promise.resolve()
      return new Promise((resolve) => {
        // some browsers never fire onend (no audio device, background tab): don't hang the conversation
        const guard = setTimeout(resolve, 2500 + text.length * 90)
        const done = () => { clearTimeout(guard); resolve() }
        const u = new SpeechSynthesisUtterance(text)
        u.lang = o.language
        u.rate = o.rate
        u.pitch = o.pitch
        const voice = speechSynthesis.getVoices().find((v) => v.lang === o.language) ?? speechSynthesis.getVoices().find((v) => v.lang.startsWith(o.language.slice(0, 2)))
        if (voice) u.voice = voice
        u.onend = done
        u.onerror = done
        speechSynthesis.cancel()
        speechSynthesis.speak(u)
      })
    },
    stopSpeaking: () => { if ('speechSynthesis' in window) speechSynthesis.cancel() },
  }
}

export function createVoice(): Voice {
  return isNative() ? nativeVoice() : webVoice()
}
