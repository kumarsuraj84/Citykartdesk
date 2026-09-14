/**
 * D-09 — deleteTask()'s app-level check omitted platform_owner from its
 * allowed-roles list (`created_by === self || role === 'manager' || role ===
 * 'admin'`), even though the matching tasks_delete RLS policy already
 * grants platform_owner. A platform_owner deleting someone else's task got a
 * false "You do not have permission to delete this task." before the
 * RLS-backed delete was ever attempted.
 *
 * Reuses the D-03 fixture set (tests/setup/fixtures-d03.ts) purely for its
 * ready-made platform_owner identity — otherwise unrelated to D-03.
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
import { deleteTask } from '@/lib/actions/tasks'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('D-09: platform_owner can delete a task they did not create', () => {
  let fx: D03Fixtures

  beforeAll(async () => {
    fx = await setupD03Fixtures()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('platform_owner deletes a task created by someone else', async () => {
    const admin = getAdmin()
    const { data: task, error } = await admin
      .from('tasks')
      .insert({
        title: 'D-09 task created by agent A',
        task_type: 'personal',
        created_by: fx.agentA.id,
        org_id: fx.orgId,
      })
      .select('id')
      .single()
    if (error || !task) throw new Error(`seed failed: ${error?.message}`)

    actAs(fx.platformOwner)
    const result = await deleteTask(task.id)
    expect(result.error).toBeUndefined()

    const { data: after } = await admin.from('tasks').select('id').eq('id', task.id).maybeSingle()
    expect(after).toBeNull()
  })
})
