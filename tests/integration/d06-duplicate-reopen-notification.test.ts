/**
 * D-06 — updateRequestStatus()'s reopen path had two separate notify() calls
 * (one for the requester, one for the assignee) with no shared-recipient
 * check between them. When the same person is both requester and assignee
 * on a ticket (a plausible real case — an agent submitting and being
 * assigned their own internal request) and a third party (e.g. a manager,
 * who can reopen any resolved ticket via the agent-reopen path regardless
 * of team) performs the reopen, both blocks fired for that one person,
 * producing two notification rows for one event.
 *
 * Reuses the D-03 fixture set purely for its ready-made agent/manager
 * identities — otherwise unrelated to D-03.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, clientForToken, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('D-06: no duplicate reopen notification when requester === assignee', () => {
  let fx: D03Fixtures

  beforeAll(async () => {
    fx = await setupD03Fixtures()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  it('agent A (both requester and assignee) gets exactly one notification when the manager reopens it', async () => {
    const admin = getAdmin()
    const resolvedAt = new Date()
    const req = await seedRequestLike(fx, {
      requesterId: fx.agentA.id,
      teamId: fx.teamA.id,
      serviceId: fx.teamA.serviceId,
      assignedTo: fx.agentA.id,
      status: 'resolved',
    })
    // seedRequestLike doesn't set resolved_at/reopen_deadline_at — patch them
    // directly so the agent-reopen path's own checks (mandatory remark only,
    // no deadline for agent-initiated reopen) have a consistent starting row.
    await admin.from('requests').update({
      resolved_at: resolvedAt.toISOString(),
      reopen_deadline_at: new Date(resolvedAt.getTime() + 72 * 3_600_000).toISOString(),
    }).eq('id', req.id)

    actAs(fx.manager)
    const result = await updateRequestStatus(req.id, 'open', 'Manager reopening on the requester-assignee ticket')
    expect(result.error).toBeUndefined()

    const { data: notifs } = await admin
      .from('notifications')
      .select('id, type')
      .eq('request_id', req.id)
      .eq('user_id', fx.agentA.id)
      .eq('type', 'request_reopened')
    expect(notifs).toHaveLength(1)
  })
})
