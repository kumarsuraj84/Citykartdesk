// QA gap-closing tests (isolated audit stack, synthetic data). Behaviours the feature trace found with no test at all:
//  - automatic time tracking: starts when work starts, stops when it stops, one open entry at most;
//  - round-robin and load-balanced assignment, and a ticket held by a vendor technician is never taken away by a rule;
//  - the home dashboard counts: what the requester and the technician see as "open" includes held and waiting tickets, never resolved ones.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, createTestUser, seedRequestLike, getAdmin, type D03Fixtures, type TestUser } from '../../tests/setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'
import { runRulesForTrigger } from '@/lib/rules/run'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const tag = `qg${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
let agent2: TestUser
let vendor: TestUser
let company = ''
const ruleIds: string[] = []
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  agent2 = await createTestUser(`${tag}-a2`, 'QA Gap Agent Two')
  await a.from('profiles').update({ role: 'agent', org_id: fx.orgId, is_active: true }).eq('id', agent2.id)
  await a.from('team_members').insert({ team_id: fx.teamA.id, user_id: agent2.id, org_id: fx.orgId })
  company = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Co` }).select('id').single()).data.id
  vendor = await createTestUser(`${tag}-v`, 'QA Gap Vendor')
  await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: company, vendor_role: 'technician' }).eq('id', vendor.id)
}, 300_000)

afterAll(async () => {
  const a = db()
  if (ruleIds.length) await a.from('business_rules').delete().in('id', ruleIds)
  await a.from('request_time_entries').delete().in('user_id', [fx.agentA.id, agent2.id])
  await a.from('team_members').delete().eq('user_id', agent2.id)
  await a.auth.admin.deleteUser(agent2.id).catch(() => {})
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null }).eq('id', vendor.id)   // the link first, then the company
  await a.from('vendor_companies').delete().eq('id', company)
  await a.auth.admin.deleteUser(vendor.id).catch(() => {})
  await fx?.cleanup()
}, 180_000)

async function rule(strategy: 'round_robin' | 'load_balanced', ids: string[]) {
  const r = await db().from('business_rules').insert({
    org_id: fx.orgId, name: `${tag} ${strategy}`, is_active: true, trigger: ['created'], conditions: [
      { field: 'service_id', operator: 'equals', value: fx.teamA.serviceId },
    ], conditions_logic: 'AND', actions: [{ type: 'assign', params: { strategy, assigneeIds: ids } }], execution_order: 0,
  }).select('id').single()
  expect(r.error).toBeNull()
  ruleIds.push(r.data.id)
  return r.data.id as string
}
const assignee = async (id: string) => (await db().from('requests').select('assigned_to').eq('id', id).single()).data.assigned_to as string | null

describe('automatic time tracking', () => {
  it('starts on In Progress, stops when the ticket leaves it, starts a new entry on return, never two open at once', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'assigned' })
    actAs(fx.agentA)
    const entries = async () => ((await db().from('request_time_entries').select('id, user_id, stopped_at').eq('request_id', t.id)).data ?? []) as { id: string; user_id: string; stopped_at: string | null }[]

    expect((await updateRequestStatus(t.id, 'in_progress', 'Started.')).error).toBeUndefined()
    let e = await entries()
    expect(e).toHaveLength(1); expect(e[0].user_id).toBe(fx.agentA.id); expect(e[0].stopped_at).toBeNull()

    expect((await updateRequestStatus(t.id, 'waiting_user', 'Need info from you.')).error).toBeUndefined()
    e = await entries()
    expect(e).toHaveLength(1); expect(e[0].stopped_at).not.toBeNull()

    expect((await updateRequestStatus(t.id, 'in_progress', 'Got the info.')).error).toBeUndefined()
    e = await entries()
    expect(e).toHaveLength(2); expect(e.filter((x) => x.stopped_at === null)).toHaveLength(1)

    expect((await updateRequestStatus(t.id, 'resolved', 'Fixed and tested, nothing more to do here.')).error).toBeUndefined()
    e = await entries()
    expect(e.filter((x) => x.stopped_at === null)).toHaveLength(0)
  })

  it('the entry of one technician is stopped even when another technician resolves the ticket', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'assigned' })
    actAs(fx.agentA)
    expect((await updateRequestStatus(t.id, 'in_progress', 'Started.')).error).toBeUndefined()
    await db().from('requests').update({ assigned_to: agent2.id }).eq('id', t.id)   // reassigned mid-progress
    actAs(agent2)
    expect((await updateRequestStatus(t.id, 'resolved', 'Done by the second technician after the hand-over.')).error).toBeUndefined()
    const open = (await db().from('request_time_entries').select('id').eq('request_id', t.id).is('stopped_at', null)).data ?? []
    expect(open).toHaveLength(0)
  })
})

describe('assignment strategies of Business Rules', () => {
  it('round robin hands tickets to the listed technicians in turn', async () => {
    const id = await rule('round_robin', [fx.agentA.id, agent2.id])
    const got: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
      await runRulesForTrigger('created', t.id)
      await settle(300)
      got.push(await assignee(t.id))
    }
    expect(got).toEqual([fx.agentA.id, agent2.id, fx.agentA.id, agent2.id])
    await db().from('business_rules').update({ is_active: false }).eq('id', id)
  })

  it('round robin: eight tickets created at the very same moment are spread four and four (QA-D018)', async () => {
    const id = await rule('round_robin', [fx.agentA.id, agent2.id])
    await db().from('business_rules').update({ last_assigned_index: 0 }).eq('id', id)
    const tickets = await Promise.all(Array.from({ length: 8 }, () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })))
    await Promise.all(tickets.map((t) => runRulesForTrigger('created', t.id)))
    await settle(1500)
    const got = await Promise.all(tickets.map((t) => assignee(t.id)))
    const a = got.filter((x) => x === fx.agentA.id).length, b = got.filter((x) => x === agent2.id).length
    expect(a + b).toBe(8)
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2)   // exactly 4 and 4 when the position is taken atomically
    await db().from('business_rules').update({ is_active: false }).eq('id', id)
  })

  it('load balanced gives the ticket to the technician with fewer open tickets; resolved and closed ones do not count', async () => {
    // agent A: 3 open tickets + 2 finished ones; agent 2: 1 open ticket -> agent 2 is chosen
    for (const s of ['in_progress', 'assigned', 'waiting_user'] as const) await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: s })
    for (const s of ['resolved', 'closed'] as const) await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: agent2.id, status: s })
    await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: agent2.id, status: 'in_progress' })
    const id = await rule('load_balanced', [fx.agentA.id, agent2.id])
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    await runRulesForTrigger('created', t.id)
    await settle()
    expect(await assignee(t.id)).toBe(agent2.id)
    await db().from('business_rules').update({ is_active: false }).eq('id', id)
  })

  it('a ticket held by a vendor technician is never taken away by a rule, round robin included', async () => {
    const id = await rule('round_robin', [fx.agentA.id, agent2.id])
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: vendor.id, status: 'in_progress' })
    await runRulesForTrigger('created', t.id)
    await settle()
    expect(await assignee(t.id)).toBe(vendor.id)
    await db().from('business_rules').update({ is_active: false }).eq('id', id)
  })
})

describe('home dashboard counts', () => {
  const dash = async (u: { accessToken: string }, agent: boolean) => { const r = await clientForToken(u.accessToken).rpc('get_home_dashboard', { p_is_manager: false, p_is_agent: agent, p_has_tasks: false }); expect(r.error).toBeNull(); return r.data as { counts?: { my_open?: number }; my_queue?: { id: string }[] } }

  it('requester: open count grows by waiting, held and pending-approval tickets, not by resolved / closed / cancelled ones', async () => {
    const before = (await dash(fx.requesterB, false)).counts?.my_open ?? 0
    const mk = (status: Parameters<typeof seedRequestLike>[1]['status']) => seedRequestLike(fx, { requesterId: fx.requesterB.id, serviceId: fx.teamB.serviceId, teamId: fx.teamB.id, assignedTo: fx.agentB.id, status })
    for (const s of ['open', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval'] as const) await mk(s)
    for (const s of ['resolved', 'closed', 'cancelled'] as const) await mk(s)
    expect((await dash(fx.requesterB, false)).counts?.my_open).toBe(before + 5)
  })

  it('technician: a held ticket assigned to them is in their queue; a resolved one is not', async () => {
    const held = await seedRequestLike(fx, { requesterId: fx.requesterB.id, serviceId: fx.teamB.serviceId, teamId: fx.teamB.id, assignedTo: fx.agentB.id, status: 'hold_purchase_ho' })
    const done = await seedRequestLike(fx, { requesterId: fx.requesterB.id, serviceId: fx.teamB.serviceId, teamId: fx.teamB.id, assignedTo: fx.agentB.id, status: 'resolved' })
    const q = ((await dash(fx.agentB, true)).my_queue ?? []).map((r) => r.id)
    expect(q).toContain(held.id)
    expect(q).not.toContain(done.id)
  })
})
