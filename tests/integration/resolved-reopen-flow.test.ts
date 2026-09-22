/**
 * The requester's own "reopen a resolved ticket" flow: reopening actually notifies both
 * sides with the requester's comment (self-reopen used to notify no one at all — the
 * requester-notify block explicitly skips self-transitions, and the technician's copy
 * had no comment and a raw UUID in the body), reopen_count/badge state is correct, and
 * the window respects the admin-configured setting. Against the real database.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string }) => { sent.push(p); return {} }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) { mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never) }

async function waitFor(cond: () => boolean, ms = 4000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50))
}

describe('requester reopening their own resolved ticket', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0 })

  async function resolvedTicket() {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(fx.agentA)
    await updateRequestStatus(req.id, 'resolved', 'Replaced the part.')
    sent.length = 0
    return req
  }

  it('reopening notifies BOTH the requester (confirmation) and the technician (with the comment) — was: neither', async () => {
    const req = await resolvedTicket()
    actAs(fx.requesterA)
    const res = await updateRequestStatus(req.id, 'open', 'Still broken after the fix.')
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.length >= 2)

    const toRequester = sent.find((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())
    expect(toRequester, 'requester never got their own reopen confirmation').toBeTruthy()
    expect(toRequester!.html).toMatch(/open/i)
    expect(toRequester!.html).toContain('D03 Agent A') // mentions who it's back with

    const toTechnician = sent.find((e) => e.to.toLowerCase() === fx.agentA.email.toLowerCase())
    expect(toTechnician, 'technician never heard the ticket was reopened').toBeTruthy()
    expect(toTechnician!.html).toContain('Still broken after the fix.')
    // The old body text was literally "A request has been reopened: <uuid>" — check the
    // human-readable sentence, not the (legitimate) UUID inside the "View Request" link's href.
    const bodyText = toTechnician!.html.replace(/<a[^>]*href="[^"]*"[^>]*>/gi, '')
    expect(bodyText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/)
  })

  it('reopen_count increments and the deadline clears (drives the "Reopened" badge + closes the window)', async () => {
    const req = await resolvedTicket()
    actAs(fx.requesterA)
    await updateRequestStatus(req.id, 'open', 'Still broken.')
    const { data } = await admin.from('requests').select('reopen_count, reopen_deadline_at, status').eq('id', req.id).single()
    expect(data!.reopen_count).toBe(1)
    expect(data!.reopen_deadline_at).toBeNull()
    expect(data!.status).toBe('open')
  })

  it('cannot be reopened once the deadline has passed', async () => {
    const req = await resolvedTicket()
    await admin.from('requests').update({ reopen_deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', req.id)
    actAs(fx.requesterA)
    const res = await updateRequestStatus(req.id, 'open', 'Too late?')
    expect(res.error).toBeTruthy()
  })

  it('a different requester cannot reopen someone else\'s resolved ticket', async () => {
    const req = await resolvedTicket()
    actAs(fx.requesterB)
    const res = await updateRequestStatus(req.id, 'open', 'Not mine to reopen.')
    expect(res.error).toBeTruthy()
  })
})
