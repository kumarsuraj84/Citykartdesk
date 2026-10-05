/**
 * Clicking Start Working used to make the technician type a first response (the server refused
 * without one). It now posts an automatic message to the conversation instead, so one click
 * starts the work and answers the requester. Real database + status engine; only mail is faked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)
function actAs(user: TestUser) { mockedCreateClient.mockResolvedValue(clientForToken(user.accessToken) as never) }

describe('Start Working posts an automatic first response', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => { fx = await setupD03Fixtures() }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  const openTicket = () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'open' })
  const commentsOf = async (requestId: string) =>
    (await admin.from('request_comments').select('author_id, body, is_internal').eq('request_id', requestId).order('created_at')).data ?? []

  it('starts work with no message typed, and the requester gets a public message from the technician', async () => {
    const req = await openTicket()
    actAs(fx.agentA)
    const res = await updateRequestStatus(req.id, 'in_progress')
    expect(res.error).toBeUndefined()

    const { data: row } = await admin.from('requests').select('status, responded_at').eq('id', req.id).single()
    expect(row!.status).toBe('in_progress')
    expect(row!.responded_at).toBeTruthy()

    const comments = await commentsOf(req.id)
    expect(comments).toHaveLength(1)
    expect(comments[0].author_id).toBe(fx.agentA.id)
    expect(comments[0].is_internal).toBe(false)
    expect(comments[0].body).toContain(req.request_no)
    expect(comments[0].body).toMatch(/started working on your request/)
  })

  it('a message the technician does supply is used instead of the automatic one', async () => {
    const req = await openTicket()
    actAs(fx.agentA)
    expect((await updateRequestStatus(req.id, 'in_progress', 'On it — checking the printer now.')).error).toBeUndefined()
    const comments = await commentsOf(req.id)
    expect(comments).toHaveLength(1)
    expect(comments[0].body).toBe('On it — checking the printer now.')
  })

  it('the automatic message is only for the FIRST start: resuming later does not post another', async () => {
    const req = await openTicket()
    actAs(fx.agentA)
    await updateRequestStatus(req.id, 'in_progress')
    await updateRequestStatus(req.id, 'waiting_user', 'Please send a photo.')
    expect((await updateRequestStatus(req.id, 'in_progress')).error).toBeUndefined()
    const comments = await commentsOf(req.id)
    expect(comments.map((c) => c.body)).toEqual([
      expect.stringMatching(/started working on your request/),
      'Please send a photo.',
    ])
  })
})
