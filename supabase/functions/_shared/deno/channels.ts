// Delivery channels for Edge Functions (Deno). Every channel returns a result
// instead of throwing so one broken provider never blocks the others.
import webpush from 'npm:web-push@3.6.7'
import nodemailer from 'npm:nodemailer@6.9.16'

export interface DeliveryResult {
  ok: boolean
  error?: string
  /** push subscription endpoints that are permanently gone */
  expired?: string[]
}

const env = (k: string) => Deno.env.get(k) ?? ''

// ---------- Web Push --------------------------------------------------------
let vapidReady = false
function initVapid(): boolean {
  if (vapidReady) return true
  const pub = env('VAPID_PUBLIC_KEY')
  const priv = env('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return false
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', pub, priv)
  vapidReady = true
  return true
}

export interface PushSub { endpoint: string; p256dh: string; auth: string }

export async function sendPush(subs: PushSub[], msg: { title: string; body: string; link: string; tag?: string }): Promise<DeliveryResult> {
  if (!initVapid()) return { ok: false, error: 'VAPID keys not configured on server' }
  if (!subs.length) return { ok: false, error: 'No push subscriptions (enable push on a device first)' }
  const expired: string[] = []
  const errors: string[] = []
  let delivered = 0
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
        { TTL: 3600, urgency: 'high' },
      )
      delivered++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) expired.push(s.endpoint)
      else errors.push(`${code ?? ''} ${(e as Error).message}`.trim())
    }
  }))
  if (delivered > 0) return { ok: true, expired }
  return { ok: false, expired, error: errors[0] ?? 'All push subscriptions expired' }
}

// ---------- Telegram --------------------------------------------------------
export async function sendTelegram(botToken: string, chatId: string, text: string): Promise<DeliveryResult> {
  if (!botToken) return { ok: false, error: 'No Telegram bot token (set your own or TELEGRAM_BOT_TOKEN on server)' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) return { ok: false, error: `Telegram: ${body.description ?? res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Telegram: ${(e as Error).message}` }
  }
}

// ---------- Email -----------------------------------------------------------
// EMAIL_PROVIDER=smtp  → SMTP over TLS on port 465 (Edge Functions block 25/587)
// EMAIL_PROVIDER=brevo → Brevo transactional HTTP API (free: 300 emails/day)
export function emailConfigured(): boolean {
  const p = env('EMAIL_PROVIDER')
  if (p === 'smtp') return !!(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'))
  if (p === 'brevo') return !!(env('BREVO_API_KEY') && env('EMAIL_FROM'))
  return false
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null

export async function sendEmail(to: string, subject: string, text: string, link?: string): Promise<DeliveryResult> {
  const provider = env('EMAIL_PROVIDER')
  const from = env('EMAIL_FROM') || env('SMTP_USER')
  const appUrl = env('APP_URL')
  const fullText = link && appUrl ? `${text}\n\nOpen in LAKSHYA: ${appUrl}${link}` : text
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1A1B2E">
    <div style="font-weight:800;letter-spacing:.12em;color:#4F46E5">LAKSHYA</div>
    <h2 style="margin:12px 0">${escapeHtml(subject)}</h2>
    <pre style="font-family:inherit;white-space:pre-wrap;font-size:15px;line-height:1.5">${escapeHtml(text)}</pre>
    ${link && appUrl ? `<p><a href="${appUrl}${link}" style="background:#4F46E5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open LAKSHYA</a></p>` : ''}
    <p style="color:#6B6F80;font-size:12px">You receive this because email reminders are on in LAKSHYA settings.</p></div>`
  try {
    if (provider === 'smtp') {
      if (!emailConfigured()) return { ok: false, error: 'SMTP not configured on server' }
      transporter ??= nodemailer.createTransport({
        host: env('SMTP_HOST'),
        port: Number(env('SMTP_PORT') || 465),
        secure: true,
        auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
      })
      await transporter.sendMail({ from: `LAKSHYA <${from}>`, to, subject, text: fullText, html })
      return { ok: true }
    }
    if (provider === 'brevo') {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': env('BREVO_API_KEY') },
        body: JSON.stringify({ sender: { name: 'LAKSHYA', email: from }, to: [{ email: to }], subject, textContent: fullText, htmlContent: html }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { ok: false, error: `Brevo ${res.status}: ${(await res.text()).slice(0, 200)}` }
      return { ok: true }
    }
    return { ok: false, error: 'EMAIL_PROVIDER not set on server' }
  } catch (e) {
    return { ok: false, error: `Email: ${(e as Error).message}` }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
