/**
 * Who sees which approvals on the Approvals page:
 *   requester: their own tickets (and approvals sent to them)
 *   technician: their own and their group's tickets (and approvals sent to them)
 *   manager: approvals sent to them, on their own tickets, and on their team's tickets - not the whole organisation
 *   admin / platform owner: everything
 * Real database and row rules.
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
import { sendAdHocApproval } from '@/lib/actions/approvals'
import { getApprovals } from '@/lib/queries/approvals'

vi.setConfig({ testTimeout: 60_000 })
const mocked = vi.mocked(createClient)
const actAs = (u: TestUser) => mocked.mockResolvedValue(clientForToken(u.accessToken) as never)

describe('Approvals page: who sees what', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  const id: Record<'sentToAdminA' | 'managersOwn' | 'managersTeam' | 'sentToManager' | 'unrelated', string> = {} as never

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    // the manager belongs to group B
    await admin.from('team_members').insert({ team_id: fx.teamB.id, user_id: fx.manager.id, org_id: '00000000-0000-0000-0000-000000000001' })

    const approvalFor = async (reqId: string, by: TestUser, to: TestUser) => {
      actAs(by)
      expect((await sendAdHocApproval(reqId, [to.id])).error).toBeUndefined()
      return (await admin.from('approvals').select('id').eq('request_id', reqId).single()).data!.id as string
    }
    const a = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    id.sentToAdminA = await approvalFor(a.id, fx.agentA, fx.admin) // group A, not the manager's
    const b = await seedRequestLike(fx, { requesterId: fx.manager.id, serviceId: fx.teamB.serviceId, teamId: fx.teamB.id, assignedTo: fx.agentB.id, status: 'in_progress' })
    id.managersOwn = await approvalFor(b.id, fx.agentB, fx.admin) // raised by the manager
    const c = await seedRequestLike(fx, { requesterId: fx.requesterB.id, serviceId: fx.teamB.serviceId, teamId: fx.teamB.id, assignedTo: fx.agentB.id, status: 'in_progress' })
    id.managersTeam = await approvalFor(c.id, fx.agentB, fx.admin) // the manager's group
    const d = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    id.sentToManager = await approvalFor(d.id, fx.agentA, fx.manager) // group A, but sent TO the manager
    const e = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    id.unrelated = await approvalFor(e.id, fx.agentA, fx.admin) // group A, to the admin: nothing to do with the manager
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  const ours = (rows: { id: string }[]) => Object.entries(id).filter(([, v]) => rows.some((r) => r.id === v)).map(([k]) => k).sort()

  it('a manager sees approvals sent to them, on their own tickets and on their team\'s tickets, and nothing else', async () => {
    actAs(fx.manager)
    const r = await getApprovals('all', { pageSize: 200, restrictTo: { userId: fx.manager.id, teamIds: [fx.teamB.id] } })
    expect(ours(r.data)).toEqual(['managersOwn', 'managersTeam', 'sentToManager'])
    expect(r.data.some((a) => a.id === id.sentToAdminA || a.id === id.unrelated)).toBe(false)
    expect(r.counts!.all).toBe(r.total) // the tab numbers match the list
    expect(r.counts!.pending).toBe(r.data.filter((a) => a.status === 'pending').length)
  })

  it('the tab filter and paging work inside a manager\'s view', async () => {
    actAs(fx.manager)
    const restrictTo = { userId: fx.manager.id, teamIds: [fx.teamB.id] }
    const pending = await getApprovals('pending', { pageSize: 200, restrictTo })
    expect(ours(pending.data)).toEqual(['managersOwn', 'managersTeam', 'sentToManager'])
    expect((await getApprovals('approved', { pageSize: 200, restrictTo })).data).toEqual([])
    const page1 = await getApprovals('all', { pageSize: 2, page: 1, restrictTo })
    const page2 = await getApprovals('all', { pageSize: 2, page: 2, restrictTo })
    expect(page1.data).toHaveLength(2)
    expect(page2.data.length).toBeGreaterThanOrEqual(1)
    expect(page1.data.some((a) => page2.data.some((b) => b.id === a.id))).toBe(false)
    expect(page1.total).toBe(page2.total)
  })

  it('an admin sees all of them', async () => {
    actAs(fx.admin)
    const r = await getApprovals('all', { pageSize: 500 })
    expect(ours(r.data)).toEqual(['managersOwn', 'managersTeam', 'sentToAdminA', 'sentToManager', 'unrelated'])
  })

  it('a technician sees their own and their group\'s tickets only', async () => {
    actAs(fx.agentA)
    const r = await getApprovals('all', { pageSize: 500 })
    expect(ours(r.data)).toEqual(['sentToAdminA', 'sentToManager', 'unrelated']) // group A
    actAs(fx.agentB)
    expect(ours((await getApprovals('all', { pageSize: 500 })).data)).toEqual(['managersOwn', 'managersTeam']) // group B
  })

  it('a requester sees the approvals on their own tickets only', async () => {
    actAs(fx.requesterA)
    expect(ours((await getApprovals('all', { pageSize: 500 })).data)).toEqual(['sentToAdminA', 'sentToManager', 'unrelated'])
    actAs(fx.requesterB)
    expect(ours((await getApprovals('all', { pageSize: 500 })).data)).toEqual(['managersTeam'])
  })
})
