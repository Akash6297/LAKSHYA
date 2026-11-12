// Generates a VAPID key pair for Web Push. Run: npm run gen:vapid
// Public key → VITE_VAPID_PUBLIC_KEY (frontend) and VAPID_PUBLIC_KEY (Edge Functions)
// Private key → VAPID_PRIVATE_KEY (Edge Functions ONLY – never commit it)
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
