/**
 * Regression: a requester cancelling their own *open* ticket (a plain, valid
 * REQUESTER_TRANSITIONS['open'] -> 'cancelled' move) failed with "This request
 * was just changed by someone else — please refresh and try again", with zero
 * real concurrent writes.
 *
 * Same root cause as DESK-UAT-001 and the approval-rejection-reopen bug: the
 * requests_update RLS policy grants UPDATE only to team members/managers, with
 * no requester_id = auth.uid() clause at all. Those two earlier fixes only
 * routed their own specific reopen case through the admin client — a plain
 * requester cancel (not a reopen at all) still went through the RLS-scoped
 * client and hit the exact same zero-row "conflict". See lib/actions/requests.ts's
 * `requesterInitiated` (generalized from `requesterInitiatedReopen`).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { setupFixtures, seedRequest, clientForToken, getAdmin, type Fixtures, type TestUser } from '../setup/fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)
const identityStorage = new AsyncLocalStorage<TestUser>()
mockedCreateClient.mockImplementation(async () => {
  const user = identityStorage.getStore()
  if (!user) throw new Error('createClient() called outside actAs() context')
  return clientForToken(user.accessToken) as never
})
function actAs(user: TestUser) {
  identityStorage.enterWith(user)
}

describe('requester cancelling their own open ticket', () => {
  let fx: Fixtures

  beforeAll(async () => {
    fx = await setupFixtures()
  }, 30_000)

  afterAll(async () => {
    await fx.cleanup()
  }, 30_000)

  it('succeeds — not a false "changed by someone else" conflict', async () => {
    const admin = getAdmin()
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      status: 'open',
    })

    actAs(fx.requester)
    const result = await updateRequestStatus(req.id, 'cancelled', 'Ordered the wrong part, cancelling.')
    expect(result.error).toBeUndefined()

    const { data: after } = await admin.from('requests').select('status, cancellation_reason').eq('id', req.id).single()
    expect(after?.status).toBe('cancelled')
    expect(after?.cancellation_reason).toBe('manual')

    const { data: comments } = await admin.from('request_comments').select('body').eq('request_id', req.id)
    expect(comments?.some((c) => c.body.includes('Ordered the wrong part'))).toBe(true)
  })

  it('is rejected without a remark, and the row is left untouched', async () => {
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      status: 'open',
    })

    actAs(fx.requester)
    const result = await updateRequestStatus(req.id, 'cancelled')
    expect(result.error).toBe('Please explain why you are cancelling this request.')

    const admin = getAdmin()
    const { data: after } = await admin.from('requests').select('status').eq('id', req.id).single()
    expect(after?.status).toBe('open')
  })

  it("a different requester cannot cancel someone else's open ticket (RLS scoping still holds)", async () => {
    const req = await seedRequest({
      requesterId: fx.requester.id,
      serviceId: fx.serviceId,
      teamId: fx.teamId,
      orgId: fx.orgId,
      status: 'open',
    })

    actAs(fx.otherRequester)
    const result = await updateRequestStatus(req.id, 'cancelled')
    // requests_select RLS already hides another requester's row entirely,
    // before this function's code (or the requester_id scoping this test is
    // really about) is even reached — an earlier, stricter boundary.
    expect(result.error).toBe('Request not found.')

    const admin = getAdmin()
    const { data: after } = await admin.from('requests').select('status').eq('id', req.id).single()
    expect(after?.status).toBe('open')
  })
})
