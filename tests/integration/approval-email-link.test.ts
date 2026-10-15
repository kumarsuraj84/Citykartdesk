/**
 * Approve / reject from the link in the approval e-mail, against the real database and approval engine (only the mail transport
 * and the browser's cookie jar are replaced). The link belongs to one approver and never expires on its own; the visitor must
 * prove they are that approver (signed in, or the 6-digit code e-mailed to the approver's own address); a comment is required;
 * and the link stops working the moment the approval is decided, on the portal or from any e-mail.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

type Sent = { to: string; subject: string; html: string; text?: string }
const sent: Sent[] = []
const jar = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (p: Sent) => { sent.push(p); return {} }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn(async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
    set: (n: string, v: string) => { jar.set(n, v) },
    getAll: () => [],
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendAdHocApproval, approveApproval, rejectApproval } from '@/lib/actions/approvals'
import { requestApprovalCode, verifyApprovalCode, decideByEmail } from '@/lib/actions/approvalEmail'
import { describeApprovalLink } from '@/lib/approvals/email-state'

vi.setConfig({ testTimeout: 60_000 })

const mocked = vi.mocked(createClient)
const actAs = (u: TestUser) => mocked.mockResolvedValue(clientForToken(u.accessToken) as never)
const anonymous = () => mocked.mockResolvedValue(clientForToken('not-a-real-session') as never)
const waitFor = async (cond: () => boolean, ms = 5000) => { const s = Date.now(); while (!cond() && Date.now() - s < ms) await new Promise((r) => setTimeout(r, 50)) }

describe('approve / reject from the e-mail link', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    process.env.CSAT_LINK_SECRET = 'approval-link-test-secret'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0; jar.clear() })

  /** A ticket sent for approval to the manager and the admin at once; returns each approver's own link token. */
  async function start() {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(fx.agentA)
    expect((await sendAdHocApproval(req.id, [fx.manager.id, fx.admin.id])).error).toBeUndefined()
    await waitFor(() => sent.filter((m) => /Approval required/.test(m.subject)).length >= 2)
    const tokenFor = (u: TestUser) => {
      const mail = sent.find((m) => m.to.toLowerCase() === u.email.toLowerCase() && /Approval required/.test(m.subject))
      return { mail, approve: /\/approve\/([A-Za-z0-9._-]+)\?do=approve/.exec(mail?.html ?? '')?.[1] ?? '', reject: /\/approve\/([A-Za-z0-9._-]+)\?do=reject/.exec(mail?.html ?? '')?.[1] ?? '' }
    }
    const { data: approval } = await admin.from('approvals').select('id').eq('request_id', req.id).single()
    return { req, approvalId: approval!.id as string, manager: tokenFor(fx.manager), adminTok: tokenFor(fx.admin) }
  }
  const statusOf = async (id: string) => (await admin.from('requests').select('status').eq('id', id).single()).data!.status
  const approvalStatus = async (id: string) => (await admin.from('approvals').select('status').eq('id', id).single()).data!.status
  const lastCode = () => /\bis (\d{6})\./.exec([...sent].reverse().find((m) => /Your Citykart Desk verification code/.test(m.subject))?.text ?? '')?.[1] ?? ''

  it('each approver\'s e-mail has Approve and Reject buttons that carry THEIR own link', async () => {
    const { manager, adminTok } = await start()
    expect(manager.approve).toBeTruthy()
    expect(manager.reject).toBe(manager.approve)
    expect(adminTok.approve).toBeTruthy()
    expect(adminTok.approve).not.toBe(manager.approve) // personal to each approver
    expect(manager.mail!.html).toContain('>Approve<')
    expect(manager.mail!.html).toContain('>Reject<')
    expect(manager.mail!.html).toContain('A comment is required')
    expect(manager.mail!.text).toContain('/approve/')
  })

  it('a visitor who is not signed in and has no code cannot decide, and the code is mailed only to the approver', async () => {
    const { approvalId, manager } = await start()
    anonymous()
    expect((await decideByEmail(manager.approve, 'approve', 'looks fine')).error).toMatch(/confirm it is you/i)
    expect(await approvalStatus(approvalId)).toBe('pending')

    sent.length = 0
    const r = await requestApprovalCode(manager.approve)
    expect(r.error).toBeUndefined()
    expect(r.sentTo).toMatch(/\*+@/) // masked address on the page
    const codeMails = sent.filter((m) => /Your Citykart Desk verification code/.test(m.subject))
    expect(codeMails).toHaveLength(1)
    expect(codeMails[0].to.toLowerCase()).toBe(fx.manager.email.toLowerCase()) // never anyone else's mailbox
  })

  it('a wrong code does not work; the right code lets the approver decide, with a mandatory comment', async () => {
    const { req, approvalId, manager } = await start()
    anonymous()
    await requestApprovalCode(manager.approve)
    const code = lastCode()
    expect(code).toMatch(/^\d{6}$/)

    expect((await verifyApprovalCode(manager.approve, code === '000000' ? '111111' : '000000')).error).toMatch(/not right/i)
    expect((await decideByEmail(manager.approve, 'approve', 'x')).error).toMatch(/confirm it is you/i) // still no proof

    expect((await verifyApprovalCode(manager.approve, code)).error).toBeUndefined()
    expect((await decideByEmail(manager.approve, 'approve', '   ')).error).toMatch(/comment/i) // required
    expect(await approvalStatus(approvalId)).toBe('pending')

    expect((await decideByEmail(manager.approve, 'approve', 'Approved: go ahead.')).error).toBeUndefined()
    expect(await approvalStatus(approvalId)).toBe('approved')
    expect(await statusOf(req.id)).toBe('in_progress') // work resumes, same as on the portal
    const { data: dec } = await admin.from('approval_decisions').select('comment, decided_by, decision').eq('approval_id', approvalId).single()
    expect(dec).toMatchObject({ comment: 'Approved: go ahead.', decision: 'approved', decided_by: fx.manager.id })
    const { data: acts } = await admin.from('request_activity').select('metadata').eq('request_id', req.id).eq('action', 'approved')
    expect(JSON.stringify(acts)).toContain('"via":"email"')
  })

  it('signed in as the approver, no code is needed', async () => {
    const { approvalId, manager } = await start()
    actAs(fx.manager)
    expect((await decideByEmail(manager.reject, 'reject', 'Not needed right now.')).error).toBeUndefined()
    expect(await approvalStatus(approvalId)).toBe('rejected')
  })

  it('FORWARDED e-mail: someone signed in as another person is refused and told who it was sent to', async () => {
    const { approvalId, manager } = await start()
    actAs(fx.agentB)
    const res = await decideByEmail(manager.approve, 'approve', 'I will approve this')
    expect(res.error).toBe(`You are not authorised to approve or reject this request. It can be approved or rejected only by ${'D03 Manager'}, to whom it was sent.`)
    expect(await approvalStatus(approvalId)).toBe('pending')
  })

  it('the manager cannot use the ADMIN\'s link (each link is personal)', async () => {
    const { approvalId, adminTok } = await start()
    actAs(fx.manager)
    const res = await decideByEmail(adminTok.approve, 'approve', 'sneaky')
    expect(res.error).toMatch(/not authorised/i)
    expect(res.error).toContain('D03 Admin')
    expect(await approvalStatus(approvalId)).toBe('pending')
  })

  it('two approvers: once one has decided, the other\'s link is finished and says who decided', async () => {
    const { approvalId, manager, adminTok } = await start()
    actAs(fx.manager)
    await decideByEmail(manager.approve, 'approve', 'Approved by the manager.')

    const state = await describeApprovalLink(admin, approvalId, fx.admin.id)
    expect(state).toMatchObject({ kind: 'decided', outcome: 'approved', by: 'D03 Manager' })
    if (state.kind === 'decided') expect(state.sentTo.sort()).toEqual(['D03 Admin', 'D03 Manager'])

    actAs(fx.admin)
    expect((await decideByEmail(adminTok.approve, 'approve', 'too late')).error).toBe('This approval is no longer pending.')
  })

  it('decided on the portal: the e-mail link no longer works and shows who decided', async () => {
    const { approvalId, manager } = await start()
    actAs(fx.admin)
    expect((await rejectApproval(approvalId, 'Rejected on the portal.')).error).toBeUndefined()
    const state = await describeApprovalLink(admin, approvalId, fx.manager.id)
    expect(state).toMatchObject({ kind: 'decided', outcome: 'rejected', by: 'D03 Admin' })
    actAs(fx.manager)
    expect((await decideByEmail(manager.approve, 'approve', 'late')).error).toBe('This approval is no longer pending.')
  })

  it('the portal needs a comment as well, for approve and for reject', async () => {
    const { approvalId } = await start()
    actAs(fx.manager)
    expect((await approveApproval(approvalId)).error).toMatch(/comment/i)
    expect((await approveApproval(approvalId, '   ')).error).toMatch(/comment/i)
    expect((await rejectApproval(approvalId, '')).error).toMatch(/comment/i)
    expect(await approvalStatus(approvalId)).toBe('pending')
    expect((await approveApproval(approvalId, 'ok')).error).toBeUndefined()
  })

  it('a code can be asked for only a few times, and a bad link is refused', async () => {
    const { manager } = await start()
    anonymous()
    expect((await requestApprovalCode(manager.approve)).error).toBeUndefined()
    await requestApprovalCode(manager.approve)
    await requestApprovalCode(manager.approve)
    expect((await requestApprovalCode(manager.approve)).error).toMatch(/moment ago|few minutes/i)
    expect((await requestApprovalCode(manager.approve.slice(0, -3) + 'abc')).error).toMatch(/not valid/i)
    expect((await decideByEmail('garbage', 'approve', 'x')).error).toMatch(/not valid/i)
  })

  it('still pending: the state tells the approver it is waiting on them', async () => {
    const { approvalId } = await start()
    const state = await describeApprovalLink(admin, approvalId, fx.manager.id)
    expect(state.kind).toBe('pending')
    if (state.kind === 'pending') {
      expect(state.detail.requesterName).toBe('D03 Requester A')
      expect(state.detail.sentByName).toBe('D03 Agent A')
    }
  })
})
