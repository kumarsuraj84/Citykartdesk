// Approvals, hardened (D-029, D-030, D-060): e-mailed links expire, nobody decides a request they raised or sent, and the e-mailed code is
// random, single-use and locks after a few wrong tries. Real database and approval engine; only the mail transport and the cookie jar are replaced.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

type Sent = { to: string; subject: string; html: string; text?: string }
const sent: Sent[] = []
const jar = vi.hoisted(() => new Map<string, string>())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (p: Sent) => { sent.push(p); return {} }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn(async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: (n: string, v: string) => { jar.set(n, v) }, getAll: () => [] })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendAdHocApproval, approveApproval } from '@/lib/actions/approvals'
import { requestApprovalCode, verifyApprovalCode, decideByEmail } from '@/lib/actions/approvalEmail'
import { describeApprovalLink } from '@/lib/approvals/email-state'
import { OWN_REQUEST_MESSAGE } from '@/lib/approvals/decision'
import { LINK_EXPIRED_MESSAGE, signApprovalToken, verifyApprovalToken } from '@/lib/approvals/email-link'
import { rateLimit } from '@/lib/rate-limit'
import { createHmac } from 'node:crypto'

vi.setConfig({ testTimeout: 90_000 })

const mocked = vi.mocked(createClient)
const actAs = (u: TestUser) => mocked.mockResolvedValue(clientForToken(u.accessToken) as never)
const anonymous = () => mocked.mockResolvedValue(clientForToken('not-a-real-session') as never)
const waitFor = async (cond: () => boolean, ms = 5000) => { const s = Date.now(); while (!cond() && Date.now() - s < ms) await new Promise((r) => setTimeout(r, 50)) }
const DAY = 86_400_000
// the new table is not in the hand-maintained generated types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (c: unknown) => c as { from: (t: string) => any }

describe('approval hardening', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    process.env.CSAT_LINK_SECRET = 'approval-hardening-secret'
    fx = await setupD03Fixtures()
  }, 120_000)
  afterAll(async () => { await fx?.cleanup() }, 120_000)
  beforeEach(() => { sent.length = 0; jar.clear() })

  /** A ticket raised by `requester`, sent for approval by `sender` to the manager and the admin. */
  async function start(requester: TestUser, sender: TestUser) {
    const req = await seedRequestLike(fx, { requesterId: requester.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(sender)
    const res = await sendAdHocApproval(req.id, [fx.manager.id, fx.admin.id])
    expect(res.error).toBeUndefined()
    await waitFor(() => sent.filter((m) => /Approval required/.test(m.subject)).length >= 2)
    const { data: approval } = await admin.from('approvals').select('id').eq('request_id', req.id).single()
    const tokenFor = (u: TestUser) => /\/approve\/([A-Za-z0-9._-]+)\?do=approve/.exec(sent.find((m) => m.to.toLowerCase() === u.email.toLowerCase() && /Approval required/.test(m.subject))?.html ?? '')?.[1] ?? ''
    return { req, approvalId: approval!.id as string, manager: tokenFor(fx.manager), adminTok: tokenFor(fx.admin) }
  }
  const approvalStatus = async (id: string) => (await admin.from('approvals').select('status').eq('id', id).single()).data!.status
  const lastCode = () => /\b(\d{6})\b/.exec([...sent].reverse().find((m) => /Your Citykart Desk code/.test(m.subject))?.subject ?? '')?.[1] ?? ''
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000')

  describe('D-030 nobody decides a request they raised or sent', () => {
    it('the person who raised the request cannot approve or reject it, on the portal or from the e-mail; the other approver can', async () => {
      const { approvalId, manager } = await start(fx.manager, fx.agentA)   // the manager raised it
      actAs(fx.manager)
      expect((await approveApproval(approvalId, 'approving my own')).error).toBe(OWN_REQUEST_MESSAGE)
      expect((await decideByEmail(manager, 'approve', 'approving my own')).error).toBe(OWN_REQUEST_MESSAGE)
      expect(await approvalStatus(approvalId)).toBe('pending')
      expect((await describeApprovalLink(admin, approvalId, fx.manager.id)).kind).toBe('own_request')
      expect((await describeApprovalLink(admin, approvalId, fx.admin.id)).kind).toBe('pending')

      actAs(fx.admin)
      expect((await approveApproval(approvalId, 'fine, approved by someone else')).error).toBeUndefined()
      expect(await approvalStatus(approvalId)).toBe('approved')
    })
    it('the person who sent it for approval cannot decide it either', async () => {
      const { approvalId } = await start(fx.requesterA, fx.manager)       // the manager sent it
      actAs(fx.manager)
      expect((await approveApproval(approvalId, 'approving what I sent')).error).toBe(OWN_REQUEST_MESSAGE)
      expect(await approvalStatus(approvalId)).toBe('pending')
      actAs(fx.admin)
      expect((await approveApproval(approvalId, 'ok')).error).toBeUndefined()
    })
    it('asking for a code on your own request is refused, and ordinary approvals are unaffected', async () => {
      const own = await start(fx.manager, fx.agentA)
      anonymous()
      expect((await requestApprovalCode(own.manager)).error).toBe(OWN_REQUEST_MESSAGE)
      const normal = await start(fx.requesterA, fx.agentA)
      actAs(fx.manager)
      expect((await approveApproval(normal.approvalId, 'looks fine')).error).toBeUndefined()
    })
  })

  describe('D-029 links expire', () => {
    it('a link older than its time is refused everywhere and the page says it expired; the request can still be decided on the portal', async () => {
      const { approvalId, manager } = await start(fx.requesterA, fx.agentA)
      const old = signApprovalToken(approvalId, fx.manager.id, Date.now() - 8 * DAY)!
      expect(verifyApprovalToken(old)?.expired).toBe(true)
      expect(verifyApprovalToken(manager)?.expired).toBe(false)                 // the fresh e-mailed link
      expect((await describeApprovalLink(admin, approvalId, fx.manager.id, verifyApprovalToken(old)!)).kind).toBe('expired')

      actAs(fx.manager)                                                         // even signed in as the approver
      expect((await decideByEmail(old, 'approve', 'late')).error).toBe(LINK_EXPIRED_MESSAGE)
      anonymous()
      expect((await requestApprovalCode(old)).error).toBe(LINK_EXPIRED_MESSAGE)
      expect(await approvalStatus(approvalId)).toBe('pending')

      actAs(fx.manager)
      expect((await approveApproval(approvalId, 'approved on the portal')).error).toBeUndefined()
    })
    it('a link e-mailed before links expired works while the approval is young and stops when it is old', async () => {
      const { approvalId } = await start(fx.requesterA, fx.agentA)
      const payload = `${approvalId}.${fx.manager.id}`
      const legacy = `${payload}.${createHmac('sha256', 'approval-hardening-secret').update(`approval-link:${payload}`).digest('base64url')}`
      actAs(fx.manager)
      expect((await describeApprovalLink(admin, approvalId, fx.manager.id, verifyApprovalToken(legacy)!)).kind).toBe('pending')
      await admin.from('approvals').update({ created_at: new Date(Date.now() - 20 * DAY).toISOString() }).eq('id', approvalId)
      expect((await describeApprovalLink(admin, approvalId, fx.manager.id, verifyApprovalToken(legacy)!)).kind).toBe('expired')
      expect((await decideByEmail(legacy, 'approve', 'late')).error).toBe(LINK_EXPIRED_MESSAGE)
      expect(await approvalStatus(approvalId)).toBe('pending')
    })
  })

  describe('D-060 the e-mailed code is random, single-use and locks', () => {
    it('is stored only as a hash, works once, and a second use of the same code is refused', async () => {
      const { approvalId, manager } = await start(fx.requesterA, fx.agentA)
      anonymous()
      expect((await requestApprovalCode(manager)).error).toBeUndefined()
      const code = lastCode()
      expect(code).toMatch(/^\d{6}$/)
      const { data: rows } = await loose(admin).from('approval_email_codes').select('*').eq('approval_id', approvalId)
      expect(rows).toHaveLength(1)
      expect(JSON.stringify(rows)).not.toContain(code)
      expect(rows![0].code_hash).toMatch(/^[0-9a-f]{64}$/)

      expect((await verifyApprovalCode(manager, code)).error).toBeUndefined()
      jar.clear()
      expect((await verifyApprovalCode(manager, code)).error).toMatch(/not right|expired/i)                    // used up
      expect((await decideByEmail(manager, 'approve', 'no proof any more')).error).toMatch(/confirm it is you/i)
    })
    it('asking for a new code cancels the old one', async () => {
      const { manager } = await start(fx.requesterA, fx.agentA)
      anonymous()
      await requestApprovalCode(manager)
      const first = lastCode()
      sent.length = 0
      await requestApprovalCode(manager)
      const second = lastCode()
      if (first !== second) expect((await verifyApprovalCode(manager, first)).error).toMatch(/not right|expired/i)
      expect((await verifyApprovalCode(manager, second)).error).toBeUndefined()
    })
    it('locks after five wrong tries, even for the right code, until a new one is asked for', async () => {
      const { manager } = await start(fx.requesterA, fx.agentA)
      anonymous()
      await requestApprovalCode(manager)
      const code = lastCode()
      for (let i = 0; i < 4; i++) expect((await verifyApprovalCode(manager, wrong(code))).error).toMatch(/not right/i)
      expect((await verifyApprovalCode(manager, wrong(code))).error).toMatch(/too many wrong tries for this code/i)
      expect((await verifyApprovalCode(manager, code)).error).toMatch(/too many wrong tries for this code|not right/i)
      await rateLimit('noop', 1, 1)
      sent.length = 0
      // a fresh code works (the per-approver verification limit is a separate, wider guard)
      expect((await requestApprovalCode(manager)).error).toBeUndefined()
      expect((await verifyApprovalCode(manager, lastCode())).error).toBeUndefined()
    })
    it('an expired code is refused', async () => {
      const { approvalId, manager } = await start(fx.requesterA, fx.agentA)
      anonymous()
      await requestApprovalCode(manager)
      const code = lastCode()
      await loose(admin).from('approval_email_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('approval_id', approvalId)
      expect((await verifyApprovalCode(manager, code)).error).toMatch(/not right|expired/i)
    })
    it('the table cannot be read by a signed-in user', async () => {
      const { approvalId } = await start(fx.requesterA, fx.agentA)
      const res = await loose(clientForToken(fx.manager.accessToken)).from('approval_email_codes').select('*').eq('approval_id', approvalId)
      expect(res.error?.code === '42501' || (res.data ?? []).length === 0).toBe(true)
    })
  })
})
