// Sends a test message on one channel to the *calling* user (identified by JWT).
import { adminClient, corsHeaders, json, requireUser } from '../_shared/deno/http.ts'
import { emailConfigured, sendEmail, sendPush, sendTelegram } from '../_shared/deno/channels.ts'

const RATE_LIMIT_PER_HOUR = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await requireUser(req)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const { channel } = await req.json().catch(() => ({}))
  if (!['push', 'email', 'telegram'].includes(channel)) return json({ error: 'invalid channel' }, 400)
  const db = adminClient()

  // simple per-user rate limit using the log table
  const { count } = await db.from('notification_logs').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).is('reminder_job_id', null).gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return json({ error: 'Too many test messages. Try again later.' }, 429)

  const title = 'LAKSHYA test notification'
  const body = 'If you can read this, this channel is working. 🎯'
  let r
  if (channel === 'push') {
    const { data } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', user.id)
    r = await sendPush(data ?? [], { title, body, link: '/notifications', tag: 'test' })
    if (r.expired?.length) await db.from('push_subscriptions').delete().in('endpoint', r.expired)
  } else if (channel === 'email') {
    const { data } = await db.from('notification_preferences').select('email_address').eq('user_id', user.id).single()
    if (!emailConfigured()) r = { ok: false, error: 'Email delivery is not configured on the server (see README → Email).' }
    else if (!data?.email_address) r = { ok: false, error: 'Add an email address first.' }
    else r = await sendEmail(data.email_address, title, body, '/settings')
  } else {
    const { data } = await db.from('integration_secrets').select('secret').eq('user_id', user.id).eq('provider', 'telegram').maybeSingle()
    if (!data) r = { ok: false, error: 'Save your Telegram chat id first.' }
    else {
      const s = data.secret as { bot_token?: string; chat_id: string }
      r = await sendTelegram(s.bot_token || Deno.env.get('TELEGRAM_BOT_TOKEN') || '', s.chat_id, `🔔 ${title}\n${body}`)
    }
    await db.from('integrations').update({ last_tested_at: new Date().toISOString(), last_error: r.ok ? null : r.error })
      .eq('user_id', user.id).eq('provider', 'telegram')
  }

  await db.from('notification_logs').insert({ user_id: user.id, channel, status: r.ok ? 'sent' : 'failed', error: r.error ?? null })
  return json(r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 422)
})
