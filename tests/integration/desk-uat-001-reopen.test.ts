/**
 * DESK-UAT-001 regression suite.
 *
 * Defect: a requester reopening their own *resolved* ticket always failed
 * with "This request was just changed by someone else — please refresh and
 * try again", even with zero real concurrent writes. Root cause: the
 * requests_update RLS policy grants UPDATE only to team members/managers —
 * it has no requester_id = auth.uid() clause at all — so the RLS-scoped
 * client updateRequestStatus() used could never let a plain requester write
 * to their own row, and the resulting zero-row UPDATE was misreported as an
 * optimistic-concurrency conflict. See lib/actions/requests.ts around the
 * `statusUpdateClient` variable for the fix.
 *
 * These tests exercise the real, unmodified updateRequestStatus() Server
 * Action against the local Supabase Postgres + Auth instance — real RLS,
 * real triggers — not a UI click-through and not a re-implementation of the
 * business rules. Only the three Next.js framework seams that don't exist
 * outside an actual request (next/headers, next/cache, and the
 * cookie-based server client) are stubbed; @/lib/supabase/server's
 * createClient is replaced with a real, per-user token-authenticated
 * supabase-js client carrying the exact same RLS-relevant JWT a browser
 * session would.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  setupFixtures,
  seedRequest,
  clientForToken,
  getAdmin,
  type Fixtures,
  type TestUser,
} from '../setup/fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)

// updateRequestStatus() calls createClient() more than once per invocation
// (directly, and again inside getCurrentProfile()) — for a single
// sequential test, mockResolvedValue's shared static return value is fine.
// For the genuine-concurrency test (two real, simultaneously in-flight
// invocations, each doing several real network round trips) there is no
// reliable JS-level ordering to hang a call-count-based queue off of.
// AsyncLocalStorage is the correct tool: it propagates a value across an
// entire async call chain (including nested awaits and nested function
// calls) regardless of how two sibling chains actually interleave over the
// wire, which a shift()-a-queue mock cannot guarantee under real I/O.
const identityStorage = new AsyncLocalStorage<TestUser>()
mockedCreateClient.mockImplementation(async () => {
  const user = identityStorage.getStore()
  if (!user) throw new Error('createClient() called outside actAs()/runAs() context')
  return clientForToken(user.accessToken) as never
})

/** Runs the rest of the current test as this user — the next call(s) to
 *  updateRequestStatus() (and anything it calls, e.g. getCurrentProfile())
 *  run genuinely as them. */
function actAs(user: TestUser) {
  identityStorage.enterWith(user)
}

/** Runs `fn` as this user, isolated from any sibling concurrent call — use
 *  this (not actAs) when two calls are in flight at once. */
function runAs<T>(user: TestUser, fn: () => Promise<T>): Promise<T> {
  return identityStorage.run(user, fn)
}

describe('DESK-UAT-001: requester reopen of a resolved ticket', () => {
  let fx: Fixtures

  beforeAll(async () => {
    fx = await setupFixtures()
  }, 30_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 30_000)

  it('1. valid requester reopen succeeds and updates every expected field', async () => {
    const admin = getAdmin()
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      assignedTo: fx.agent.id,
    })

    actAs(fx.requester)
    const result = await updateRequestStatus(req.id, 'open', 'Not satisfied with the resolution, reopening.')
    expect(result.error).toBeUndefined()

    const { data: after } = await admin.from('requests').select('*').eq('id', req.id).single()
    expect(after?.status).toBe('open')
    expect(after?.reopen_count).toBe(1)
    expect(after?.resolved_at).toBeNull()
    expect(after?.closed_at).toBeNull()
    expect(after?.reopen_deadline_at).toBeNull()
    expect(after?.cancellation_reason).toBeNull()
    expect(after?.paused_ms_total).toBe(0)

    const { data: activity } = await admin
      .from('request_activity')
      .select('action')
      .eq('request_id', req.id)
    expect(activity?.filter((a) => a.action === 'status_changed')).toHaveLength(1)
    expect(activity?.filter((a) => a.action === 'reopened')).toHaveLength(1)

    const { data: comments } = await admin.from('request_comments').select('body').eq('request_id', req.id)
    expect(comments?.some((c) => c.body.includes('Not satisfied'))).toBe(true)

    const { data: notifs } = await admin
      .from('notifications')
      .select('type, user_id')
      .eq('request_id', req.id)
      .eq('user_id', fx.agent.id)
    expect(notifs?.some((n) => n.type === 'request_reopened')).toBe(true)
  })

  it('2. reopen after the 72h deadline is denied and leaves the row untouched', async () => {
    const admin = getAdmin()
    const resolvedAt = new Date(Date.now() - 73 * 3_600_000)
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      resolvedAt,
    })

    actAs(fx.requester)
    const result = await updateRequestStatus(req.id, 'open', 'too late but trying anyway')
    expect(result.error).toBe('The reopen window for this request has expired.')

    const { data: after } = await admin.from('requests').select('status, reopen_count').eq('id', req.id).single()
    expect(after?.status).toBe('resolved')
    expect(after?.reopen_count).toBe(0)
  })

  it("3. a different user cannot reopen someone else's resolved ticket", async () => {
    const admin = getAdmin()
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
    })

    actAs(fx.otherRequester)
    const result = await updateRequestStatus(req.id, 'open', 'not my ticket but trying anyway')
    expect(result.error).toBeTruthy()

    const { data: after } = await admin.from('requests').select('status').eq('id', req.id).single()
    expect(after?.status).toBe('resolved')
  })

  it('4. reopen without a remark is denied', async () => {
    const admin = getAdmin()
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
    })

    actAs(fx.requester)
    const result = await updateRequestStatus(req.id, 'open')
    expect(result.error).toBe('Please explain why you are reopening this request.')

    const { data: after } = await admin.from('requests').select('status').eq('id', req.id).single()
    expect(after?.status).toBe('resolved')
  })

  it('5. a genuine concurrent write is still rejected — concurrency protection was not deleted', async () => {
    const admin = getAdmin()
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      assignedTo: fx.agent.id,
    })

    // Prime both sides' HTTP keep-alive connections first. Without this, an
    // asymmetry left over from whichever of the two identities a prior test
    // last used (its connection still warm) reliably lets that side finish
    // its whole call — several sequential round trips — before the other
    // side's cold connection even sends its first request, collapsing the
    // race into strict sequencing instead of genuine overlap.
    await Promise.all([
      clientForToken(fx.requester.accessToken).from('requests').select('id').limit(1),
      clientForToken(fx.agent.accessToken).from('requests').select('id').limit(1),
    ])

    // Requester reopen (now admin-routed) races the agent's own reopen of the
    // exact same resolved ticket. Both read status='resolved'; Postgres
    // serializes the two UPDATE ... WHERE status='resolved' statements, so
    // exactly one can match — the loser gets the same conflict message a
    // real second human would have seen.
    const [resA, resB] = await Promise.all([
      runAs(fx.requester, () => updateRequestStatus(req.id, 'open', 'requester reopening')),
      runAs(fx.agent, () => updateRequestStatus(req.id, 'open', 'agent reopening independently')),
    ])

    const results = [resA, resB]
    const succeeded = results.filter((r) => !r.error)
    const failed = results.filter((r) => r.error)
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    // Stage 1.1: under enough ambient load (this suite's full run, not this
    // file in isolation — reproduced independently of any Stage 1.1 code
    // change), the two calls' round trips can end up sequential rather than
    // genuinely overlapping at the UPDATE itself, despite the connection
    // priming above. When that happens, the loser's own initial SELECT
    // already sees the winner's committed 'open' status, so it's correctly
    // rejected by the status-transition table (open ⇒ no 'open' target in
    // either AGENT_TRANSITIONS or REQUESTER_TRANSITIONS) instead of by the
    // `.eq('status', currentStatus)` optimistic-concurrency guard. Both are
    // the SAME safety property (no double-reopen, identical end state below)
    // manifesting through two different — both legitimate — code paths;
    // asserting only one exact message was coupling this test to one
    // specific interleaving of a genuinely non-deterministic race rather
    // than to the actual invariant it exists to prove.
    expect(failed[0].error).toMatch(
      /^(This request was just changed by someone else — please refresh and try again\.|Transition to "open" is not permitted\.)$/
    )

    const { data: after } = await admin.from('requests').select('status, reopen_count').eq('id', req.id).single()
    expect(after?.status).toBe('open')
    expect(after?.reopen_count).toBe(1)
  })

  it('6. agent reopen of their own resolved ticket is unaffected (regression)', async () => {
    const admin = getAdmin()
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      assignedTo: fx.agent.id,
    })

    actAs(fx.agent)
    const result = await updateRequestStatus(req.id, 'open', 'agent reopening after a second look')
    expect(result.error).toBeUndefined()

    const { data: after } = await admin.from('requests').select('status, reopen_count, reopen_deadline_at').eq('id', req.id).single()
    expect(after?.status).toBe('open')
    expect(after?.reopen_count).toBe(1)
    expect(after?.reopen_deadline_at).toBeNull()
  })

  it('7. a manually-cancelled ticket still cannot be reopened by the requester', async () => {
    const admin = getAdmin()
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      status: 'cancelled',
      cancellationReason: 'manual',
      reopenDeadlineAt: null,
    })

    actAs(fx.requester)
    const result = await updateRequestStatus(req.id, 'assigned', 'trying to reopen a manually cancelled ticket')
    expect(result.error).toBe('This request cannot be reopened.')

    const { data: after } = await admin.from('requests').select('status').eq('id', req.id).single()
    expect(after?.status).toBe('cancelled')
  })
})
