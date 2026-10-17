// Remediation phase 3A: the Low findings around tickets and the database.
// VAPT-054 duplicate request, 055/056 re-classification, 058 status races, 059 raw errors, 062 home dashboard, 063 activity log, 064 function grants.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'
import { http } from '../remediation/helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { duplicateRequest, updateRequestCategory } from '@/lib/actions/requests'
import { sendAdHocApproval, approveApproval } from '@/lib/actions/approvals'
import { getRequestActivity } from '@/lib/queries/requests'
import { publicActivityMetadata } from '@/lib/activity-public'
import { sanitizeError } from '@/lib/observability/sanitize-error'

vi.setConfig({ testTimeout: 120_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const newTicket = (status = 'in_progress' as string) => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: status as never })

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => { await fx?.cleanup() }, 120_000)

describe('VAPT-054: a copy of a ticket is a new ticket, made through the normal creation path', () => {
  it('priority and deadlines are worked out again, not copied; the original priority is not carried over', async () => {
    const t = await newTicket('open')
    await admin().from('requests').update({ priority: 'urgent' as never }).eq('id', t.id)
    actAs(fx.requesterA)
    const r = await duplicateRequest(t.id)
    expect(r.error).toBeUndefined()
    const copy = (await admin().from('requests').select('*').eq('id', r.id!).single()).data!
    expect(copy.requester_id).toBe(fx.requesterA.id)
    expect(copy.status).toBe('open')
    expect(copy.assigned_to).toBeNull()
    expect(copy.title.endsWith('(copy)')).toBe(true)
    // the same priority a brand-new ticket for this service would get; here the original was changed to urgent by hand and the copy is not
    expect(copy.priority).not.toBe('urgent')
    expect((copy.source_metadata as { duplicated_from?: string } | null)?.duplicated_from).toBe(t.id)
  })
  it('a service that is no longer available cannot be copied into, and somebody else\'s ticket cannot be copied', async () => {
    const t = await newTicket('open')
    actAs(fx.requesterB)
    expect((await duplicateRequest(t.id)).error).toBeTruthy()                        // cannot see it
    await admin().from('services').update({ is_active: false }).eq('id', fx.teamA.serviceId)
    try {
      actAs(fx.requesterA)
      expect((await duplicateRequest(t.id)).error).toBeTruthy()                     // the service is switched off
    } finally {
      await admin().from('services').update({ is_active: true }).eq('id', fx.teamA.serviceId)
    }
  })
})

describe('VAPT-055 / 056: re-classification', () => {
  it('a finished ticket is not re-classified', async () => {
    for (const status of ['resolved', 'closed', 'cancelled']) {
      const t = await newTicket(status)
      actAs(fx.agentA)
      const r = await updateRequestCategory(t.id, "00000000-0000-0000-0000-0000000000aa", "testing the finished-ticket rule")
      expect(r.error, status).toMatch(/cannot be re-classified/)
    }
  })
  it('a requester cannot re-classify at all (the original rule)', async () => {
    const t = await newTicket('open')
    actAs(fx.requesterA)
    expect((await updateRequestCategory(t.id, "00000000-0000-0000-0000-0000000000aa", "testing the finished-ticket rule")).error).toBeTruthy()
  })
})

describe('VAPT-058: a decision does not drag a ticket back to life', () => {
  it('when the ticket was closed meanwhile, an approval granted afterwards leaves it closed', async () => {
    const t = await newTicket('in_progress')
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()
    // somebody (a rule, another technician) closes it while the approval is still waiting
    await admin().from('requests').update({ status: 'closed' as never }).eq('id', t.id)
    actAs(fx.manager)
    const a = (await admin().from('approvals').select('id').eq('request_id', t.id).eq('status', 'pending').single()).data!
    await approveApproval(a.id, 'ok')
    expect((await admin().from('requests').select('status').eq('id', t.id).single()).data!.status).toBe('closed')
  })
  it('a second decision on an approval that is already decided is refused and not recorded', async () => {
    const t = await newTicket('in_progress')
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.manager.id, fx.admin.id])).error).toBeUndefined()
    const a = (await admin().from('approvals').select('id').eq('request_id', t.id).eq('status', 'pending').single()).data!
    actAs(fx.manager)
    expect((await approveApproval(a.id, 'first')).error).toBeUndefined()
    const before = (await admin().from('approval_decisions').select('id').eq('approval_id', a.id)).data!.length
    actAs(fx.admin)
    await approveApproval(a.id, 'too late')
    expect((await admin().from('approval_decisions').select('id').eq('approval_id', a.id)).data!.length).toBe(before)
  })
})

describe('VAPT-059: database error text does not reach the browser', () => {
  it('sanitizeError hides table and constraint names', () => {
    const msg = sanitizeError({ code: '23505', message: 'duplicate key value violates unique constraint "services_name_key"' }, { route: 'test' })
    expect(msg).not.toMatch(/services_name_key|constraint/i)
    expect(sanitizeError({ message: 'relation "profiles" does not exist' }, { route: 'test' })).not.toMatch(/profiles/)
  })
})

describe('VAPT-062: the home dashboard works out the role itself', () => {
  const dash = (token: string, body: object) => http<{ counts?: Record<string, number> }>('POST', '/rest/v1/rpc/get_home_dashboard', { token, body })
  it('a requester who claims to be a manager and an agent gets the requester\'s view only', async () => {
    const r = await dash(fx.requesterA.accessToken, { p_is_manager: true, p_is_agent: true, p_has_tasks: true })
    expect(r.status).toBe(200)
    expect(r.json.counts?.team_open).toBe(0)
    expect(r.json.counts?.sla_breached).toBe(0)
    expect(r.json.counts?.tasks_open).toBe(0)
    expect(r.json.counts?.pending_approvals).toBe(0)
  })
  it('a real technician still gets the technician\'s numbers; a real manager still gets the team numbers', async () => {
    await newTicket('in_progress')
    const agent = await dash(fx.agentA.accessToken, { p_is_manager: false, p_is_agent: true, p_has_tasks: true })
    expect(agent.status).toBe(200)
    expect(agent.json.counts).toBeDefined()
    const manager = await dash(fx.manager.accessToken, { p_is_manager: true, p_is_agent: true, p_has_tasks: true })
    expect(manager.json.counts?.team_open).toBeGreaterThan(0)
  })
  it('nobody signed out can call it, and the inner function is not reachable at all', async () => {
    expect((await http('POST', '/rest/v1/rpc/get_home_dashboard', { body: { p_is_manager: true } })).status).toBeGreaterThanOrEqual(400)
    expect((await dash(fx.admin.accessToken, {})).status).toBe(200)
    const inner = await http('POST', '/rest/v1/rpc/get_home_dashboard_core', { token: fx.admin.accessToken, body: { p_is_manager: true, p_is_agent: true } })
    expect(inner.status).toBeGreaterThanOrEqual(400)
  })
})

describe('VAPT-063: the activity log', () => {
  it('a requester cannot read it through the data API; staff can', async () => {
    const t = await newTicket('open')
    await admin().from('request_activity').insert({ request_id: t.id, actor_id: fx.agentA.id, action: 'comment_added', metadata: { cc: [{ email: 'oem-contact@vendor.example', name: 'OEM Contact' }] } })
    await admin().from('request_activity').insert({ request_id: t.id, actor_id: null, action: 'priority_changed', metadata: { priority_from: 'low', priority_to: 'high', via: 'business_rule', rule_id: 'r1', rule_name: 'Secret rule name' } })
    const asRequester = await http<unknown[]>('GET', `/rest/v1/request_activity?request_id=eq.${t.id}&select=*`, { token: fx.requesterA.accessToken })
    expect(asRequester.status).toBe(200)
    expect(asRequester.json).toEqual([])
    const asAgent = await http<unknown[]>('GET', `/rest/v1/request_activity?request_id=eq.${t.id}&select=*`, { token: fx.agentA.accessToken })
    expect((asAgent.json as unknown[]).length).toBeGreaterThanOrEqual(2)
  })
  it('the ticket page still shows the requester their history, without rule names or e-mail addresses', async () => {
    const t = await newTicket('open')
    await admin().from('request_activity').insert({ request_id: t.id, actor_id: fx.agentA.id, action: 'comment_added', metadata: { cc: [{ email: 'oem-contact@vendor.example', name: 'OEM Contact' }] } })
    await admin().from('request_activity').insert({ request_id: t.id, actor_id: null, action: 'priority_changed', metadata: { priority_from: 'low', priority_to: 'high', via: 'business_rule', rule_id: 'r1', rule_name: 'Secret rule name' } })
    actAs(fx.requesterA)
    const rows = await getRequestActivity(t.id)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    const text = JSON.stringify(rows.map((r) => r.metadata))
    expect(text).not.toMatch(/oem-contact@vendor\.example|Secret rule name|rule_id|rule_name/)
    expect(text).toMatch(/OEM Contact/)                                          // the name the History tab shows is kept
    expect(text).toMatch(/"priority_to":"high"/)
    actAs(fx.requesterB)
    expect(await getRequestActivity(t.id)).toEqual([])                           // somebody else's ticket
    actAs(fx.agentA)
    expect(JSON.stringify((await getRequestActivity(t.id)).map((r) => r.metadata))).toMatch(/oem-contact@vendor\.example/)   // staff see everything
  })
  it('the allow-list keeps only what the History tab shows', () => {
    expect(publicActivityMetadata({ from: 'open', to: 'closed', via: 'email', rule_name: 'x', delegated_to: 'u' })).toEqual({ from: 'open', to: 'closed' })
    expect(publicActivityMetadata(null)).toBeNull()
    expect(publicActivityMetadata({ rule_id: 'x' })).toBeNull()
  })
})

describe('VAPT-064: functions are not public by default', () => {
  it('the anonymous role cannot call the application\'s own functions', async () => {
    for (const fn of ['current_user_role', 'current_org_id', 'is_agent', 'can_view_project', 'get_enabled_modules']) {
      const r = await http('POST', `/rest/v1/rpc/${fn}`, { body: {} })
      expect(r.status, fn).toBeGreaterThanOrEqual(400)
    }
  })
  it('signed-in users still can (row-security policies depend on it)', async () => {
    const r = await http<string>('POST', '/rest/v1/rpc/current_user_role', { token: fx.agentA.accessToken, body: {} })
    expect(r.status).toBe(200)
  })
})
