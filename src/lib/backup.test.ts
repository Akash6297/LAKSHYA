import { describe, expect, it } from 'vitest'
import { remapIds, toCsv, validateBackup, type Backup } from './backup'

const P = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const U = '99999999-9999-4999-8999-999999999999'

describe('backup', () => {
  it('remaps ids and foreign keys consistently and strips ownership', () => {
    let n = 0
    const gen = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, '0')}`
    const b: Backup = { app: 'lakshya', version: 1, exported_at: '', tables: {
      projects: [{ id: P, user_id: U, title: 'P' }],
      tasks: [{ id: T, user_id: U, project_id: P, title: 'T', client_key: T, tags: ['x'] }],
    } }
    const out = remapIds(b, gen)
    const proj = out.projects![0], task = out.tasks![0]
    expect(proj.id).not.toBe(P)
    expect(task.project_id).toBe(proj.id)
    expect(task.user_id).toBeUndefined()
    expect(task.client_key).toBeUndefined()
    expect(task.tags).toEqual(['x'])
  })

  it('rejects files that are not LAKSHYA backups', () => {
    expect(() => validateBackup({ hello: 1 })).toThrow(/not a LAKSHYA backup/)
    expect(() => validateBackup({ app: 'lakshya', version: 1, tables: { users: [] } })).toThrow(/Unknown table/)
  })

  it('escapes CSV and neutralises formula injection', () => {
    const csv = toCsv([{ a: 'x,y', b: '=HYPERLINK("evil")', c: ['p', 'q'] }], ['a', 'b', 'c'])
    expect(csv).toBe('a,b,c\r\n"x,y","\'=HYPERLINK(""evil"")",p; q')
  })
})
