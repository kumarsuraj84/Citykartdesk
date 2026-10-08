/**
 * The CSAT flow end to end, against the real database: one "resolved + how did we do?" e-mail (no separate resolved e-mail,
 * no closed e-mail), rating and reopening from the e-mail link without logging in, the reason required to reopen, low-rating
 * alerts, the single reminder, and a fresh survey after a reopen.
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
import { submitRatingByToken, reopenByToken } from '@/lib/actions/csatPublic'
import { autoCloseDueRequests } from '@/lib/requests/auto-close'
import { sendDueCsatReminders } from '@/lib/csat/reminders'
import { resetCsatSettingsCache } from '@/lib/csat/settings'
import { signCsatToken } from '@/lib/csat/token'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) { mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never) }
const settle = () => new Promise((r) => setTimeout(r, 600))

describe('CSAT: resolved e-mail, rating and reopen from the link', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    process.env.CSAT_LINK_SECRET = 'test-csat-secret'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { sent.length = 0; resetCsatSettingsCache() })

  const mailsTo = (user: TestUser) => sent.filter((e) => e.to.toLowerCase() === user.email.toLowerCase())
  const tokenFrom = (html: string) => /\/csat\/([A-Za-z0-9._-]+)\?/.exec(html)?.[1] ?? ''

  async function resolve() {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(fx.agentA)
    const res = await updateRequestStatus(req.id, 'resolved', 'Replaced the part.')
    expect(res.error).toBeUndefined()
    await settle()
    return req
  }

  it('sends ONE e-mail on resolve: the resolution note, five star links and a reopen link (no separate resolved e-mail)', async () => {
    const req = await resolve()
    const mails = mailsTo(fx.requesterA)
    expect(mails).toHaveLength(1)
    const html = mails[0].html
    expect(html).toContain('Replaced the part.')
    for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`?r=${n}`)
    expect(html).toContain('?reopen=1')
    const { data: survey } = await admin.from('csat_surveys').select('id, submitted_at').eq('request_id', req.id).single()
    expect(survey).toBeTruthy()
    expect(survey!.submitted_at).toBeNull()
  })

  it('closing sends no e-mail to the requester (the bell only)', async () => {
    const req = await resolve()
    sent.length = 0
    await admin.from('requests').update({ reopen_deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', req.id)
    await autoCloseDueRequests(admin as never, null, 200)
    await settle()
    const { data } = await admin.from('requests').select('status').eq('id', req.id).single()
    expect(data!.status).toBe('closed')
    expect(mailsTo(fx.requesterA)).toHaveLength(0)
    const { data: bell } = await admin.from('notifications').select('type').eq('request_id', req.id).eq('user_id', fx.requesterA.id)
    expect((bell ?? []).some((n: { type: string }) => n.type === 'request_auto_closed')).toBe(true)
  })

  it('a rating from the link is saved once; 1–2 stars need a comment and alert the technician', async () => {
    const req = await resolve()
    const token = tokenFrom(mailsTo(fx.requesterA)[0].html)
    expect(token).not.toBe('')

    expect((await submitRatingByToken(token, 1, '   ')).error).toMatch(/what went wrong/i)
    expect((await submitRatingByToken(token, 9, '')).error).toBeTruthy()

    const ok = await submitRatingByToken(token, 2, 'Still slow')
    expect(ok.error).toBeUndefined()
    const { data: survey } = await admin.from('csat_surveys').select('rating, comment, submitted_at').eq('request_id', req.id).single()
    expect(survey).toMatchObject({ rating: 2, comment: 'Still slow' })
    expect(survey!.submitted_at).not.toBeNull()

    expect((await submitRatingByToken(token, 5, '')).error).toMatch(/already been rated/i)

    const { data: alerts } = await admin.from('notifications').select('type, user_id').eq('request_id', req.id).eq('type', 'csat_low_rating')
    expect((alerts ?? []).map((a: { user_id: string }) => a.user_id)).toContain(fx.agentA.id)
  })

  it('a 5-star rating raises no alert', async () => {
    const req = await resolve()
    const token = tokenFrom(mailsTo(fx.requesterA)[0].html)
    expect((await submitRatingByToken(token, 5, '')).error).toBeUndefined()
    const { data: alerts } = await admin.from('notifications').select('id').eq('request_id', req.id).eq('type', 'csat_low_rating')
    expect(alerts ?? []).toHaveLength(0)
  })

  it('reopening from the link needs a reason, then follows the normal reopen rules; resolving again asks again', async () => {
    const req = await resolve()
    const token = tokenFrom(mailsTo(fx.requesterA)[0].html)
    await submitRatingByToken(token, 4, '')

    expect((await reopenByToken(token, '   ')).error).toMatch(/why/i)
    const res = await reopenByToken(token, 'Still broken after the fix.')
    expect(res.error).toBeUndefined()
    const { data: t } = await admin.from('requests').select('status, reopen_count, reopen_deadline_at').eq('id', req.id).single()
    expect(t).toMatchObject({ status: 'open', reopen_count: 1, reopen_deadline_at: null })
    const { data: comments } = await admin.from('request_comments').select('body').eq('request_id', req.id)
    expect(JSON.stringify(comments)).toContain('Still broken after the fix.')

    // the ticket is open again: the old link can neither rate nor reopen
    expect((await submitRatingByToken(token, 5, '')).error).toMatch(/worked on again/i)
    expect((await reopenByToken(token, 'again')).error).toMatch(/already open/i)

    // resolved a second time: the earlier answer is wiped and a new e-mail goes out
    sent.length = 0
    actAs(fx.agentA)
    await updateRequestStatus(req.id, 'in_progress')
    await updateRequestStatus(req.id, 'resolved', 'Fixed properly this time.')
    await settle()
    expect(mailsTo(fx.requesterA).filter((m) => m.html.includes('/csat/'))).toHaveLength(1)
    const { data: survey } = await admin.from('csat_surveys').select('rating, submitted_at').eq('request_id', req.id).single()
    expect(survey).toMatchObject({ rating: null, submitted_at: null })
  })

  it('cannot reopen once the window has ended, and bad or expired links are refused', async () => {
    const req = await resolve()
    const token = tokenFrom(mailsTo(fx.requesterA)[0].html)
    await admin.from('requests').update({ reopen_deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', req.id)
    expect((await reopenByToken(token, 'too late')).error).toMatch(/window/i)
    // rating still works after the window
    expect((await submitRatingByToken(token, 5, '')).error).toBeUndefined()

    expect((await submitRatingByToken(token.slice(0, -3) + 'abc', 5, '')).error).toMatch(/not valid/i)
    const { data: survey } = await admin.from('csat_surveys').select('id').eq('request_id', req.id).single()
    const expired = signCsatToken(survey!.id, Date.now() - 1000)!
    expect((await submitRatingByToken(expired, 5, '')).error).toMatch(/expired/i)
  })

  it('sends one reminder after the configured days to a requester who has not rated, and only one', async () => {
    const req = await resolve()
    sent.length = 0
    expect(await sendDueCsatReminders(admin as never)).toBe(0) // too early
    await admin.from('csat_surveys').update({ sent_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq('request_id', req.id)
    const first = await sendDueCsatReminders(admin as never)
    expect(first).toBeGreaterThanOrEqual(1)
    expect(mailsTo(fx.requesterA)).toHaveLength(1)
    expect(await sendDueCsatReminders(admin as never)).toBe(0)
    expect(mailsTo(fx.requesterA)).toHaveLength(1)
  })

  it('does not remind a requester who already rated', async () => {
    const req = await resolve()
    const token = tokenFrom(mailsTo(fx.requesterA)[0].html)
    await submitRatingByToken(token, 5, '')
    sent.length = 0
    await admin.from('csat_surveys').update({ sent_at: new Date(Date.now() - 5 * 86_400_000).toISOString() }).eq('request_id', req.id)
    await sendDueCsatReminders(admin as never)
    expect(mailsTo(fx.requesterA)).toHaveLength(0)
  })
})
