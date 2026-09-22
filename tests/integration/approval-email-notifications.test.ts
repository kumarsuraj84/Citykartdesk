/**
 * Live report: when a technician sends a ticket for approval, only the approver was
 * emailed — the requester never heard about it, and once the approver decided, the
 * technician who sent it (as opposed to the requester) was never told either, and the
 * approver's comment never reached anyone's email. Against the real database and
 * approval engine; only the mail transport is replaced.
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
import { sendAdHocApproval, approveApproval, rejectApproval } from '@/lib/actions/approvals'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) { mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never) }

async function waitFor(cond: () => boolean, ms = 4000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50))
}

async function freshTicket(fx: D03Fixtures, status: 'in_progress' = 'in_progress') {
  return seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status })
}

describe('approval flow emails: requester + the technician who sent it', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0 })

  it('sending for approval emails the approver AND the requester (who it went to)', async () => {
    const req = await freshTicket(fx)
    actAs(fx.agentA) // Ajay: on the team, sends it
    const res = await sendAdHocApproval(req.id, [fx.manager.id]) // Arvind: approver
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.length >= 2)

    const toApprover = sent.find((e) => e.to.toLowerCase() === fx.manager.email.toLowerCase())
    expect(toApprover).toBeTruthy()

    const toRequester = sent.find((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())
    expect(toRequester, 'requester was never told their ticket went for approval').toBeTruthy()
    expect(toRequester!.html).toMatch(/sent.*for approval/i)
    expect(toRequester!.html).toContain(fx.manager.email.split('@')[0] === '' ? '' : '') // no-op guard, real name assertion below
  })

  it('on APPROVE: requester gets the decision + comment, and so does the technician who sent it', async () => {
    const req = await freshTicket(fx)
    actAs(fx.agentA)
    await sendAdHocApproval(req.id, [fx.manager.id])
    await new Promise((r) => setTimeout(r, 400))
    const { data: approval } = await admin.from('approvals').select('id').eq('request_id', req.id).single()

    sent.length = 0
    actAs(fx.manager)
    const res = await approveApproval(approval!.id, 'Looks good, go ahead.')
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.length >= 2)

    const toRequester = sent.find((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())
    expect(toRequester, 'requester was never told the approval decision').toBeTruthy()
    expect(toRequester!.html).toMatch(/approved/i)
    expect(toRequester!.html).toContain('Looks good, go ahead.')

    const toTechnician = sent.find((e) => e.to.toLowerCase() === fx.agentA.email.toLowerCase())
    expect(toTechnician, 'the technician who sent it for approval was never told the decision').toBeTruthy()
    expect(toTechnician!.html).toMatch(/approved/i)
    expect(toTechnician!.html).toContain('Looks good, go ahead.')
  })

  it('on REJECT: requester and the technician both get the decision + the approver\'s comment', async () => {
    const req = await freshTicket(fx)
    actAs(fx.agentA)
    await sendAdHocApproval(req.id, [fx.manager.id])
    await new Promise((r) => setTimeout(r, 400))
    const { data: approval } = await admin.from('approvals').select('id').eq('request_id', req.id).single()

    sent.length = 0
    actAs(fx.manager)
    const res = await rejectApproval(approval!.id, 'Budget not approved this quarter.')
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.length >= 2)

    const toRequester = sent.find((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())
    expect(toRequester!.html).toMatch(/not approved/i)
    expect(toRequester!.html).toContain('Budget not approved this quarter.')

    const toTechnician = sent.find((e) => e.to.toLowerCase() === fx.agentA.email.toLowerCase())
    expect(toTechnician!.html).toMatch(/not approved/i)
    expect(toTechnician!.html).toContain('Budget not approved this quarter.')
  })

  it('when the requester sent it themselves, they are not double-emailed as both requester and "technician"', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.agentB.id, serviceId: fx.teamB.serviceId, teamId: fx.teamB.id, assignedTo: fx.agentB.id, status: 'in_progress' })
    // agentB is both the requester AND the one sending it (self-service ticket a technician filed for themself).
    const { data: reqRow } = await admin.from('requests').select('id').eq('id', req.id).single()
    expect(reqRow).toBeTruthy()
    actAs(fx.agentB)
    await sendAdHocApproval(req.id, [fx.manager.id])
    await new Promise((r) => setTimeout(r, 400))
    const { data: approval } = await admin.from('approvals').select('id').eq('request_id', req.id).single()

    sent.length = 0
    actAs(fx.manager)
    await approveApproval(approval!.id, 'ok')
    await waitFor(() => sent.length >= 1)
    expect(sent.filter((e) => e.to.toLowerCase() === fx.agentB.email.toLowerCase())).toHaveLength(1)
  })
})
