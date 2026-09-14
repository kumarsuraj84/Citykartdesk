/**
 * Remediation Item 6 — Assignment/Reassignment RBAC runtime verification.
 *
 * lib/actions/requests.ts's assignRequest() was code-reviewed as already
 * correctly scoped (role check, team-membership defense-in-depth on top of
 * RLS, same-team-only restriction for plain agents, unrestricted cross-team
 * forwarding for manager+, concurrency guard, SLA fields untouched by the
 * update payload). This suite runtime-confirms that via the real, unmodified
 * assignRequest() Server Action, rather than trusting the code reading alone.
 *
 * Reuses the D-03 fixture set for its ready-made two-team/multi-role setup,
 * plus one extra Team A agent created locally (D-03's fixtures only seed one
 * agent per team) so a genuine same-team reassignment has two distinct
 * targets. Does not modify tests/setup/fixtures-d03.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, createTestUser, clientForToken, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'
import { deleteTestUser } from '../setup/cleanup-user'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { assignRequest } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('Item 6: assignRequest() RBAC', () => {
  let fx: D03Fixtures
  let agentA2: TestUser // a second Team A agent, for a genuine same-team reassignment

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    agentA2 = await createTestUser('item6-agent-a2', 'Item6 Agent A2')
    const admin = getAdmin()
    await admin.from('profiles').update({ role: 'agent' }).eq('id', agentA2.id)
    await admin.from('team_members').insert({ team_id: fx.teamA.id, user_id: agentA2.id, org_id: fx.orgId })
  }, 60_000)

  afterAll(async () => {
    // fx.cleanup() MUST run first — it deletes the requests this suite
    // created (several with `assigned_to: agentA2.id`), and
    // requests.assigned_to/requester_id are NO ACTION FKs to profiles(id).
    // Deleting agentA2's auth user while one of those rows still references
    // it fails (Supabase Auth's admin API returns a 500, not a thrown
    // exception) — this exact ordering bug, with its result never checked,
    // is what silently leaked an "item6-agent-a2" user on every run.
    await fx.cleanup()
    if (agentA2) await deleteTestUser(getAdmin(), agentA2.id, 'item6-agent-a2')
  }, 60_000)

  it('agent can assign to a teammate on the same team', async () => {
    const admin = getAdmin()
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, teamId: fx.teamA.id, serviceId: fx.teamA.serviceId, status: 'open' })

    actAs(fx.agentA)
    const result = await assignRequest(req.id, agentA2.id)
    expect(result.error).toBeUndefined()

    const { data: after } = await admin.from('requests').select('assigned_to, status').eq('id', req.id).single()
    expect(after?.assigned_to).toBe(agentA2.id)
    expect(after?.status).toBe('assigned')
  })

  it('agent cannot assign to a different team', async () => {
    const admin = getAdmin()
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, teamId: fx.teamA.id, serviceId: fx.teamA.serviceId, status: 'open' })

    actAs(fx.agentA)
    const result = await assignRequest(req.id, fx.agentB.id)
    expect(result.error).toBe('You can only assign this ticket to a teammate on the same team.')

    const { data: after } = await admin.from('requests').select('assigned_to').eq('id', req.id).single()
    expect(after?.assigned_to).toBeNull()
  })

  it('agent cannot unassign a ticket', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, teamId: fx.teamA.id, serviceId: fx.teamA.serviceId, assignedTo: fx.agentA.id, status: 'assigned' })

    actAs(fx.agentA)
    const result = await assignRequest(req.id, null)
    expect(result.error).toBe('Technicians cannot unassign a ticket — assign it to a teammate instead.')
  })

  it('requester cannot assign a ticket', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, teamId: fx.teamA.id, serviceId: fx.teamA.serviceId, status: 'open' })

    actAs(fx.requesterA)
    const result = await assignRequest(req.id, fx.agentA.id)
    expect(result.error).toBe('Not authorized to assign requests.')
  })

  it('manager can cross-team assign, unchanged SLA fields, activity logged, persists on re-read', async () => {
    const admin = getAdmin()
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, teamId: fx.teamA.id, serviceId: fx.teamA.serviceId, status: 'open' })
    const { data: before } = await admin.from('requests').select('resolution_due_at, response_due_at').eq('id', req.id).single()

    actAs(fx.manager)
    const result = await assignRequest(req.id, fx.agentB.id)
    expect(result.error).toBeUndefined()

    const { data: after } = await admin.from('requests').select('assigned_to, status, resolution_due_at, response_due_at').eq('id', req.id).single()
    expect(after?.assigned_to).toBe(fx.agentB.id)
    expect(after?.status).toBe('assigned')
    expect(after?.resolution_due_at).toBe(before?.resolution_due_at)
    expect(after?.response_due_at).toBe(before?.response_due_at)

    const { data: activity } = await admin.from('request_activity').select('action, metadata').eq('request_id', req.id).eq('action', 'assigned')
    expect(activity).toHaveLength(1)
    expect((activity?.[0]?.metadata as { assigned_to?: string } | null)?.assigned_to).toBe(fx.agentB.id)

    // Fresh re-read (simulates a browser refresh) — value is durably persisted, not just returned in-memory.
    const { data: reread } = await admin.from('requests').select('assigned_to').eq('id', req.id).single()
    expect(reread?.assigned_to).toBe(fx.agentB.id)
  })

  it('admin can cross-team assign', async () => {
    const admin = getAdmin()
    const req = await seedRequestLike(fx, { requesterId: fx.requesterB.id, teamId: fx.teamB.id, serviceId: fx.teamB.serviceId, status: 'open' })

    actAs(fx.admin)
    const result = await assignRequest(req.id, fx.agentA.id)
    expect(result.error).toBeUndefined()

    const { data: after } = await admin.from('requests').select('assigned_to').eq('id', req.id).single()
    expect(after?.assigned_to).toBe(fx.agentA.id)
  })
})
