import { describe, it, expect, vi, beforeEach } from 'vitest'

const { calls } = vi.hoisted(() => ({ calls: [] as { table: string; method: string; args: unknown[] }[] }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: unknown = new Proxy({}, {
        get: (_t, method: string) => {
          if (method === 'then') return (resolve: (v: unknown) => void) => resolve({ data: [] })
          return (...args: unknown[]) => { calls.push({ table, method, args }); return builder }
        },
      })
      return builder
    },
  }),
}))

import { getWorkloadReport } from '@/lib/queries/workload'

const groupFilters = (table: string) => calls.filter((c) => c.table === table && c.method === 'in' && c.args[0] === 'team_id')

describe('getWorkloadReport — limited to chosen groups', () => {
  beforeEach(() => { calls.length = 0 })

  it('no group limit by default', async () => {
    await getWorkloadReport('org-1')
    expect(groupFilters('requests')).toHaveLength(0)
    expect(groupFilters('tasks')).toHaveLength(0)
  })

  it('limits both open requests and open tasks to the picked groups', async () => {
    await getWorkloadReport('org-1', ['g1', 'g2'])
    expect(groupFilters('requests')).toHaveLength(1)
    expect(groupFilters('tasks')).toHaveLength(1)
    expect(groupFilters('requests')[0].args[1]).toEqual(['g1', 'g2'])
  })

  it('a viewer in no group sees no workload at all, and no query is made', async () => {
    expect(await getWorkloadReport('org-1', [])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
