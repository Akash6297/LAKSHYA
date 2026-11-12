import { beforeEach, describe, expect, it } from 'vitest'
import { clearOfflineData, enqueue, listQueue } from './db'

describe('offline queue coalescing', () => {
  beforeEach(async () => clearOfflineData())

  it('merges updates into a pending insert', async () => {
    await enqueue({ table: 'tasks', op: 'insert', rowId: 'a', payload: { title: 'x' }, baseUpdatedAt: null })
    await enqueue({ table: 'tasks', op: 'update', rowId: 'a', payload: { status: 'completed' }, baseUpdatedAt: null })
    const q = await listQueue()
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ op: 'insert', payload: { title: 'x', status: 'completed' } })
  })

  it('drops insert+delete pairs entirely', async () => {
    await enqueue({ table: 'tasks', op: 'insert', rowId: 'b', payload: { title: 'y' }, baseUpdatedAt: null })
    await enqueue({ table: 'tasks', op: 'delete', rowId: 'b', payload: {}, baseUpdatedAt: null })
    expect(await listQueue()).toHaveLength(0)
  })

  it('keeps the original base version when merging updates (for conflict checks)', async () => {
    await enqueue({ table: 'tasks', op: 'update', rowId: 'c', payload: { title: 'one' }, baseUpdatedAt: '2026-01-01T00:00:00Z' })
    await enqueue({ table: 'tasks', op: 'update', rowId: 'c', payload: { priority: 'high' }, baseUpdatedAt: '2026-02-01T00:00:00Z' })
    const q = await listQueue()
    expect(q).toHaveLength(1)
    expect(q[0].baseUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(q[0].payload).toEqual({ title: 'one', priority: 'high' })
  })

  it('replaces pending updates with a delete', async () => {
    await enqueue({ table: 'tasks', op: 'update', rowId: 'd', payload: { title: 'z' }, baseUpdatedAt: null })
    await enqueue({ table: 'tasks', op: 'delete', rowId: 'd', payload: {}, baseUpdatedAt: null })
    const q = await listQueue()
    expect(q.map((o) => o.op)).toEqual(['delete'])
  })
})
