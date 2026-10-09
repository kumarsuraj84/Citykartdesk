/**
 * The "Download PDF" endpoint of a ticket, against the real database: the person must be signed in and able to open the
 * ticket, the file is named after the ticket, and internal notes never reach the PDF (for the requester or the technician).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
const state = vi.hoisted(() => ({ profile: null as unknown, model: null as unknown }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn(async () => state.profile) }))
// the file drawing is covered by its own tests; here only what is handed to it matters
vi.mock('@/lib/pdf/ticket-pdf', () => ({ renderTicketPdf: vi.fn(async (model: unknown) => { state.model = model; return Buffer.from('%PDF-1.3 fake') }) }))

import { createClient } from '@/lib/supabase/server'
import { GET } from '@/app/api/requests/[id]/pdf/route'

describe('GET /api/requests/[id]/pdf', () => {
  let fx: D03Fixtures
  const admin = getAdmin()
  let ticketId: string
  let requestNo: string

  async function as(user: TestUser | null) {
    if (!user) { state.profile = null; return }
    const { data } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('id', user.id).single()
    state.profile = data
    vi.mocked(createClient).mockResolvedValue(clientForToken(user.accessToken) as never)
  }
  const call = (id: string) => GET(new Request('http://app.test/x'), { params: Promise.resolve({ id }) })

  beforeAll(async () => {
    fx = await setupD03Fixtures()
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    ticketId = t.id
    requestNo = t.request_no
    await admin.from('request_comments').insert([
      { request_id: ticketId, author_id: fx.requesterA.id, body: 'Public question from the store', is_internal: false },
      { request_id: ticketId, author_id: fx.agentA.id, body: 'Public answer from the technician', is_internal: false },
      { request_id: ticketId, author_id: fx.agentA.id, body: 'SECRET internal note', is_internal: true },
    ])
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)
  beforeEach(() => { state.model = null })

  it('the technician gets a PDF named after the ticket, with the public conversation only', async () => {
    await as(fx.agentA)
    const res = await call(ticketId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain(`${requestNo}.pdf`)
    const m = state.model as { conversation: { body: string }[]; generatedBy: string }
    expect(m.conversation.map((c) => c.body).sort()).toEqual(['Public answer from the technician', 'Public question from the store'])
    expect(JSON.stringify(m)).not.toContain('SECRET')
  })

  it('the requester can download their own ticket, also without the internal note', async () => {
    await as(fx.requesterA)
    const res = await call(ticketId)
    expect(res.status).toBe(200)
    expect(JSON.stringify(state.model)).not.toContain('SECRET')
  })

  it('someone who cannot open the ticket gets nothing', async () => {
    await as(fx.requesterB)
    expect((await call(ticketId)).status).toBe(404)
    expect(state.model).toBeNull()
  })

  it('needs a signed-in person, and refuses a malformed ticket id', async () => {
    await as(null)
    expect((await call(ticketId)).status).toBe(401)
    await as(fx.agentA)
    expect((await call('not-a-ticket')).status).toBe(404)
  })
})
