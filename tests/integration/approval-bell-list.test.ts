/**
 * The Approvals bell and its numbers (reported: the badge said 1, the open list said "Nothing awaiting your approval"). The list
 * and the numbers now come from the approvals themselves, so an approval stays until it is approved or rejected: opening the
 * e-mail or the ticket (which marks notifications read), archiving a notification, or 50 newer notifications make no difference.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendAdHocApproval, approveApproval, rejectApproval } from '@/lib/actions/approvals'
import { getActionableApprovalsForUser, getApprovals } from '@/lib/queries/approvals'
import { approvalPeopleLine } from '@/lib/approvals/people'
import { getNotifications } from '@/lib/queries/notifications'
import { getNavCounts } from '@/lib/queries/profiles'

vi.setConfig({ testTimeout: 60_000 })

const mocked = vi.mocked(createClient)
const actAs = (u: TestUser) => mocked.mockResolvedValue(clientForToken(u.accessToken) as never)
const ORG = '00000000-0000-0000-0000-000000000001'

describe('Approvals bell: what is waiting for me', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  beforeAll(async () => { fx = await setupD03Fixtures() }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => actAs(fx.agentA))

  const ticket = () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
  const waitingFor = (u: TestUser, role: string) => getActionableApprovalsForUser(u.id, role, ORG)

  it('lists an approval with the request, who raised it and who sent it, until it is decided', async () => {
    const req = await ticket()
    expect((await sendAdHocApproval(req.id, [fx.manager.id, fx.admin.id])).error).toBeUndefined()

    const mine = (await waitingFor(fx.manager, 'manager')).filter((i) => i.requestId === req.id)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ requestNo: req.request_no, requesterName: 'D03 Requester A', sentByName: 'D03 Agent A' })
    // the bell says who it is waiting on, by name
    expect(mine[0].awaiting).toMatch(/^Awaiting: D03 (Manager and D03 Admin|Admin and D03 Manager)$/)
    expect((await waitingFor(fx.admin, 'admin')).some((i) => i.requestId === req.id)).toBe(true)
    expect((await waitingFor(fx.agentB, 'agent')).some((i) => i.requestId === req.id)).toBe(false) // not an approver

    actAs(fx.manager)
    expect((await approveApproval(mine[0].approvalId, 'ok')).error).toBeUndefined()
    // decided: gone for BOTH approvers (the second is no longer needed)
    expect((await waitingFor(fx.manager, 'manager')).some((i) => i.requestId === req.id)).toBe(false)
    expect((await waitingFor(fx.admin, 'admin')).some((i) => i.requestId === req.id)).toBe(false)
  })

  it('the Approvals page shows the approver names to a technician too, and who approved afterwards', async () => {
    const req = await ticket()
    await sendAdHocApproval(req.id, [fx.manager.id, fx.admin.id])
    actAs(fx.agentA) // the technician who sent it (not an approver)
    const pending = (await getApprovals('pending', { pageSize: 100 })).data.find((a) => a.request_id === req.id)
    expect(pending, 'the technician cannot see the approval').toBeTruthy()
    expect(pending!.steps.map((s) => s.approver?.full_name).sort()).toEqual(['D03 Admin', 'D03 Manager'])
    expect(approvalPeopleLine(pending!).text).toMatch(/Awaiting: D03/)

    actAs(fx.admin)
    await approveApproval(pending!.id, 'approved by the admin')
    actAs(fx.agentA)
    const done = (await getApprovals('approved', { pageSize: 100 })).data.find((a) => a.request_id === req.id)
    expect(approvalPeopleLine(done!).text).toBe('Approved by D03 Admin · also asked: D03 Manager')
  })

  it('stays listed when the notification was read, archived, or buried under newer ones', async () => {
    const req = await ticket()
    await sendAdHocApproval(req.id, [fx.manager.id])
    const before = await waitingFor(fx.manager, 'manager')
    expect(before.some((i) => i.requestId === req.id)).toBe(true)

    // the e-mail / ticket was opened: the notification is read, then even archived
    await admin.from('notifications').update({ read_at: new Date().toISOString(), archived_at: new Date().toISOString() }).eq('user_id', fx.manager.id).eq('request_id', req.id).eq('type', 'approval_requested')
    // and 15 newer notifications of other kinds arrive
    await admin.from('notifications').insert(Array.from({ length: 15 }, (_, i) => ({ user_id: fx.manager.id, actor_id: fx.agentA.id, type: 'comment_added' as const, title: `noise ${i}`, body: 'b' })))

    expect((await waitingFor(fx.manager, 'manager')).some((i) => i.requestId === req.id)).toBe(true)
  })

  it('the general bell no longer spends its ten slots on approval requests', async () => {
    const req = await ticket()
    await sendAdHocApproval(req.id, [fx.manager.id])
    await new Promise((r) => setTimeout(r, 800)) // the notification is written in the background
    actAs(fx.manager)
    const general = await getNotifications(fx.manager.id, { limit: 10, excludeTypes: ['approval_requested'] })
    expect(general.every((n) => n.type !== 'approval_requested')).toBe(true)
    const all = await getNotifications(fx.manager.id, { limit: 50 })
    expect(all.some((n) => n.type === 'approval_requested')).toBe(true) // the notifications page still shows them
  })

  it('the badge and the sidebar number are the same list, and the notification number leaves approvals out', async () => {
    const req = await ticket()
    await sendAdHocApproval(req.id, [fx.manager.id])
    actAs(fx.manager)
    const list = await waitingFor(fx.manager, 'manager')
    const counts = await getNavCounts(fx.manager.id)
    expect(counts.approvals).toBe(list.length)
    const { count: unreadOther } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', fx.manager.id).is('read_at', null).is('archived_at', null).neq('type', 'approval_requested')
    expect(counts.notifications).toBe(unreadOther ?? 0)
  })

  it('a step-by-step approval is listed only for the person whose turn it is', async () => {
    const req = await ticket()
    const { data: wf } = await admin.from('approval_workflows').insert({ name: `Seq test ${Date.now()}`, org_id: ORG }).select('id').single()
    await admin.from('approval_workflow_steps').insert([
      { workflow_id: wf!.id, step_order: 1, approver_type: 'specific_user', approver_user_id: fx.manager.id },
      { workflow_id: wf!.id, step_order: 2, approver_type: 'specific_user', approver_user_id: fx.admin.id },
    ])
    const { data: ap } = await admin.from('approvals').insert({ request_id: req.id, workflow_id: wf!.id, current_step: 1, status: 'pending', requested_by: fx.agentA.id }).select('id').single()
    await admin.from('requests').update({ status: 'pending_approval' }).eq('id', req.id)

    expect((await waitingFor(fx.manager, 'manager')).some((i) => i.approvalId === ap!.id)).toBe(true)
    expect((await waitingFor(fx.admin, 'admin')).some((i) => i.approvalId === ap!.id)).toBe(false) // not their turn yet

    await admin.from('approval_decisions').insert({ approval_id: ap!.id, step_order: 1, decided_by: fx.manager.id, decision: 'approved', comment: 'first step ok' })
    await admin.from('approvals').update({ current_step: 2 }).eq('id', ap!.id)
    expect((await waitingFor(fx.manager, 'manager')).some((i) => i.approvalId === ap!.id)).toBe(false)
    expect((await waitingFor(fx.admin, 'admin')).some((i) => i.approvalId === ap!.id)).toBe(true)

    actAs(fx.admin)
    expect((await rejectApproval(ap!.id, 'no')).error).toBeUndefined()
    expect((await waitingFor(fx.admin, 'admin')).some((i) => i.approvalId === ap!.id)).toBe(false)
  })

  it('is limited to the person\'s own organisation', async () => {
    const req = await ticket()
    await sendAdHocApproval(req.id, [fx.manager.id])
    expect((await getActionableApprovalsForUser(fx.manager.id, 'manager', '99999999-9999-9999-9999-999999999999'))).toEqual([])
  })
})
