/**
 * Every ticket e-mail names the Requester and the Technician, with "(you)" on the reader's own name and a role next to whoever did something.
 * Real database and the real notification path (lib/notifications.ts loads the names); only the mail transport is replaced.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string; text: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string; text: string }) => { sent.push(p); return {} }),
}))

import { notify } from '@/lib/notifications'

async function waitFor(cond: () => boolean, ms = 5000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50))
}

describe('ticket e-mails name the requester and the technician', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  let requesterName = '', agentName = '', managerName = '', unassignedRequestId = ''

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
    const { data } = await admin.from('profiles').select('id, full_name').in('id', [fx.requesterA.id, fx.agentA.id, fx.manager.id])
    const name = (id: string) => (data ?? []).find((p) => p.id === id)?.full_name ?? ''
    requesterName = name(fx.requesterA.id); agentName = name(fx.agentA.id); managerName = name(fx.manager.id)
    const unassigned = await seedRequestLike(fx, { requesterId: fx.requesterA.id, teamId: fx.teamA.id, serviceId: fx.teamA.serviceId, assignedTo: null })
    unassignedRequestId = unassigned.id
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0 })

  const send = async (recipientId: string, actorId: string | null, requestId: string, type: 'comment_added' | 'request_resolved' | 'sla_warning' = 'comment_added') => {
    sent.length = 0
    await notify({ recipientId, actorId, type, title: 'New message', body: 'hello', requestId, link: `/requests/${requestId}`, metadata: type === 'comment_added' ? { commenterName: 'Someone', commentBody: 'hello' } : {} })
    await waitFor(() => sent.length > 0)
    expect(sent).toHaveLength(1)
    return sent[0]
  }

  it('the requester sees the technician; their own name has "(you)"; the technician who wrote has the role "Technician"', async () => {
    const m = await send(fx.requesterA.id, fx.agentA.id, fx.requestA.id)
    expect(m.html).toContain(`${requesterName} (you)`)
    expect(m.html).toContain(agentName)
    expect(m.html).not.toContain(`${agentName} (you)`)
    expect(m.text).toContain(`Requester: ${requesterName} (you)`)
    expect(m.text).toContain(`Technician: ${agentName}`)
  })

  it('the technician sees the requester; their own name has "(you)"', async () => {
    const m = await send(fx.agentA.id, fx.requesterA.id, fx.requestA.id)
    expect(m.html).toContain(`${agentName} (you)`)
    expect(m.html).toContain(requesterName)
    expect(m.html).not.toContain(`${requesterName} (you)`)
    expect(m.text).toContain(`Requester: ${requesterName}`)
    expect(m.text).toContain(`Technician: ${agentName} (you)`)
  })

  it('a manager who is neither of them sees both names without "(you)"', async () => {
    const m = await send(fx.manager.id, fx.agentA.id, fx.requestA.id, 'sla_warning')
    expect(m.html).toContain(requesterName)
    expect(m.html).toContain(agentName)
    expect(m.html).not.toContain('(you)')
    expect(managerName).not.toBe('')
  })

  it('a ticket nobody has picked up yet says "Not assigned yet"', async () => {
    const m = await send(fx.requesterA.id, null, unassignedRequestId, 'request_resolved')
    expect(m.html).toContain('Not assigned yet')
    expect(m.text).toContain('Technician: Not assigned yet')
  })

  it('the subject is the same as before (ticket number and title)', async () => {
    const m = await send(fx.requesterA.id, fx.agentA.id, fx.requestA.id)
    expect(m.subject).toMatch(/^New comment on: /)
  })
})
