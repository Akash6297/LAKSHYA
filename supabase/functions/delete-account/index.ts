// Permanently deletes the calling user's auth account. All user tables
// reference auth.users with ON DELETE CASCADE, so every row goes with it.
import { adminClient, corsHeaders, json, requireUser } from '../_shared/deno/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await requireUser(req)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const { confirm } = await req.json().catch(() => ({}))
  if (confirm !== 'DELETE MY ACCOUNT') return json({ error: 'confirmation phrase mismatch' }, 400)

  const db = adminClient()
  // remove stored files first (storage objects are not covered by FK cascade)
  const { data: files } = await db.storage.from('attachments').list(user.id, { limit: 1000 })
  if (files?.length) await db.storage.from('attachments').remove(files.map((f) => `${user.id}/${f.name}`))

  const { error } = await db.auth.admin.deleteUser(user.id)
  if (error) return json({ error: 'Could not delete account. Please try again.' }, 500)
  return json({ ok: true })
})
