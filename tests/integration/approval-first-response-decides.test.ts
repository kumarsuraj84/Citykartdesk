/**
 * A technician asked Banking for approval, then wanted Ankur to approve as well. Two rules:
 *  1. Several approvers on one ad-hoc approval: the FIRST to respond decides (approve or
 *     reject) — nobody else has to act, and their later attempt is turned away.
 *  2. An approval already open can take extra approvers (instead of being refused as
 *     "already in approval"). Only for ad-hoc approvals, not fixed multi-step workflows.
 * Real database + approval engine; only the mail transport is replaced.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendAdHocApproval, addAdHocApprovers, approveApproval, rejectApproval } from '@/lib/actions/approvals'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) { mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never) }

describe('several approvers on one approval: the first response is final', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => { fx = await setupD03Fixtures() }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  const ticket = () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
  const approvalOf = async (requestId: string) => (await admin.from('approvals').select('id, status').eq('request_id', requestId).single()).data!
  const statusOf = async (requestId: string) => (await admin.from('requests').select('status').eq('id', requestId).single()).data!.status

  it('one approver approving settles it — the other does not have to act', async () => {
    const req = await ticket()
    actAs(fx.agentA)
    expect((await sendAdHocApproval(req.id, [fx.manager.id, fx.admin.id])).error).toBeUndefined()
    expect(await statusOf(req.id)).toBe('pending_approval')
    const approval = await approvalOf(req.id)

    actAs(fx.manager)
    expect((await approveApproval(approval.id, 'fine by me')).error).toBeUndefined()

    expect((await approvalOf(req.id)).status).toBe('approved')
    expect(await statusOf(req.id)).toBe('in_progress')

    actAs(fx.admin)
    expect((await approveApproval(approval.id)).error).toBe('This approval is no longer pending.')
  })

  it('one approver rejecting settles it as rejected, even though the other has not acted', async () => {
    const req = await ticket()
    actAs(fx.agentA)
    await sendAdHocApproval(req.id, [fx.manager.id, fx.admin.id])
    const approval = await approvalOf(req.id)

    actAs(fx.admin)
    expect((await rejectApproval(approval.id, 'not this quarter')).error).toBeUndefined()

    expect((await approvalOf(req.id)).status).toBe('rejected')
    expect(await statusOf(req.id)).toBe('cancelled')

    actAs(fx.manager)
    expect((await approveApproval(approval.id)).error).toBe('This approval is no longer pending.')
  })
})

describe('adding an approver to an approval that is already open', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => { fx = await setupD03Fixtures() }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  const ticket = () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
  const approvalOf = async (requestId: string) => (await admin.from('approvals').select('id, status, workflow_id').eq('request_id', requestId).single()).data!

  it('a second "send for approval" is still refused, but adding people works and the new person can decide', async () => {
    const req = await ticket()
    actAs(fx.agentA)
    await sendAdHocApproval(req.id, [fx.manager.id]) // "Banking"
    expect((await sendAdHocApproval(req.id, [fx.admin.id])).error).toMatch(/already in approval/i)

    const added = await addAdHocApprovers(req.id, [fx.admin.id]) // "Ankur"
    expect(added.error).toBeUndefined()

    const approval = await approvalOf(req.id)
    const { data: steps } = await admin.from('approval_workflow_steps').select('approver_user_id').eq('workflow_id', approval.workflow_id)
    expect((steps ?? []).map((s) => s.approver_user_id).sort()).toEqual([fx.manager.id, fx.admin.id].sort())
    expect(approval.status).toBe('pending')

    // Ankur rejects while Banking has done nothing → rejected is final.
    actAs(fx.admin)
    expect((await rejectApproval(approval.id, 'no')).error).toBeUndefined()
    expect((await approvalOf(req.id)).status).toBe('rejected')
  })

  it('does not add someone who is already an approver', async () => {
    const req = await ticket()
    actAs(fx.agentA)
    await sendAdHocApproval(req.id, [fx.manager.id])
    expect((await addAdHocApprovers(req.id, [fx.manager.id])).error).toMatch(/already an approver/i)
  })

  it('refuses when there is no open approval, and for someone outside the team', async () => {
    const req = await ticket()
    actAs(fx.agentA)
    expect((await addAdHocApprovers(req.id, [fx.admin.id])).error).toMatch(/no pending approval/i)

    await sendAdHocApproval(req.id, [fx.manager.id])
    actAs(fx.agentB) // other team's technician: can't even see this ticket
    expect((await addAdHocApprovers(req.id, [fx.admin.id])).error).toMatch(/not found|unauthorized/i)
    const { workflow_id } = await approvalOf(req.id)
    const { data: steps } = await admin.from('approval_workflow_steps').select('approver_user_id').eq('workflow_id', workflow_id)
    expect((steps ?? []).map((s) => s.approver_user_id)).toEqual([fx.manager.id])
  })

  it('refuses for a fixed multi-step approval', async () => {
    const req = await ticket()
    actAs(fx.agentA)
    await sendAdHocApproval(req.id, [fx.manager.id])
    const approval = await approvalOf(req.id)
    await admin.from('approvals').update({ current_step: 1 }).eq('id', approval.id) // sequential workflow
    expect((await addAdHocApprovers(req.id, [fx.admin.id])).error).toMatch(/fixed set of steps/i)
  })
})
