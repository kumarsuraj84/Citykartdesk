/**
 * DESK-BUG — live report: after a "created + updated" assign rule puts a technician on a
 * ticket, clicking Start Working (an 'updated'-trigger event) re-ran the SAME rule and
 * emailed the requester "assigned to <tech>" a second time for no actual change. Separately,
 * the "your request is in progress" email always rendered its status as blank.
 * Against the real database and business-rule engine; only the mail transport is replaced.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string }) => { sent.push(p); return {} }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'
import { runRulesForTrigger } from '@/lib/rules/run'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) { mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never) }

async function waitFor(cond: () => boolean, ms = 4000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50))
}

describe('assign-rule re-firing + status email content', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  let ruleId = ''
  let requestId = ''

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()

    // A "direct assign to agentA" rule that fires on BOTH created and updated — the exact
    // shape of the live rules (e.g. "IT TICKET RULE_AJAY": trigger {created,updated}).
    const { data: rule } = await admin.from('business_rules').insert({
      org_id: fx.orgId, name: `test-assign-${Date.now()}`, is_active: true,
      trigger: ['created', 'updated'], conditions: [], conditions_logic: 'AND',
      actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }],
      execution_order: 0,
    }).select('id').single()
    ruleId = rule!.id

    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    requestId = req.id
  }, 90_000)

  afterAll(async () => {
    await admin.from('business_rules').delete().eq('id', ruleId)
    await fx?.cleanup()
  }, 90_000)

  beforeEach(() => { sent.length = 0 })

  it('creation: the rule assigns the requester and technician get their emails (once each)', async () => {
    await runRulesForTrigger('created', requestId)
    await waitFor(() => sent.length >= 2)
    const { data } = await admin.from('requests').select('assigned_to').eq('id', requestId).single()
    expect(data!.assigned_to).toBe(fx.agentA.id)
    expect(sent.filter((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())).toHaveLength(1)
    expect(sent.filter((e) => e.to.toLowerCase() === fx.agentA.email.toLowerCase())).toHaveLength(1)
  })

  it('Start Working (assigned -> in_progress) re-runs the same rule but sends NO second "assigned" email — the reported bug', async () => {
    sent.length = 0
    actAs(fx.agentA)
    const res = await updateRequestStatus(requestId, 'in_progress', 'Looking into it now.')
    expect(res.error).toBeUndefined()
    await new Promise((r) => setTimeout(r, 800)) // let the fire-and-forget business-rule re-run + emails settle

    const { data } = await admin.from('requests').select('assigned_to').eq('id', requestId).single()
    expect(data!.assigned_to).toBe(fx.agentA.id) // still the same technician, no reassignment

    const toRequester = sent.filter((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())
    expect(toRequester.filter((e) => /assign/i.test(e.subject) || /assign/i.test(e.html))).toHaveLength(0)
  })

  it('the "in progress" email to the requester shows the real status, not blank — the second reported bug', async () => {
    // Give the ticket a fresh assignee-less/open->assigned setup for a clean single transition.
    const req2 = await seedRequestLike(fx, { requesterId: fx.requesterB.id, serviceId: fx.teamB.serviceId, teamId: fx.teamB.id, assignedTo: fx.agentB.id, status: 'assigned' })
    sent.length = 0
    actAs(fx.agentB)
    const res = await updateRequestStatus(req2.id, 'in_progress', 'Looking into it now.')
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.some((e) => e.to.toLowerCase() === fx.requesterB.email.toLowerCase()))

    const mail = sent.find((e) => e.to.toLowerCase() === fx.requesterB.email.toLowerCase())!
    expect(mail.html).not.toMatch(/changed from\s*<\/strong> to\s*<\/strong>|from\s+to\s/i)
    expect(mail.html).toMatch(/in progress/i)
  })
})

describe('waiting_user transition: the technician\'s comment reaches the requester\'s email', () => {
  let fx: D03Fixtures
  beforeAll(async () => { fx = await setupD03Fixtures() }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0 })

  it('shows the comment the technician typed when moving to Waiting for User', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(fx.agentA)
    const res = await updateRequestStatus(req.id, 'waiting_user', 'Please share a screenshot of the exact error.')
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.some((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase()))

    const mail = sent.find((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())!
    expect(mail.html).toContain('Please share a screenshot of the exact error.')
    expect(mail.html).toMatch(/waiting on user/i)
  })
})

describe('resolve transition: the technician\'s comment reaches the requester\'s email', () => {
  let fx: D03Fixtures
  beforeAll(async () => { fx = await setupD03Fixtures() }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0 })

  it('shows the comment the technician typed when resolving', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(fx.agentA)
    const res = await updateRequestStatus(req.id, 'resolved', 'Replaced the toner cartridge and ran a test print — confirmed working.')
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.some((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase()))

    const mail = sent.find((e) => e.to.toLowerCase() === fx.requesterA.email.toLowerCase())!
    expect(mail.html).toContain('Replaced the toner cartridge and ran a test print — confirmed working.')
    expect(mail.html).toMatch(/resolved/i)
  })
})
