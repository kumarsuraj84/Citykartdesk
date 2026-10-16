// Remediation phase 2: the server actions that now write tickets with the server's key must keep their own authorization airtight (VAPT-001, VAPT-055).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { assignRequest, updateRequestSource, updateRequestStatus } from '@/lib/actions/requests'

vi.setConfig({ testTimeout: 120_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const row = async (id: string) => (await admin().from('requests').select('assigned_to, status, source_metadata').eq('id', id).single()).data!

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

describe('assignment', () => {
  it('a manager cannot assign a ticket to a plain requester or to a deactivated person', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    actAs(fx.manager)
    expect((await assignRequest(t.id, fx.requesterB.id)).error).toBeTruthy()
    await admin().from('profiles').update({ is_active: false }).eq('id', fx.agentB.id)
    expect((await assignRequest(t.id, fx.agentB.id)).error).toBeTruthy()
    await admin().from('profiles').update({ is_active: true }).eq('id', fx.agentB.id)
    expect((await row(t.id)).assigned_to).toBeNull()
  })
  it('a manager can still assign to an active technician; a technician can assign to a teammate; a technician of another group cannot touch it', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    actAs(fx.manager)
    expect((await assignRequest(t.id, fx.agentA.id)).error).toBeUndefined()
    expect((await row(t.id)).assigned_to).toBe(fx.agentA.id)
    actAs(fx.agentB)
    expect((await assignRequest(t.id, fx.agentB.id)).error).toBeTruthy()
    expect((await row(t.id)).assigned_to).toBe(fx.agentA.id)
  })
})

describe('source of a ticket', () => {
  it('only the ticket\'s technician group or a manager can change it; a requester and another group cannot', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    for (const who of [fx.requesterA, fx.agentB]) {
      actAs(who)
      expect((await updateRequestSource(t.id, 'email')).error, who.email).toBeTruthy()
    }
    expect((await row(t.id)).source_metadata).not.toMatchObject({ created_via: 'email' })
    actAs(fx.agentA)
    expect((await updateRequestSource(t.id, 'email')).error).toBeUndefined()
    expect((await row(t.id)).source_metadata).toMatchObject({ created_via: 'email' })
  })
})

describe('status change keeps its rules now that the server writes it', () => {
  it('a technician of another group cannot move the ticket; its own technician can; the remark is recorded with the move', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(fx.agentB)
    expect((await updateRequestStatus(t.id, 'waiting_user', 'Please send a photo of the unit.')).error).toBeTruthy()
    expect((await row(t.id)).status).toBe('in_progress')
    actAs(fx.agentA)
    expect((await updateRequestStatus(t.id, 'waiting_user', 'Please send a photo of the unit.')).error).toBeUndefined()
    expect((await row(t.id)).status).toBe('waiting_user')
    const { data: c } = await admin().from('request_comments').select('id').eq('request_id', t.id).eq('body', 'Please send a photo of the unit.')
    expect(c?.length).toBe(1)
  })
  it('a requester cannot resolve or close their own ticket, but can cancel an open one', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    actAs(fx.requesterA)
    expect((await updateRequestStatus(t.id, 'resolved', 'done by me, please close')).error).toBeTruthy()
    expect((await row(t.id)).status).toBe('open')
    expect((await updateRequestStatus(t.id, 'cancelled', 'raised by mistake')).error).toBeUndefined()
    expect((await row(t.id)).status).toBe('cancelled')
  })
})
