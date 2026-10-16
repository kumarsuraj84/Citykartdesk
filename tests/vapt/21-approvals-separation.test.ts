// Remediation phase 2: separation of duties across the whole approval workflow (VAPT-016), and who may read approval routes (VAPT-015 / 019).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendAdHocApproval, addAdHocApprovers, delegateApproval, approveApproval, searchManagersForApproval } from '@/lib/actions/approvals'

vi.setConfig({ testTimeout: 120_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const newTicket = () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
const pending = async (requestId: string) => (await admin().from('approvals').select('id, workflow_id, requested_by, status').eq('request_id', requestId).eq('status', 'pending').maybeSingle()).data

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

describe('choosing approvers', () => {
  it('the requester and the sender cannot be named as approvers', async () => {
    const t = await newTicket()
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.requesterA.id])).error).toBeTruthy()      // the person who raised it
    expect((await sendAdHocApproval(t.id, [fx.agentA.id])).error).toBeTruthy()          // the sender themselves
    expect(await pending(t.id)).toBeNull()
    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()
    expect(await pending(t.id)).toMatchObject({ requested_by: fx.agentA.id })
  })
  it('adding approvers to a pending approval: not yourself, not the requester, not the sender', async () => {
    const t = await newTicket()
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()
    // a second technician of the group tries to add himself
    await admin().from('team_members').insert({ team_id: fx.teamA.id, user_id: fx.agentB.id, org_id: fx.orgId })
    actAs(fx.agentB)
    expect((await addAdHocApprovers(t.id, [fx.agentB.id])).error).toBeTruthy()
    expect((await addAdHocApprovers(t.id, [fx.requesterA.id])).error).toBeTruthy()
    actAs(fx.agentA)
    expect((await addAdHocApprovers(t.id, [fx.agentA.id])).error).toBeTruthy()
    expect((await addAdHocApprovers(t.id, [fx.admin.id])).error).toBeUndefined()
    const { data: steps } = await admin().from('approval_workflow_steps').select('approver_user_id, added_by').eq('workflow_id', (await pending(t.id))!.workflow_id)
    expect(steps?.find((s) => s.approver_user_id === fx.admin.id)?.added_by).toBe(fx.agentA.id)
    await admin().from('team_members').delete().eq('team_id', fx.teamA.id).eq('user_id', fx.agentB.id)
  })
  it('delegating: not to yourself, not to the requester, not to the sender; to a colleague is fine', async () => {
    const t = await newTicket()
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()
    const a = await pending(t.id)
    actAs(fx.manager)
    expect((await delegateApproval(a!.id, fx.manager.id)).error).toBeTruthy()
    expect((await delegateApproval(a!.id, fx.requesterA.id)).error).toBeTruthy()
    expect((await delegateApproval(a!.id, fx.agentA.id)).error).toBeTruthy()
    expect((await delegateApproval(a!.id, fx.admin.id)).error).toBeUndefined()
  })
  it('the requester and the sender still cannot decide (the original rule)', async () => {
    const t = await newTicket()
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()
    const a = await pending(t.id)
    actAs(fx.requesterA)
    expect((await approveApproval(a!.id, 'I approve my own request')).error).toBeTruthy()
    actAs(fx.agentA)
    expect((await approveApproval(a!.id, 'I approve what I sent')).error).toBeTruthy()
    expect((await pending(t.id))?.status).toBe('pending')
  })
})

describe('who can look up approvers and read approval routes', () => {
  it('a requester cannot search for approvers; staff can (and an e-mail is matched only when typed in full)', async () => {
    actAs(fx.requesterA)
    expect(await searchManagersForApproval('D03')).toEqual([])
    actAs(fx.agentA)
    expect((await searchManagersForApproval('Manager')).length).toBeGreaterThan(0)
    expect(await searchManagersForApproval(fx.manager.email.slice(0, 12))).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: fx.manager.id })]))
  })
  it('a requester cannot list approval routes or steps of other people\'s tickets', async () => {
    const t = await newTicket()
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()
    const wf = (await pending(t.id))!.workflow_id
    const other = clientForToken(fx.requesterB.accessToken)                   // requester B has nothing to do with this ticket
    expect((await other.from('approval_workflows').select('id,name').eq('id', wf)).data ?? []).toEqual([])
    expect((await other.from('approval_workflow_steps').select('id').eq('workflow_id', wf)).data ?? []).toEqual([])
    const owner = clientForToken(fx.requesterA.accessToken)                   // the ticket's own requester can follow it
    expect(((await owner.from('approval_workflows').select('id').eq('id', wf)).data ?? []).length).toBe(1)
    const asManager = clientForToken(fx.manager.accessToken)                  // the approver can read the steps he must decide
    expect(((await asManager.from('approval_workflow_steps').select('id').eq('workflow_id', wf)).data ?? []).length).toBeGreaterThan(0)
  })
})
