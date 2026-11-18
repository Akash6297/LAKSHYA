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
   Display over other apps, Unrestricted battery, Full-screen alerts, and (for calling) Contacts and Phone calls.
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

Changing what's already there (meetings, events and tasks):

- "Move my meeting with Rahul to 6" · "Reschedule the dentist to Friday" · "Client review ko 6 baje shift karo"
- "Push my next meeting by 30 minutes" · "Move gym 1 hour earlier" · "Postpone the standup" (Jarvis asks to when)
- "Extend client review by 15 minutes" · "Rename the team sync to Weekly review"
- "Cancel my meeting with Rahul" · "Delete tomorrow's gym" · "Clear my schedule tomorrow" · "Rahul wali meeting cancel kar do"
- "Mark ship the release as done" · "I finished the report" · "Report ho gaya"
- "Move it to 7" right after creating or changing something

If several things match, Jarvis lists them and asks "which one?" (say "the second one", "the one at 5", the name, or tap it).
Cancelling always asks first (can be turned off), and everything can be undone. For a repeating event only that day
changes, unless you say "the whole series". It warns you when the new time overlaps something else.

Phone calls (uses your own SIM and dialer, so your normal call rates apply):

- "Call Mom" · "Call Rahul Sharma on his work number" · "Mummy ko call karo" · "Call 98765 43210"
- "Call mom at 8 PM" sets a reminder instead of calling now.
- Mom/Dad/Bhai/Didi/etc. match contacts saved as "Mummy", "Papa", "Bhaiya"… When two people match,
  Jarvis asks which one; when it's not sure, it asks before calling.
- The first call asks for the Contacts and Phone permissions. Without the Phone permission
  the dialer opens with the number filled in and you tap call.

## Train it

By voice: "When I say jim I mean gym" (or "jim ka matlab gym"). Jarvis remembers it for good. Use it for
words the recogniser keeps getting wrong, and for nicknames of contacts ("when I say boss I mean Anil Kumar").

Settings → Jarvis → *Train Jarvis*:

- **Try a sentence** shows exactly how Jarvis will understand it.
- **Corrections**: if the recogniser keeps hearing "lucky shah" when you say "Lakshya", add it once.
- **Shortcuts**: "office mode" → open /work, "start my day" → run "good morning", etc.

**Autocorrect** (on by default, Settings → Jarvis → Behaviour) fixes typos and common mishearings such as
"calender", "remainder", "meating", "postphone" and "tomorow". It never changes short everyday words.
The speech recogniser also returns its second and third guesses; if the first doesn't make sense,
Jarvis quietly tries the others.

## Notes and limits

- Always-on listening uses extra battery. Choose *Screen on* or *While charging* in settings if needed.
- Calls go through your phone's SIM like a normal call. Meeting "call" alerts are full-screen ringing alarms on the phone. For messages, connect Telegram in Settings → Integrations (free).
- Jarvis can find items from yesterday up to a month ahead. Notes, alarms and timers can't be deleted by voice.
- The wake word works offline. Understanding the command after it uses Google's speech service, which is online unless you download offline speech for your language.
