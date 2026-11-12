// File attachments in Supabase Storage (free tier: 1 GB total, 50 MB per file;
// LAKSHYA caps files at 10 MB). Files live under <user_id>/… so storage RLS
// policies restrict access to the owner.
import { useRef, useState } from 'react'
import { Download, Paperclip, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, unwrap } from '@/lib/supabase'
import { useAuth } from '@/providers/AuthProvider'
import { useCrud, useRows } from '@/services/resource'
import { Button } from '@/components/ui/Button'
import type { Attachment } from '@/types/db'

const MAX = 10 * 1024 * 1024

export function Attachments({ entityType, entityId }: { entityType: Attachment['entity_type']; entityId: string }) {
  const { user } = useAuth()
  const list = useRows('attachments', [entityType, entityId], (q) => q.eq('entity_type', entityType).eq('entity_id', entityId).order('created_at'))
  const { create, remove } = useCrud('attachments')
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    if (file.size > MAX) return toast.error('Files must be 10 MB or smaller')
    setBusy(true)
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-120)
      const path = `${user!.id}/${entityType}/${crypto.randomUUID()}-${safe}`
      const { error } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream' })
      if (error) throw error
      await create.mutateAsync({ entity_type: entityType, entity_id: entityId, storage_path: path, file_name: file.name.slice(0, 255), mime_type: file.type || null, size_bytes: file.size })
      toast.success('File attached')
    } catch (e) {
      toast.error(/quota|exceed/i.test((e as Error).message) ? 'Storage quota reached on the free plan.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const open = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(a.storage_path, 60)
    if (error) return toast.error(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const del = async (a: Attachment) => {
    await supabase.storage.from('attachments').remove([a.storage_path])
    unwrap(await supabase.from('attachments').delete().eq('id', a.id))
    remove.reset()
    void list.refetch()
  }

  const rows = (list.data ?? []) as Attachment[]
  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
          <span className="text-xs text-subtle">{(a.size_bytes / 1024).toFixed(0)} KB</span>
          <button onClick={() => open(a)} aria-label={`Download ${a.file_name}`}><Download className="h-4 w-4 text-muted hover:text-fg" /></button>
          <button onClick={() => del(a)} aria-label={`Delete ${a.file_name}`}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button>
        </div>
      ))}
      <input ref={input} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
      <Button variant="outline" size="sm" loading={busy} icon={<Paperclip className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>Attach file</Button>
    </div>
  )
}
