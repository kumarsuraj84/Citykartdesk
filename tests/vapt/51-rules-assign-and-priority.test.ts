// Business Rules against the isolated audit stack (NOT run by the author of the change; the lead runs it):
//  - B-31: a rule that gives an open ticket to somebody moves it to "assigned";
//  - B-02: an "edited" assign rule does not take a ticket back from the person a manager gave it to (a re-classification may);
//  - B-19: a candidate who is not on the ticket's team is skipped, the next valid one is used;
//  - B-30 / B-01: a rule that sets the priority a ticket already has changes nothing, and a priority change that cannot work out a deadline keeps the existing deadline.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { runRulesForTrigger } from '@/lib/rules/run'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t51${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const made: string[] = []
const ruleIds: string[] = []

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => {
  if (ruleIds.length) await db().from('business_rules').delete().in('id', ruleIds)
  if (made.length) {
    await db().from('request_activity').delete().in('request_id', made)
    await db().from('requests').delete().in('id', made)
  }
  await fx?.cleanup()
}, 180_000)

async function ticket(marker: string, extra: Record<string, unknown> = {}) {
  const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: null, status: 'open' })
  made.push(t.id)
  await db().from('requests').update({ title: `${tag} ${marker}`, ...extra }).eq('id', t.id)
  return t.id as string
}
async function rule(marker: string, trigger: string[], actions: unknown[]) {
  const r = (await db().from('business_rules').insert({
    org_id: fx.orgId, name: `${tag} ${marker}`, trigger, is_active: true, execution_order: 9400,
    conditions: [{ field: 'title', operator: 'contains', value: `${tag} ${marker}` }], actions,
  }).select('id').single()).data
  ruleIds.push(r.id)
  return r.id as string
}
const row = async (id: string) => (await db().from('requests').select('status, assigned_to, priority, resolution_due_at, response_due_at').eq('id', id).single()).data as { status: string; assigned_to: string | null; priority: string; resolution_due_at: string | null; response_due_at: string | null }

describe('assign rules', () => {
  it('B-31 (owner decision pending): creation rule - the open ticket gets its technician and stays "open", as on the live system', async () => {
    await rule('assign-open', ['created', 'updated'], [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }])
    const id = await ticket('assign-open')
    await runRulesForTrigger('created', id)
    expect(await row(id)).toMatchObject({ status: 'open', assigned_to: fx.agentA.id })
  })

  it('B-02: an edit does not undo a manager\'s choice; a re-classification (allowReassign) may', async () => {
    await rule('keep-manager', ['created', 'updated'], [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }])
    const id = await ticket('keep-manager', { assigned_to: fx.manager.id, status: 'assigned' })
    await runRulesForTrigger('updated', id)
    expect((await row(id)).assigned_to).toBe(fx.manager.id)
    await runRulesForTrigger('updated', id, { allowReassign: true })
    expect((await row(id)).assigned_to).toBe(fx.agentA.id)
  })

  it('B-19: the first candidate is not on the ticket\'s team, so the next valid one is used', async () => {
    await rule('skip-invalid', ['created'], [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentB.id, fx.agentA.id] } }])
    const id = await ticket('skip-invalid')
    await runRulesForTrigger('created', id)
    expect((await row(id)).assigned_to).toBe(fx.agentA.id)
  })
})

describe('priority rules', () => {
  it('B-30: the same priority again changes nothing and logs nothing', async () => {
    await rule('same-priority', ['created', 'updated'], [{ type: 'set_priority', params: { priority: 'high' } }])
    const id = await ticket('same-priority', { priority: 'high' })
    await runRulesForTrigger('updated', id)
    const log = (await db().from('request_activity').select('id').eq('request_id', id).eq('action', 'priority_changed')).data
    expect(log).toHaveLength(0)
  })

  it('B-01: a new priority whose deadline cannot be worked out (the service has no SLA) keeps the deadline the ticket has', async () => {
    await rule('keep-deadline', ['created', 'updated'], [{ type: 'set_priority', params: { priority: 'urgent' } }])
    const due = new Date(Date.now() + 10 * 3_600_000).toISOString()
    const id = await ticket('keep-deadline', { priority: 'low', resolution_due_at: due, response_due_at: due })
    await runRulesForTrigger('updated', id)
    const r = await row(id)
    expect(r.priority).toBe('urgent')
    expect(new Date(r.resolution_due_at!).toISOString()).toBe(new Date(due).toISOString())
    expect(new Date(r.response_due_at!).toISOString()).toBe(new Date(due).toISOString())
  })
})
