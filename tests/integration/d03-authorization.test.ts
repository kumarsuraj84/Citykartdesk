/**
 * D-03 — getFilteredRequests()/getFilteredTasks() authorization.
 *
 * Static audit claim: lib/actions/analytics.ts's getFilteredRequests() and
 * getFilteredTasks() query via the RLS-bypassing admin client, check only
 * that the caller is authenticated and has an org_id, then apply
 * caller-supplied filters (teamId, assignedTo, status, ...) with NO further
 * role/team/ownership check.
 *
 * Runtime reproduction against the pre-fix code (captured in the D-03
 * security validation report) confirmed this: a plain requester's *default*
 * no-filter call already returned every request and every task in the org,
 * not just their own — the caller-supplied filters didn't even need to be
 * exploited.
 *
 * This suite calls the REAL, unmodified getFilteredRequests() Server Action
 * (not a re-implementation, not a UI click-through) as each identity, using
 * the same real-Postgres/real-Auth integration harness introduced for
 * DESK-UAT-001 (tests/setup/env.ts, clientForToken()). Fixtures are isolated
 * per run (tests/setup/fixtures-d03.ts) and independent of the
 * DESK-UAT-001 fixtures/tests, which this work must not touch.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getFilteredRequests } from '@/lib/actions/analytics'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) {
  mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never)
}

describe('D-03: getFilteredRequests/getFilteredTasks authorization', () => {
  let fx: D03Fixtures

  beforeAll(async () => {
    fx = await setupD03Fixtures()
  }, 60_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 60_000)

  // ── Requests ────────────────────────────────────────────────────────────

  describe('requests', () => {
    it('requester: own access — Requester A retrieves their own request', async () => {
      actAs(fx.requesterA)
      const res = await getFilteredRequests({ title: 'test' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.requestA.id)
      expect(ids).not.toContain(fx.requestB.id)
    })

    it("requester: cross-user denial — Requester A never sees Requester B's request, filtered or not", async () => {
      actAs(fx.requesterA)
      const unfiltered = await getFilteredRequests({ title: 'test' })
      const filtered = await getFilteredRequests({ title: 'test', assignedTo: fx.agentB.id, teamId: fx.teamB.id })
      expect(unfiltered.data.map((r) => r.id)).not.toContain(fx.requestB.id)
      expect(filtered.data.map((r) => r.id)).not.toContain(fx.requestB.id)
    })

    it("requester: cross-team denial — Requester A supplying teamId=Team B gets nothing from Team B", async () => {
      actAs(fx.requesterA)
      const res = await getFilteredRequests({ title: 'test', teamId: fx.teamB.id })
      expect(res.data.map((r) => r.id)).not.toContain(fx.requestB.id)
    })

    it('agent: allowed team access — Agent A retrieves Team A data', async () => {
      actAs(fx.agentA)
      const res = await getFilteredRequests({ title: 'test' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.requestA.id)
      expect(ids).not.toContain(fx.requestB.id)
    })

    it('agent: cross-team denial — Agent A supplying Team B / Agent B filters gets nothing from Team B', async () => {
      actAs(fx.agentA)
      const byTeam = await getFilteredRequests({ title: 'test', teamId: fx.teamB.id })
      const byAssignee = await getFilteredRequests({ title: 'test', assignedTo: fx.agentB.id })
      expect(byTeam.data.map((r) => r.id)).not.toContain(fx.requestB.id)
      expect(byAssignee.data.map((r) => r.id)).not.toContain(fx.requestB.id)
    })

    it('manager: expected access — sees Team A (own team), not Team B', async () => {
      actAs(fx.manager)
      const res = await getFilteredRequests({ title: 'test' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.requestA.id)
      expect(ids).not.toContain(fx.requestB.id)
    })

    it('admin: expected access — sees both Team A and Team B', async () => {
      actAs(fx.admin)
      const res = await getFilteredRequests({ title: 'test' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.requestA.id)
      expect(ids).toContain(fx.requestB.id)
    })

    it('platform_owner: expected access — sees both Team A and Team B', async () => {
      actAs(fx.platformOwner)
      const res = await getFilteredRequests({ title: 'test' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.requestA.id)
      expect(ids).toContain(fx.requestB.id)
    })
  })

  // ── Tasks (same action, routed via _module: 'tasks') ───────────────────────

  describe('tasks', () => {
    it('requester: plain user role has no task scope at all', async () => {
      actAs(fx.requesterA)
      const res = await getFilteredRequests({ title: 'test', _module: 'tasks' })
      expect(res.data).toHaveLength(0)
      expect(res.error).toBeTruthy()
    })

    it('agent: allowed team access — Agent A retrieves Team A task data', async () => {
      actAs(fx.agentA)
      const res = await getFilteredRequests({ title: 'test', _module: 'tasks' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.taskA.id)
      expect(ids).not.toContain(fx.taskB.id)
    })

    it('agent: cross-team denial — Agent A supplying Team B filter gets nothing from Team B', async () => {
      actAs(fx.agentA)
      const res = await getFilteredRequests({ title: 'test', _module: 'tasks', teamId: fx.teamB.id })
      expect(res.data.map((r) => r.id)).not.toContain(fx.taskB.id)
    })

    it('manager: expected access — sees both teams\' tasks (tasks_select RLS grants managers org-wide, unlike requests)', async () => {
      actAs(fx.manager)
      const res = await getFilteredRequests({ title: 'test', _module: 'tasks' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.taskA.id)
      expect(ids).toContain(fx.taskB.id)
    })

    it('admin: expected access — sees both teams\' tasks', async () => {
      actAs(fx.admin)
      const res = await getFilteredRequests({ title: 'test', _module: 'tasks' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.taskA.id)
      expect(ids).toContain(fx.taskB.id)
    })

    it('platform_owner: expected access — sees both teams\' tasks', async () => {
      actAs(fx.platformOwner)
      const res = await getFilteredRequests({ title: 'test', _module: 'tasks' })
      const ids = res.data.map((r) => r.id)
      expect(ids).toContain(fx.taskA.id)
      expect(ids).toContain(fx.taskB.id)
    })
  })
})
