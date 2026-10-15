// UAT: the whole ticket journey through the application's own server actions, as real signed-in users of every role (requester, technician, manager,
// administrator, platform owner), with row security on, and every outcome checked in the database. Only mail is faked.
// Journeys: assignment, start, internal notes, waiting on user (remark required, requester reply resumes), hold due to purchase (technician only,
// requester reply does not resume), resolve, reopen, collaborators, notifications, tasks, invalid input, unauthorized users, duplicate and concurrent updates.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus, assignRequest, addComment, addCollaborator } from '@/lib/actions/requests'
import { createTask, updateTaskStatus, addTaskComment, deleteTask } from '@/lib/actions/tasks'

const mockedCreateClient = vi.mocked(createClient)
const actAs = (u: TestUser) => mockedCreateClient.mockResolvedValue(clientForToken(u.accessToken) as never)

describe('UAT ticket lifecycle across roles', () => {
  let fx: D03Fixtures
  const db = getAdmin()
  beforeAll(async () => { fx = await setupD03Fixtures() }, 120_000)
  afterAll(async () => { await fx?.cleanup() }, 120_000)

  const newTicket = (assignedTo?: string, status: 'open' | 'assigned' = 'open') =>
    seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo, status })
  const row = async (id: string) => (await db.from('requests').select('status, assigned_to, waiting_since, responded_at, resolved_at, reopen_count, paused_ms_total, priority').eq('id', id).single()).data!
  const comments = async (id: string) => (await db.from('request_comments').select('author_id, body, is_internal').eq('request_id', id).order('created_at')).data ?? []
  const activity = async (id: string) => (await db.from('request_activity').select('action').eq('request_id', id).order('created_at')).data?.map((a) => a.action) ?? []

  it('assignment: a technician of the team assigns the ticket; the requester is told', async () => {
    const t = await newTicket()
    actAs(fx.agentA)
    expect((await assignRequest(t.id, fx.agentA.id)).error).toBeUndefined()
    const r = await row(t.id)
    expect(r.assigned_to).toBe(fx.agentA.id)
    expect(r.status).toBe('assigned')
    expect(await activity(t.id)).toContain('assigned')
    // the notification is written after the action returns (fire-and-forget), so wait for it briefly
    let told = false
    for (let i = 0; i < 20 && !told; i++) {
      const { data: notes } = await db.from('notifications').select('user_id').eq('request_id', t.id)
      told = (notes ?? []).some((n) => n.user_id === fx.requesterA.id)
      if (!told) await new Promise((r) => setTimeout(r, 250))
    }
    expect(told).toBe(true)
  })

  it('a requester cannot assign; a technician of the other team cannot assign', async () => {
    const t = await newTicket()
    actAs(fx.requesterA)
    expect((await assignRequest(t.id, fx.agentA.id)).error).toBeTruthy()
    actAs(fx.agentB)
    expect((await assignRequest(t.id, fx.agentB.id)).error).toBeTruthy()
    expect((await row(t.id)).assigned_to).toBeNull()
  })

  it('manager, administrator and platform owner can all assign across teams', async () => {
    for (const who of [fx.manager, fx.admin, fx.platformOwner]) {
      const t = await newTicket()
      actAs(who)
      expect((await assignRequest(t.id, fx.agentA.id)).error, who.email).toBeUndefined()
      expect((await row(t.id)).assigned_to).toBe(fx.agentA.id)
    }
  })

  it('start working, internal notes stay internal, and the requester can answer publicly', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    actAs(fx.agentA)
    expect((await updateRequestStatus(t.id, 'in_progress')).error).toBeUndefined()
    expect((await row(t.id)).status).toBe('in_progress')
    expect((await row(t.id)).responded_at).toBeTruthy()

    expect((await addComment(t.id, 'INTERNAL: suspect the battery', true)).error).toBeUndefined()
    // the requester's own session cannot read it
    const seen = (await clientForToken(fx.requesterA.accessToken).from('request_comments').select('body, is_internal').eq('request_id', t.id)).data ?? []
    expect(seen.some((c) => c.is_internal)).toBe(false)
    expect(seen.some((c) => /INTERNAL/.test(c.body))).toBe(false)
    // a requester cannot post an internal note
    actAs(fx.requesterA)
    const sneaky = await addComment(t.id, 'trying to write an internal note', true)
    const mine = (await comments(t.id)).filter((c) => /trying to write/.test(c.body))
    expect(sneaky.error || mine.every((c) => c.is_internal === false)).toBeTruthy()
    expect((await addComment(t.id, 'Thanks, the screen still flickers', false)).error).toBeUndefined()
  })

  it('waiting on user: the remark is required, the clock pauses, and the requester\'s reply resumes work', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    actAs(fx.agentA)
    await updateRequestStatus(t.id, 'in_progress')
    expect((await updateRequestStatus(t.id, 'waiting_user')).error).toBeTruthy() // no remark
    expect((await row(t.id)).status).toBe('in_progress')
    expect((await updateRequestStatus(t.id, 'waiting_user', 'Please send a photo of the label.')).error).toBeUndefined()
    const waiting = await row(t.id)
    expect(waiting.status).toBe('waiting_user')
    expect(waiting.waiting_since).toBeTruthy()
    expect((await comments(t.id)).some((c) => c.body === 'Please send a photo of the label.' && !c.is_internal)).toBe(true)
    actAs(fx.requesterA)
    expect((await addComment(t.id, 'Photo attached in my next message', false)).error).toBeUndefined()
    const back = await row(t.id)
    expect(back.status).toBe('in_progress')
    expect(back.waiting_since).toBeNull()
  })

  it('hold due to purchase: only a technician sets it; a requester reply does not resume it; resuming needs its own remark', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    actAs(fx.agentA)
    await updateRequestStatus(t.id, 'in_progress')
    actAs(fx.requesterA)
    expect((await updateRequestStatus(t.id, 'hold_purchase_ho' as never, 'please hold')).error).toBeTruthy()
    actAs(fx.agentA)
    expect((await updateRequestStatus(t.id, 'hold_purchase_ho' as never)).error).toBeTruthy() // remark required
    expect((await updateRequestStatus(t.id, 'hold_purchase_ho' as never, 'Waiting for the replacement charger from HO.')).error).toBeUndefined()
    expect((await row(t.id)).status).toBe('hold_purchase_ho')
    actAs(fx.requesterA)
    expect((await addComment(t.id, 'Any news?', false)).error).toBeUndefined()
    expect((await row(t.id)).status).toBe('hold_purchase_ho') // not resumed by the reply
    expect((await updateRequestStatus(t.id, 'in_progress')).error).toBeTruthy() // the requester cannot lift it
    actAs(fx.agentA)
    expect((await updateRequestStatus(t.id, 'in_progress')).error).toBeTruthy() // remark required to resume
    expect((await updateRequestStatus(t.id, 'in_progress', 'Charger received, resuming.')).error).toBeUndefined()
    expect((await row(t.id)).status).toBe('in_progress')
  })

  it('resolve needs a resolution note; the requester can reopen once; reopening is counted', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    actAs(fx.agentA)
    await updateRequestStatus(t.id, 'in_progress')
    expect((await updateRequestStatus(t.id, 'resolved')).error).toBeTruthy()
    expect((await updateRequestStatus(t.id, 'resolved', 'Replaced the charger.')).error).toBeUndefined()
    const resolved = await row(t.id)
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolved_at).toBeTruthy()
    actAs(fx.requesterA)
    expect((await updateRequestStatus(t.id, 'open', 'Still flickering after the new charger.')).error).toBeUndefined()
    const reopened = await row(t.id)
    expect(reopened.status).toBe('open')
    expect(reopened.reopen_count).toBe(1)
  })

  it('invalid and unauthorized updates are refused and change nothing', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    const before = await row(t.id)
    actAs(fx.requesterB) // a requester of another team
    expect((await addComment(t.id, 'I should not be here', false)).error).toBeTruthy()
    expect((await updateRequestStatus(t.id, 'cancelled', 'no')).error).toBeTruthy()
    actAs(fx.agentB)
    expect((await updateRequestStatus(t.id, 'in_progress')).error).toBeTruthy()
    actAs(fx.requesterA)
    expect((await updateRequestStatus(t.id, 'resolved', 'self resolve')).error).toBeTruthy() // not a requester transition
    expect((await addComment(t.id, '   ', false)).error).toBeTruthy() // empty comment
    expect((await updateRequestStatus('00000000-0000-0000-0000-00000000dead', 'cancelled', 'x')).error).toBeTruthy() // no such ticket
    const after = await row(t.id)
    expect(after.status).toBe(before.status)
    expect(after.priority).toBe(before.priority)
    expect((await comments(t.id)).length).toBe(0)
  })

  it('text typed into a ticket is stored as text (script, quotes, SQL) and cannot break anything', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    actAs(fx.requesterA)
    const nasty = `'); DROP TABLE requests;-- <img src=x onerror=alert(1)> "quoted" \\ back\\slash`
    expect((await addComment(t.id, nasty, false)).error).toBeUndefined()
    expect((await comments(t.id)).some((c) => c.body === nasty)).toBe(true)
    expect((await db.from('requests').select('id').eq('id', t.id)).data).toHaveLength(1)
  })

  it('concurrent status changes by two technicians leave one consistent result and an honest history', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    actAs(fx.agentA)
    await updateRequestStatus(t.id, 'in_progress')
    const results = await Promise.all([
      updateRequestStatus(t.id, 'waiting_user', 'Need your answer (first).'),
      updateRequestStatus(t.id, 'resolved', 'Fixed (second).'),
    ])
    const final = await row(t.id)
    expect(['waiting_user', 'resolved']).toContain(final.status)
    // whichever won, the loser either errored or was applied after it in a legal order, and the data is not torn
    expect(results.filter((r) => !r.error).length).toBeGreaterThanOrEqual(1)
    if (final.status === 'resolved') expect(final.resolved_at).toBeTruthy()
    if (final.status === 'waiting_user') expect(final.waiting_since).toBeTruthy()
    const acts = await activity(t.id)
    expect(acts.filter((a) => a === 'status_changed').length).toBeGreaterThanOrEqual(2)
  })

  it('collaborators: a technician adds one; the collaborator can then see the ticket', async () => {
    const t = await newTicket(fx.agentA.id, 'assigned')
    actAs(fx.agentA)
    expect((await addCollaborator(t.id, fx.requesterB.id)).error).toBeUndefined()
    const seen = (await clientForToken(fx.requesterB.accessToken).from('requests').select('id').eq('id', t.id)).data ?? []
    expect(seen).toHaveLength(1)
  })

  it('tasks: a technician creates, progresses, comments on and deletes a team task; a requester cannot create one', async () => {
    actAs(fx.agentA)
    const created = await createTask({ title: `UAT task ${Date.now()}`, teamId: fx.teamA.id, assigneeId: fx.agentA.id })
    expect(created.error).toBeUndefined()
    const id = created.data!.id
    expect((await updateTaskStatus(id, 'in_progress' as never)).error).toBeUndefined()
    expect((await addTaskComment(id, 'half done')).error).toBeUndefined()
    expect((await db.from('tasks').select('status').eq('id', id).single()).data?.status).toBe('in_progress')
    expect((await deleteTask(id)).error).toBeFalsy()
    actAs(fx.requesterA)
    expect((await createTask({ title: 'requester task', teamId: fx.teamA.id })).error).toBeTruthy()
  })
})
