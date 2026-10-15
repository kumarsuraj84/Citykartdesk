// D-044: status, SLA and assignment bookkeeping that used to go wrong when two things touched a ticket together, or touched a finished one.
//  * a business rule that moves a ticket only does so while the ticket is still in the status the rule read, and several status actions in one rule chain correctly;
//  * moving a ticket out of "Hold due to Purchase from HO" by a rule credits the paused time exactly like moving it out of "Waiting on User";
//  * changing the priority of a finished ticket leaves its deadlines alone (rule and manual change alike);
//  * the requester's reply resumes a Waiting-on-User ticket but never a ticket on Hold.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { runRulesForTrigger } from '@/lib/rules/run'
import { addComment } from '@/lib/actions/requests'

vi.setConfig({ testTimeout: 120_000 })

const HOUR = 3_600_000
let fx: D03Fixtures
const db = getAdmin()
const tag = `d44-${Date.now()}`
const cleanup: { requests: string[]; rules: string[] } = { requests: [], rules: [] }

async function ticket(over: Record<string, unknown> = {}) {
  const r = await db.from('requests').insert({ request_no: '', title: `${tag} ${cleanup.requests.length}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, org_id: fx.orgId, priority: 'low', status: 'open', ...over }).select('id').single()
  if (r.error) throw new Error('ticket: ' + r.error.message)
  cleanup.requests.push(r.data!.id)
  return r.data!.id as string
}
async function rule(actions: unknown[], titleHas: string) {
  const r = await db.from('business_rules').insert({ org_id: fx.orgId, name: `${tag} rule`, is_active: true, trigger: ['updated'], conditions: [{ field: 'title', operator: 'contains', value: titleHas }], conditions_logic: 'AND', actions: actions as never, execution_order: 998 }).select('id').single()
  if (r.error) throw new Error('rule: ' + r.error.message)
  cleanup.rules.push(r.data!.id)
  return r.data!.id as string
}
const row = async (id: string) => (await db.from('requests').select('status, priority, waiting_since, paused_ms_total, resolution_due_at, response_due_at').eq('id', id).single()).data!
const removeRules = async () => { if (cleanup.rules.length) { await db.from('business_rule_events').delete().in('rule_id', cleanup.rules); await db.from('business_rules').delete().in('id', cleanup.rules); cleanup.rules.length = 0 } }

beforeAll(async () => { fx = await setupD03Fixtures() }, 120_000)
afterAll(async () => {
  await removeRules()
  if (cleanup.requests.length) { await db.from('request_activity').delete().in('request_id', cleanup.requests); await db.from('request_comments').delete().in('request_id', cleanup.requests); await db.from('requests').delete().in('id', cleanup.requests) }
  await fx?.cleanup()
}, 120_000)

describe('business rules and status (D-044)', () => {
  it('two status actions in one rule are both applied in order', async () => {
    const t = await ticket()
    await rule([{ type: 'set_status', params: { status: 'in_progress' } }, { type: 'set_status', params: { status: 'resolved' } }], `${tag} 0`)
    await runRulesForTrigger('updated', t)
    expect((await row(t)).status).toBe('resolved')
    const acts = (await db.from('request_activity').select('metadata').eq('request_id', t).eq('action', 'status_changed')).data ?? []
    expect(acts.filter((a) => (a.metadata as { via?: string })?.via === 'business_rule')).toHaveLength(2)
    await removeRules()
  })

  it('moving a ticket off Hold credits the paused time, like moving it off Waiting on User', async () => {
    const due = new Date(Date.now() + 48 * HOUR).toISOString()
    const since = new Date(Date.now() - 2 * HOUR).toISOString()
    const hold = await ticket({ status: 'hold_purchase_ho', waiting_since: since, resolution_due_at: due, response_due_at: due })
    const wait = await ticket({ status: 'waiting_user', waiting_since: since, resolution_due_at: due, response_due_at: due })
    await rule([{ type: 'set_status', params: { status: 'in_progress' } }], tag)
    await runRulesForTrigger('updated', hold)
    await runRulesForTrigger('updated', wait)
    for (const id of [hold, wait]) {
      const r = await row(id)
      expect(r.status, id).toBe('in_progress')
      expect(r.waiting_since, id).toBeNull()
      expect(Number(r.paused_ms_total), id).toBeGreaterThan(1.9 * HOUR)
      expect(new Date(r.resolution_due_at!).getTime() - new Date(due).getTime(), id).toBeGreaterThan(1.9 * HOUR)
    }
    await removeRules()
  })

  it('a rule that sets the priority of a finished ticket records it but leaves the deadlines alone', async () => {
    const due = '2026-01-01T00:00:00.000Z'
    const t = await ticket({ status: 'resolved', resolution_due_at: due, response_due_at: due })
    await rule([{ type: 'set_priority', params: { priority: 'urgent' } }], `${tag} ${cleanup.requests.length - 1}`)
    await runRulesForTrigger('updated', t)
    const r = await row(t)
    expect(r.priority).toBe('urgent')
    expect(new Date(r.resolution_due_at!).toISOString()).toBe(due)
    await removeRules()
  })
})

describe('manual changes (D-044)', () => {
  it('the requester\'s reply resumes a Waiting-on-User ticket but not one on Hold', async () => {
    const since = new Date(Date.now() - HOUR).toISOString()
    const waiting = await ticket({ status: 'waiting_user', waiting_since: since, assigned_to: fx.agentA.id })
    const onHold = await ticket({ status: 'hold_purchase_ho', waiting_since: since, assigned_to: fx.agentA.id })
    vi.mocked(createClient).mockResolvedValue(clientForToken(fx.requesterA.accessToken) as never)
    expect((await addComment(waiting, 'Here is the serial number.', false)).error).toBeUndefined()
    expect((await addComment(onHold, 'Any news?', false)).error).toBeUndefined()
    expect((await row(waiting)).status).toBe('in_progress')
    expect((await row(waiting)).waiting_since).toBeNull()
    expect((await row(onHold)).status).toBe('hold_purchase_ho')
  })
})
