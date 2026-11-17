# Jarvis – personal voice assistant (Android app)

Jarvis exists only in the personal Android build of LAKSHYA. The public web app
on Vercel never includes it. Everything is free: no AI subscription, no paid APIs.

| Part | How it works | Cost |
|---|---|---|
| Wake words ("Hey Jarvis", "Hey Lakshya", "Radhe Radhe Jarvis/Lakshya") | Offline [Vosk](https://alphacephei.com/vosk/) model on the phone, Indian English | Free, offline |
| Understanding commands | Rules in `src/features/jarvis/nlu` (English, Hinglish, Devanagari) | Free, offline |
| Hearing the command after the wake word | Android's built-in speech recogniser | Free (offline if the language pack is installed) |
| Speaking | Android text-to-speech | Free, offline |
| Saving | Your real Supabase account (same data as the website) | Your existing plan |
| Ringing alerts / alarms | Android AlarmManager, full-screen alert | Free, offline |

## Build the APK

Needs JDK 21 and the Android SDK (already installed on the build PC under
`%LOCALAPPDATA%\Programs\jdk-21` and `%LOCALAPPDATA%\Android\Sdk`) and `.env.local`
with your Supabase URL and anon key.

```bash
npm run android:build
```

The first run downloads the voice model (~37 MB) and build tools, and creates a
personal signing key in `~/.lakshya/`. **Back up that folder**: updates must be
signed with the same key, or you have to uninstall first (your data is safe on the
server either way). The APK lands in `release/Lakshya-Jarvis.apk`.

## Install and set up on the phone

1. Copy `release/Lakshya-Jarvis.apk` to the phone (USB, Google Drive, or the OneDrive app) and open it. Allow "Install unknown apps" for that app once.
2. Open **Lakshya Jarvis** and sign in with your LAKSHYA account.
3. Go to **Settings → Jarvis** and finish the checklist: Microphone, Notifications,
   Display over other apps, Unrestricted battery, Full-screen alerts.
4. On Xiaomi/Redmi/Poco, Oppo/Realme, Vivo, OnePlus or Samsung also enable
   **Autostart / background activity** for the app, or the phone may stop it.
5. Say "Hey Jarvis". Jarvis also has a button in the top bar.

After a phone restart, Android does not allow the microphone to start in the
background: tap the "Turn Jarvis listening back on" notification once.

## Things to say

- "Schedule a meeting with Rahul tomorrow at 5 on Zoom"
- "Kal shaam 6 baje gym calendar mein daal do"
- "Dentist appointment Friday at 4, put it on the calendar"
- "Remind me to call mom at 8 PM" (rings at 8 PM)
- "Take a note: ideas for the launch video"
- "What's my schedule today?" · "What's next?" · "Any meetings tomorrow?"
- "Set an alarm for 6 AM" · "Set a timer for 10 minutes"
- "Good morning" (daily briefing) · "Motivate me" · "I'm tired" · "Am I working too much?"
- "Undo" · "Open my tasks" · "Help"

## Train it

Settings → Jarvis → *Train Jarvis*:

- **Try a sentence** shows exactly how Jarvis will understand it.
- **Corrections**: if the recogniser keeps hearing "lucky shah" when you say "Lakshya", add it once.
- **Shortcuts**: "office mode" → open /work, "start my day" → run "good morning", etc.

## Notes and limits

- Always-on listening uses extra battery. Choose *Screen on* or *While charging* in settings if needed.
- Real phone calls and SMS cost money (telephony APIs), so "call" alerts are full-screen ringing alarms on the phone instead. For messages, connect Telegram in Settings → Integrations (free).
- The wake word works offline. Understanding the command after it uses Google's speech service, which is online unless you download offline speech for your language.
