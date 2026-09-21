/**
 * The requester hears about their own ticket: "logged" (with the ticket number) and "assigned to <technician>",
 * and the technician gets their own assignment email — all subject to Notification Rules.
 * Real database; only the mail transport is replaced.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string }) => { sent.push(p); return {} }),
}))

import { notify } from '@/lib/notifications'
import { notifyRequesterTicketLogged, notifyRequesterOfAssignment } from '@/lib/requests/notify-requester'

async function waitFor(cond: () => boolean, ms = 4000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50))
}

describe('requester + technician notification emails', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  let requestNo = ''
  let title = ''

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
    const { data } = await admin.from('requests').select('request_no, title').eq('id', fx.requestA.id).single()
    requestNo = data!.request_no as string
    title = data!.title as string
    await admin.from('notification_rules').delete().eq('org_id', fx.orgId)
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0 })

  it('"logged": the requester gets an email with the ticket number and a working link', async () => {
    await notifyRequesterTicketLogged({ requesterId: fx.requesterA.id, actorId: fx.requesterA.id, requestId: fx.requestA.id, requestNo, title, serviceName: 'IT' })
    await waitFor(() => sent.length > 0)
    expect(sent).toHaveLength(1)
    expect(sent[0].to.toLowerCase()).toBe(fx.requesterA.email.toLowerCase())
    expect(sent[0].subject).toContain(requestNo)
    expect(sent[0].html).toContain(`http://app.test/requests/${fx.requestA.id}`)
  })

  it('"assigned": the requester is told who has their ticket', async () => {
    await notifyRequesterOfAssignment({ requestId: fx.requestA.id, assigneeId: fx.agentA.id, actorId: fx.agentA.id })
    await waitFor(() => sent.length > 0)
    expect(sent).toHaveLength(1)
    expect(sent[0].to.toLowerCase()).toBe(fx.requesterA.email.toLowerCase())
    expect(sent[0].html).toMatch(/is now handling your request/)
    expect(sent[0].subject).toContain(requestNo)
  })

  it('technician: gets "assigned to you" with the real ticket title (not the notification sentence)', async () => {
    await notify({ recipientId: fx.agentA.id, actorId: fx.agentA.id, type: 'request_assigned', title: 'Request assigned to you', body: title, requestId: fx.requestA.id, link: `/requests/${fx.requestA.id}` })
    await waitFor(() => sent.length > 0)
    expect(sent).toHaveLength(1)
    expect(sent[0].to.toLowerCase()).toBe(fx.agentA.email.toLowerCase())
    expect(sent[0].subject).toContain(title)
    expect(sent[0].subject).toContain(requestNo)
  })

  it('does not tell a requester they were assigned their own ticket', async () => {
    await notifyRequesterOfAssignment({ requestId: fx.requestA.id, assigneeId: fx.requesterA.id, actorId: fx.agentA.id })
    await new Promise((r) => setTimeout(r, 600))
    expect(sent).toHaveLength(0)
  })

  it('the requester copy respects Notification Rules (Email unticked for "Ticket assigned")', async () => {
    await admin.from('notification_rules').upsert({ org_id: fx.orgId, event_type: 'request_assigned', email: false, in_app: true, push: false })
    await notifyRequesterOfAssignment({ requestId: fx.requestA.id, assigneeId: fx.agentA.id, actorId: fx.agentA.id })
    await new Promise((r) => setTimeout(r, 800))
    expect(sent).toHaveLength(0)
    await admin.from('notification_rules').delete().eq('org_id', fx.orgId).eq('event_type', 'request_assigned')
  })
})
