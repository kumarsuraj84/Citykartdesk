// Ticket actions on the isolated audit stack (NOT run by the author of the change; the lead runs it):
//  - B-11: a technician who is not in the ticket's group cannot be assigned the ticket (he could not open it);
//  - B-10 / B-12: a ticket that loses its owner goes back to "open" and the old owner's timer stops;
//  - D-14: an empty comment left by a failed upload is really removed;
//  - A-22 / B-35: a huge comment and a bad rating are refused;
//  - B-23 / A-11: a copy made by an administrator stays the original requester's.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { assignRequest, addComment, deleteEmptyComment, submitCsatRating, duplicateRequest } from '@/lib/actions/requests'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
let fx: D03Fixtures
const made: string[] = []
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const newTicket = async (status: string, assignedTo: string | null) => {
  const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo, status: status as never })
  made.push(t.id)
  return t.id as string
}
const row = async (id: string) => (await db().from('requests').select('status, assigned_to, requester_id').eq('id', id).single()).data as { status: string; assigned_to: string | null; requester_id: string }

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => {
  if (made.length) {
    await db().from('request_time_entries').delete().in('request_id', made)
    await db().from('request_activity').delete().in('request_id', made)
    await db().from('request_comments').delete().in('request_id', made)
    await db().from('requests').delete().in('id', made)
  }
  await fx?.cleanup()
}, 180_000)

describe('assigning and unassigning', () => {
  it('B-11: a manager cannot give the ticket to a technician who is not in its group', async () => {
    const id = await newTicket('open', null)
    actAs(fx.manager)
    const r = await assignRequest(id, fx.agentB.id)   // agent B belongs to team B
    expect(r.error).toMatch(/not in the technician group/i)
    expect((await row(id)).assigned_to).toBeNull()
    expect((await assignRequest(id, fx.agentA.id)).error).toBeUndefined()
    expect(await row(id)).toMatchObject({ assigned_to: fx.agentA.id, status: 'assigned' })
  })

  it('B-10 / B-12: unassigning an in-progress ticket reopens it for the queue and stops the old owner\'s timer', async () => {
    const id = await newTicket('in_progress', fx.agentA.id)
    await db().from('request_time_entries').insert({ request_id: id, user_id: fx.agentA.id, started_at: new Date(Date.now() - 600_000).toISOString() })
    actAs(fx.manager)
    expect((await assignRequest(id, null)).error).toBeUndefined()
    expect(await row(id)).toMatchObject({ assigned_to: null, status: 'open' })
    const open = (await db().from('request_time_entries').select('id').eq('request_id', id).is('stopped_at', null)).data
    expect(open).toHaveLength(0)
  })
})

describe('comments and ratings', () => {
  it('A-22: a comment of more than 20,000 characters is refused', async () => {
    const id = await newTicket('in_progress', fx.agentA.id)
    actAs(fx.agentA)
    expect((await addComment(id, 'x'.repeat(20_001), false)).error).toMatch(/too long/i)
    expect((await addComment(id, 'x'.repeat(100), false)).error).toBeUndefined()
  })

  it('D-14: an empty comment (the carrier of failed uploads) is really deleted, and only by its author', async () => {
    const id = await newTicket('in_progress', fx.agentA.id)
    actAs(fx.requesterA)
    const c = await addComment(id, '', false, true)
    expect(c.commentId).toBeTruthy()
    actAs(fx.agentA)
    expect((await deleteEmptyComment(c.commentId!)).error).toBeTruthy()   // not his comment
    expect((await db().from('request_comments').select('id').eq('id', c.commentId)).data).toHaveLength(1)
    actAs(fx.requesterA)
    expect((await deleteEmptyComment(c.commentId!)).error).toBeUndefined()
    expect((await db().from('request_comments').select('id').eq('id', c.commentId)).data).toHaveLength(0)
  })

  it('B-35: a rating must be a whole number from 1 to 5, and 1-2 stars need a comment', async () => {
    actAs(fx.requesterA)
    for (const bad of [Number.NaN, 4.5, 0, 6]) expect((await submitCsatRating(randomUUID(), bad, 'ok')).error, String(bad)).toBeTruthy()
    expect((await submitCsatRating(randomUUID(), 1, '   ')).error).toMatch(/what went wrong/i)
  })
})

describe('copy and approval', () => {
  it('B-23 / A-11: an administrator\'s copy stays the original requester\'s, and one history entry says "created"', async () => {
    const id = await newTicket('open', null)
    actAs(fx.admin)
    const r = await duplicateRequest(id)
    expect(r.error).toBeUndefined()
    made.push(r.id!)
    expect((await row(r.id!)).requester_id).toBe(fx.requesterA.id)
    const created = (await db().from('request_activity').select('id').eq('request_id', r.id).eq('action', 'created')).data
    expect(created).toHaveLength(1)
  })
})
