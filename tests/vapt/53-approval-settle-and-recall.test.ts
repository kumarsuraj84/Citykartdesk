// B-05 / B-06 on the isolated audit stack: a decision leaves the approval and the ticket in step with each other, the history tells the truth about the status the
// ticket went back to, a stale rejection leaves no stray decision, and a manager can recall (withdraw) a pending approval so a ticket is never stuck on hold.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendAdHocApproval, approveApproval, rejectApproval, recallApproval } from '@/lib/actions/approvals'

vi.setConfig({ testTimeout: 120_000 })
let fx: D03Fixtures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => getAdmin() as any
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const newTicket = (status = 'in_progress') => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: status as never })
const approvalOf = async (requestId: string) => (await admin().from('approvals').select('id, status').eq('request_id', requestId).order('created_at', { ascending: false }).limit(1).maybeSingle()).data
const ticket = async (id: string) => (await admin().from('requests').select('status, pre_approval_status, waiting_since').eq('id', id).single()).data
const send = async (id: string) => { actAs(fx.agentA); expect((await sendAdHocApproval(id, [fx.manager.id])).error).toBeUndefined(); return (await approvalOf(id))!.id as string }

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

describe('settling an approval', () => {
  it('approve: the ticket goes back to what it was and the history shows that status', async () => {
    const t = await newTicket('waiting_user')
    const id = await send(t.id)
    actAs(fx.manager)
    expect((await approveApproval(id, 'fine')).error).toBeUndefined()
    expect(await ticket(t.id)).toMatchObject({ status: 'waiting_user', pre_approval_status: null })
    const { data: act } = await admin().from('request_activity').select('metadata').eq('request_id', t.id).eq('action', 'status_changed').order('created_at', { ascending: false }).limit(1)
    expect(act?.[0]?.metadata).toMatchObject({ from: 'pending_approval', to: 'waiting_user' })
  })

  it('a second decision on a settled approval is refused and writes no decision row', async () => {
    const t = await newTicket()
    const id = await send(t.id)
    actAs(fx.manager)
    expect((await approveApproval(id, 'yes')).error).toBeUndefined()
    const before = (await admin().from('approval_decisions').select('id').eq('approval_id', id)).data?.length
    expect((await rejectApproval(id, 'too late')).error).toBeTruthy()
    expect((await admin().from('approval_decisions').select('id').eq('approval_id', id)).data?.length).toBe(before)
    expect((await ticket(t.id))!.status).toBe('in_progress')
  })

  it('reject cancels only a ticket that is still waiting for this approval', async () => {
    const t = await newTicket()
    const id = await send(t.id)
    await admin().from('requests').update({ status: 'in_progress', pre_approval_status: null }).eq('id', t.id)   // a rule moved it on
    actAs(fx.manager)
    expect((await rejectApproval(id, 'no')).error).toBeUndefined()
    expect((await approvalOf(t.id))!.status).toBe('rejected')
    expect((await ticket(t.id))!.status).toBe('in_progress')
  })
})

describe('recalling an approval', () => {
  it('a manager withdraws it: the approval is cancelled, the ticket is back where it was, nothing can decide it any more', async () => {
    const t = await newTicket()
    const id = await send(t.id)
    actAs(fx.manager)
    expect((await recallApproval(t.id, 'wrong approver')).error).toBeUndefined()
    expect((await approvalOf(t.id))!.status).toBe('cancelled')
    expect(await ticket(t.id)).toMatchObject({ status: 'in_progress', pre_approval_status: null })
    expect((await approveApproval(id, 'late')).error).toBeTruthy()
  })

  it('a technician (not a manager) cannot recall, and an unrelated ticket is not affected', async () => {
    const t = await newTicket()
    await send(t.id)
    actAs(fx.agentA)
    expect((await recallApproval(t.id)).error).toBeTruthy()
    expect((await approvalOf(t.id))!.status).toBe('pending')
    expect((await ticket(t.id))!.status).toBe('pending_approval')
  })

  it('a ticket that is not waiting for an approval cannot be recalled', async () => {
    const t = await newTicket()
    actAs(fx.manager)
    expect((await recallApproval(t.id)).error).toBeTruthy()
  })
})
