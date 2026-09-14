/**
 * D-16 — createTask() had no role check at all, contradicting both the
 * (separately non-enforced) Permission Matrix's own displayed claim that
 * task creation is agent+-only, and the isAgentOrAboveRole() gate every
 * other task mutation in lib/actions/tasks.ts already uses. tasks_insert's
 * RLS WITH CHECK has no role clause either (org_id + created_by = self
 * only), so the app-level check added here is the only gate.
 *
 * Reuses the D-03 fixture set (tests/setup/fixtures-d03.ts) purely for its
 * ready-made multi-role identities — this suite is otherwise unrelated to
 * D-03 and does not touch its tests.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createTask } from '@/lib/actions/tasks'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('D-16: createTask() role authorization', () => {
  let fx: D03Fixtures
  const createdTaskIds: string[] = []

  beforeAll(async () => {
    fx = await setupD03Fixtures()
  }, 60_000)

  afterAll(async () => {
    if (createdTaskIds.length > 0) {
      await getAdmin().from('tasks').delete().in('id', createdTaskIds)
    }
    await fx.cleanup()
  }, 60_000)

  it('a plain requester (user role) cannot create a task', async () => {
    actAs(fx.requesterA)
    const result = await createTask({ title: 'D-16 unauthorized task' })
    expect(result.error).toBe('You do not have permission to create tasks.')
    expect(result.data).toBeUndefined()
  })

  it('an agent can create a task', async () => {
    actAs(fx.agentA)
    const result = await createTask({ title: 'D-16 agent task' })
    expect(result.error).toBeUndefined()
    expect(result.data?.id).toBeTruthy()
    if (result.data?.id) createdTaskIds.push(result.data.id)
  })

  it('a manager can create a task', async () => {
    actAs(fx.manager)
    const result = await createTask({ title: 'D-16 manager task' })
    expect(result.error).toBeUndefined()
    expect(result.data?.id).toBeTruthy()
    if (result.data?.id) createdTaskIds.push(result.data.id)
  })
})
