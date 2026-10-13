// D-013: admin update actions write only the fields they own. Extra keys in the request (organization, ids, timestamps) are ignored.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pickFields } from '@/lib/utils/pick-fields'

const writes: { table: string; values: Record<string, unknown> }[] = []
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => ({ id: 'a', role: 'admin', org_id: 'org' }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        update: (values: Record<string, unknown>) => { writes.push({ table, values }); return q },
        eq: () => q,
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      }
      return q
    },
  }),
}))

const FORGED = { org_id: 'other-org', id: 'x', created_at: '2000-01-01', created_by: 'someone' }

describe('pickFields', () => {
  it('keeps only the named keys that are present', () => {
    expect(pickFields({ a: 1, b: 2, evil: 3 } as Record<string, unknown>, ['a', 'c'] as const)).toEqual({ a: 1 })
    expect(pickFields(null, ['a'] as const)).toEqual({})
  })
})

describe('admin updates ignore fields they do not own', () => {
  beforeEach(() => { writes.length = 0 })

  it('alert rule', async () => {
    const { updateAlertRule } = await import('@/lib/actions/admin/config')
    await updateAlertRule('r', { name: 'Late', is_active: false, ...FORGED } as never)
    expect(writes).toEqual([{ table: 'alert_rules', values: { name: 'Late', is_active: false } }])
  })
  it('request priority', async () => {
    const { updateRequestPriority } = await import('@/lib/actions/admin/config')
    await updateRequestPriority('p', { color: '#fff', ...FORGED } as never)
    expect(writes).toEqual([{ table: 'request_priorities', values: { color: '#fff' } }])
  })
  it('task status and task priority', async () => {
    const { updateTaskStatus, updateTaskPriority } = await import('@/lib/actions/admin/task-config')
    await updateTaskStatus('s', { name: ' Done ', ...FORGED } as never)
    await updateTaskPriority('p', { value: 'Very High', ...FORGED } as never)
    expect(writes).toEqual([
      { table: 'task_statuses', values: { name: 'Done' } },
      { table: 'task_priorities', values: { value: 'very_high' } },
    ])
  })
});
