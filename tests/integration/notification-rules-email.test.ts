/**
 * Request Configuration > Notification Rules: the Email tick must decide whether an email goes out,
 * and when it does, the email must reach the person with a working (absolute) link.
 * Real database, real rules table; only the mail transport is replaced.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

const sent: { to: string; subject: string; html: string }[] = []
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string }) => { sent.push(p); return {} }),
}))

import { notify } from '@/lib/notifications'

async function waitFor(cond: () => boolean, ms = 4000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50))
}

describe('notification rules gate the email channel', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => {
    await admin.from('notification_rules').delete().eq('org_id', fx.orgId).in('event_type', ['comment_added', 'request_resolved'])
    await fx?.cleanup()
  }, 90_000)
  beforeEach(() => { sent.length = 0 })

  const input = (type: 'comment_added' | 'request_resolved') => ({
    recipientId: fx.requesterA.id, actorId: fx.agentA.id, type, title: 'Printer jam', body: 'Fixed it', link: '/requests/xyz',
  })

  it('with no saved rule, email is on by default and the link is a full address', async () => {
    await admin.from('notification_rules').delete().eq('org_id', fx.orgId).eq('event_type', 'comment_added')
    await notify(input('comment_added'))
    await waitFor(() => sent.length > 0)
    expect(sent).toHaveLength(1)
    expect(sent[0].to.toLowerCase()).toBe(fx.requesterA.email.toLowerCase())
    expect(sent[0].html).toContain('http://app.test/requests/xyz')
  })

  it('email unticked: no email, but the in-app notification still arrives', async () => {
    await admin.from('notification_rules').upsert({ org_id: fx.orgId, event_type: 'comment_added', email: false, in_app: true, push: false })
    await notify(input('comment_added'))
    await new Promise((r) => setTimeout(r, 800))
    expect(sent).toHaveLength(0)
    const { data } = await admin.from('notifications').select('id').eq('user_id', fx.requesterA.id).eq('type', 'comment_added').eq('title', 'Printer jam')
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('an event that used to have no email template (resolved) now emails when ticked', async () => {
    await admin.from('notification_rules').upsert({ org_id: fx.orgId, event_type: 'request_resolved', email: true, in_app: true, push: false })
    await notify(input('request_resolved'))
    await waitFor(() => sent.length > 0)
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toMatch(/resolved/i)
  })
})
