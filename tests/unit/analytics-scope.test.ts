/**
 * The analytics dashboard showed the whole company's numbers to everyone. A viewer who
 * isn't org-wide must only get their own technician groups' requests and tasks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Call = { table: string; method: string; args: unknown[] }
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

import { getAnalytics } from '@/lib/queries/analytics'

const teamFilters = (table: string): Call[] =>
  calls.filter((c) => c.table === table && c.method === 'in' && c.args[0] === 'team_id')

describe('getAnalytics — scoped to the viewer', () => {
  beforeEach(() => { calls.length = 0 })

  it('org-wide viewers get no team filter', async () => {
    await getAnalytics('org-1', '30d', { kind: 'all' })
    expect(teamFilters('requests')).toHaveLength(0)
    expect(teamFilters('tasks')).toHaveLength(0)
  })

  it('a technician only gets requests and tasks from their groups', async () => {
    await getAnalytics('org-1', '30d', { kind: 'agent', userId: 'u1', teamIds: ['bd', 'admin'] })
    // org request ids, period requests, open requests, daily created, daily closed
    expect(teamFilters('requests')).toHaveLength(5)
    expect(teamFilters('tasks')).toHaveLength(1)
    for (const c of [...teamFilters('requests'), ...teamFilters('tasks')]) expect(c.args[1]).toEqual(['bd', 'admin'])
  })

  it('a manager is limited to their groups too', async () => {
    await getAnalytics('org-1', '30d', { kind: 'team', teamIds: ['t1'] })
    expect(teamFilters('requests').every((c) => (c.args[1] as string[]).join() === 't1')).toBe(true)
  })

  it('a viewer with no groups gets nothing, not everything', async () => {
    await getAnalytics('org-1', '30d', { kind: 'team', teamIds: [] })
    const filters = teamFilters('requests')
    expect(filters.length).toBeGreaterThan(0)
    for (const c of filters) expect(c.args[1]).toEqual(['00000000-0000-0000-0000-000000000000'])
  })
})
