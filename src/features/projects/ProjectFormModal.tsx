import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { CategorySelect, ColorPicker } from '@/components/ui/pickers'
import { PRIORITIES, PROJECT_STATUSES } from '@/lib/constants'
import { safeUrl } from '@/lib/utils'
import { useCrud } from '@/services/resource'
import type { Priority, Project, ProjectStatus } from '@/types/db'

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(10000).optional(),
  start_date: z.string().optional(),
  deadline: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']),
  progress_mode: z.enum(['auto', 'manual']),
  progress: z.coerce.number().min(0).max(100),
}).refine((v) => !v.start_date || !v.deadline || v.deadline >= v.start_date, { message: 'Deadline must be after the start date', path: ['deadline'] })
type FormValues = z.input<typeof schema>

export function ProjectFormModal({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project | null }) {
  const navigate = useNavigate()
  const { create, update } = useCrud('projects')
  const [color, setColor] = useState('#6366F1')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [links, setLinks] = useState<{ label: string; url: string }[]>([])
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    reset({
      title: project?.title ?? '', description: project?.description ?? '', start_date: project?.start_date ?? '', deadline: project?.deadline ?? '',
      priority: project?.priority ?? 'medium', status: project?.status ?? 'active', progress_mode: project?.progress_mode ?? 'auto', progress: project?.progress ?? 0,
    })
    setColor(project?.color ?? '#6366F1')
    setCategoryId(project?.category_id ?? null)
    setLinks(project?.links ?? [])
  }, [open, project, reset])

  const onSubmit = handleSubmit(async (raw) => {
    const v = schema.parse(raw)
    const payload = {
      title: v.title.trim(), description: v.description?.trim() || null, start_date: v.start_date || null, deadline: v.deadline || null,
      priority: v.priority as Priority, status: v.status as ProjectStatus, progress_mode: v.progress_mode,
      ...(v.progress_mode === 'manual' ? { progress: v.progress } : {}),
      color, category_id: categoryId,
      links: links.filter((l) => safeUrl(l.url)).map((l) => ({ label: l.label.trim() || l.url, url: safeUrl(l.url)! })),
    }
    if (project) await update.mutateAsync({ id: project.id, ...payload })
    else {
      const p = await create.mutateAsync(payload)
      navigate(`/projects/${p.id}`)
    }
    onClose()
  })

  return (
    <Modal open={open} onClose={onClose} size="lg" title={project ? 'Edit project' : 'New project'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={isSubmitting}>{project ? 'Save' : 'Create project'}</Button></>}>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <button type="submit" hidden />
        <Field label="Project title" error={errors.title?.message} className="sm:col-span-2" htmlFor="p-title"><Input id="p-title" autoFocus {...register('title')} /></Field>
        <Field label="Status" htmlFor="p-st"><Select id="p-st" {...register('status')}>{PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
        <Field label="Priority" htmlFor="p-pr"><Select id="p-pr" {...register('priority')}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        <Field label="Start date" htmlFor="p-sd"><Input id="p-sd" type="date" {...register('start_date')} /></Field>
        <Field label="Deadline" error={errors.deadline?.message} htmlFor="p-dl"><Input id="p-dl" type="date" {...register('deadline')} /></Field>
        <Field label="Category" htmlFor="p-cat"><CategorySelect id="p-cat" value={categoryId} onChange={setCategoryId} /></Field>
        <Field label="Progress" htmlFor="p-pm" hint={watch('progress_mode') === 'auto' ? 'Calculated from completed tasks (cancelled tasks excluded)' : undefined}>
          <div className="flex gap-2">
            <Select id="p-pm" {...register('progress_mode')}><option value="auto">Automatic</option><option value="manual">Manual</option></Select>
            {watch('progress_mode') === 'manual' && <Input type="number" min={0} max={100} className="w-24" {...register('progress')} aria-label="Progress percent" />}
          </div>
        </Field>
        <Field label="Color" className="sm:col-span-2"><ColorPicker value={color} onChange={setColor} /></Field>
        <Field label="Description" className="sm:col-span-2" htmlFor="p-desc"><Textarea id="p-desc" rows={3} {...register('description')} /></Field>
        <Field label="Links" className="sm:col-span-2">
          <div className="space-y-2">
            {links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="Label" value={l.label} className="w-1/3" onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Link label" />
                <Input placeholder="https://" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} aria-label="Link URL" invalid={!!l.url && !safeUrl(l.url)} />
                <Button variant="ghost" size="icon" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remove link"><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLinks([...links, { label: '', url: '' }])}>Add link</Button>
          </div>
        </Field>
      </form>
    </Modal>
  )
}
