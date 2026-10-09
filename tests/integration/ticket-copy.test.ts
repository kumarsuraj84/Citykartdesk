/**
 * "CC" on a technician's public comment, against the real database: only CK Desk addresses (users and OEM contacts) are
 * accepted, each gets the ticket + the whole public conversation (never internal notes), the PDF is attached on request,
 * and only the technician who posted a public comment can copy it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

type Sent = { to: string; subject: string; html: string; text?: string; attachments?: { filename: string; content: string }[] }
const sent: Sent[] = []
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (p: Sent) => { sent.push(p); return {} }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const state = vi.hoisted(() => ({ profile: null as unknown }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn(async () => state.profile) }))

import { createClient } from '@/lib/supabase/server'
import { copyCommentByEmail, searchCcContacts } from '@/lib/actions/ticketCopy'
import { resetCcBookCache } from '@/lib/requests/cc-recipients'

vi.setConfig({ testTimeout: 120_000 })

describe('CC on a comment', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  let ticketId: string
  let publicCommentId: string
  let internalCommentId: string
  const oemEmail = `oem-contact-${Date.now()}@oem-fixture.test`
  let oemId: string

  async function as(user: TestUser) {
    const { data } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('id', user.id).single()
    state.profile = data
    vi.mocked(createClient).mockResolvedValue(clientForToken(user.accessToken) as never)
  }
  const comment = async (author: TestUser, body: string, internal: boolean) => {
    const { data, error } = await admin.from('request_comments').insert({ request_id: ticketId, author_id: author.id, body, is_internal: internal }).select('id').single()
    if (error) throw error
    return data!.id as string
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    ticketId = t.id
    await comment(fx.requesterA, 'Store question: please send the card', false)
    publicCommentId = await comment(fx.agentA, 'Technician answer: it will be issued tomorrow', false)
    internalCommentId = await comment(fx.agentA, 'SECRET internal note about cost', true)
    const { data: oem } = await admin.from('oems').insert({ org_id: '00000000-0000-0000-0000-000000000001', name: `Fixture OEM ${Date.now()}`, emails: [oemEmail] }).select('id').single()
    oemId = oem!.id
  }, 90_000)
  afterAll(async () => { await admin.from('oems').delete().eq('id', oemId); await fx?.cleanup() }, 90_000)
  beforeEach(async () => { sent.length = 0; resetCcBookCache(); await as(fx.agentA) })

  it('copies the comment to a CK Desk user and an OEM contact: ticket, whole public conversation, PDF attached, no internal note', async () => {
    const out = await copyCommentByEmail(ticketId, publicCommentId, [fx.manager.email, oemEmail], true)
    expect(out.error).toBeUndefined()
    expect(out.sent.map((s) => s.email).sort()).toEqual([fx.manager.email.toLowerCase(), oemEmail].sort())
    expect(out.failed).toEqual([])
    expect(out.pdfAttached).toBe(true)

    expect(sent).toHaveLength(2)
    for (const m of sent) {
      expect(m.subject).toMatch(/copied by D03 Agent A/)
      expect(m.html).toContain('Store question: please send the card')
      expect(m.html).toContain('Technician answer: it will be issued tomorrow')
      expect(m.html).toContain('NEW')
      expect(JSON.stringify(m)).not.toContain('SECRET')
      expect(m.attachments).toHaveLength(1)
      expect(m.attachments![0].filename).toMatch(/\.pdf$/)
      expect(Buffer.from(m.attachments![0].content, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
    }

    // the History tab can show who was copied
    const { data: acts } = await admin.from('request_activity').select('metadata').eq('request_id', ticketId).eq('action', 'comment_added')
    const copied = (acts ?? []).flatMap((a) => ((a.metadata as { cc?: { email: string }[] } | null)?.cc ?? []))
    expect(copied.map((c) => c.email).sort()).toEqual([fx.manager.email.toLowerCase(), oemEmail].sort())
  })

  it('sends no PDF when it is not asked for', async () => {
    const out = await copyCommentByEmail(ticketId, publicCommentId, [fx.manager.email], false)
    expect(out.sent).toHaveLength(1)
    expect(out.pdfAttached).toBe(false)
    expect(sent[0].attachments).toBeUndefined()
    expect(sent[0].html).not.toContain('attached as a PDF')
  })

  it('never sends to an outsider, the requester or the technician themselves', async () => {
    const out = await copyCommentByEmail(ticketId, publicCommentId, ['outsider@gmail.com', fx.requesterA.email, fx.agentA.email], true)
    expect(out.sent).toEqual([])
    expect(out.failed.map((f) => f.email).sort()).toEqual(['outsider@gmail.com', fx.requesterA.email.toLowerCase(), fx.agentA.email.toLowerCase()].sort())
    expect(sent).toHaveLength(0)
  })

  it('a good address is still sent when another one in the same list is refused', async () => {
    const out = await copyCommentByEmail(ticketId, publicCommentId, ['outsider@gmail.com', fx.manager.email], false)
    expect(out.sent.map((s) => s.email)).toEqual([fx.manager.email.toLowerCase()])
    expect(out.failed.map((f) => f.email)).toEqual(['outsider@gmail.com'])
    expect(sent).toHaveLength(1)
  })

  it('refuses internal notes, someone else\'s comment, an old comment, and a non-technician', async () => {
    expect((await copyCommentByEmail(ticketId, internalCommentId, [fx.manager.email], false)).error).toMatch(/Internal notes/)

    await as(fx.agentB) // a technician of another group cannot see this ticket at all
    expect((await copyCommentByEmail(ticketId, publicCommentId, [fx.manager.email], false)).error).toMatch(/not found|Only technicians/i)

    await as(fx.manager) // sees the ticket, but the comment is not theirs
    expect((await copyCommentByEmail(ticketId, publicCommentId, [fx.agentA.email], false)).error).toMatch(/you posted yourself/)

    await as(fx.agentA)
    await admin.from('request_comments').update({ created_at: new Date(Date.now() - 30 * 60_000).toISOString() }).eq('id', publicCommentId)
    expect((await copyCommentByEmail(ticketId, publicCommentId, [fx.manager.email], false)).error).toMatch(/too old/)
    await admin.from('request_comments').update({ created_at: new Date().toISOString() }).eq('id', publicCommentId)

    await as(fx.requesterA)
    expect((await copyCommentByEmail(ticketId, publicCommentId, [fx.manager.email], false)).error).toBeTruthy()
    expect(sent).toHaveLength(0)
  })

  it('the CC box suggests CK Desk people and OEM contacts to technicians only', async () => {
    const found = await searchCcContacts(fx.manager.email.split('@')[0].slice(-22))
    expect(found.map((c) => c.email)).toContain(fx.manager.email.toLowerCase())
    expect((await searchCcContacts(oemEmail.slice(0, 14))).map((c) => c.email)).toContain(oemEmail)
    expect((await searchCcContacts('nobody-by-this-name-zz')).length).toBe(0)
    await as(fx.requesterA)
    expect(await searchCcContacts(fx.manager.email.split('@')[0].slice(-22))).toEqual([])
  })
})
