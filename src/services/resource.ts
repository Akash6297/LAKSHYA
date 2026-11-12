// Generic, typed CRUD hooks over Supabase tables. Query keys always start with
// the table name so any mutation invalidates every view of that table.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import type { TableName, Tables } from '@/types/db'

// PostgREST filter builder – kept loose because tables are dynamic here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Builder = (q: any) => any

export function useRows<T extends TableName>(
  table: T,
  key: unknown[],
  build?: Builder,
  opts: { enabled?: boolean; select?: string; staleTime?: number } = {},
) {
  return useQuery({
    queryKey: [table, ...key],
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime,
    queryFn: async () => {
      let q = supabase.from(table).select(opts.select ?? '*')
      if (build) q = build(q)
      return unwrap(await q) as unknown as Tables[T][]
    },
  })
}

export function useRow<T extends TableName>(table: T, id: string | null | undefined) {
  return useQuery({
    queryKey: [table, 'one', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from(table).select('*').eq('id', id!).maybeSingle()) as Tables[T] | null,
  })
}

export function useCount(table: TableName, key: unknown[], build: Builder) {
  return useQuery({
    queryKey: [table, 'count', ...key],
    queryFn: async () => {
      const res = await build(supabase.from(table).select('id', { count: 'exact', head: true }))
      if (res.error) throw res.error
      return (res.count as number) ?? 0
    },
  })
}

type Insert<T extends TableName> = Partial<Omit<Tables[T], 'id' | 'user_id' | 'created_at' | 'updated_at'>> & { id?: string }
type Patch<T extends TableName> = Partial<Omit<Tables[T], 'user_id' | 'created_at' | 'updated_at'>> & { id: string }

/**
 * Create / update / remove for a table. `also` lists other tables whose
 * cached views depend on this one (e.g. tasks → projects progress).
 */
export function useCrud<T extends TableName>(table: T, also: TableName[] = []) {
  const qc = useQueryClient()
  const invalidate = () => Promise.all([table, ...also].map((t) => qc.invalidateQueries({ queryKey: [t] })))

  const create = useMutation({
    mutationFn: async (values: Insert<T>) =>
      unwrap(await supabase.from(table).insert(values as never).select().single()) as Tables[T],
    onSuccess: invalidate,
  })

  const createMany = useMutation({
    mutationFn: async (values: Insert<T>[]) =>
      unwrap(await supabase.from(table).insert(values as never).select()) as Tables[T][],
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Patch<T>) =>
      unwrap(await supabase.from(table).update(patch as never).eq('id', id).select().single()) as Tables[T],
    onSuccess: invalidate,
  })

  const updateMany = useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: Partial<Tables[T]> }) =>
      unwrap(await supabase.from(table).update(patch as never).in('id', ids).select()) as Tables[T][],
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.from(table).delete().eq('id', id))
      return id
    },
    onSuccess: invalidate,
  })

  const removeMany = useMutation({
    mutationFn: async (ids: string[]) => {
      unwrap(await supabase.from(table).delete().in('id', ids))
      return ids
    },
    onSuccess: invalidate,
  })

  return { create, createMany, update, updateMany, remove, removeMany, invalidate }
}
