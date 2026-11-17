// Capacitor wraps the LAKSHYA web app into the personal Android app (APK) that
// carries the Jarvis voice assistant. The web build on Vercel is unaffected.
// Build: npm run android:build  (see docs/jarvis.md)
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.lakshya.jarvis',
  appName: 'Lakshya Jarvis',
  webDir: 'dist',
  android: {
    // the web app is bundled inside the APK; only Supabase is reached over the network
    allowMixedContent: false,
  },
  plugins: {
    // index.html already uses viewport-fit=cover + env(safe-area-inset-*) paddings
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
}

export default config
