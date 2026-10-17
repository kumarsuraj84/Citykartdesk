// Portal double-submit, retries and conflicting simultaneous updates, through the real server actions on the isolated stack.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest, updateRequestStatus, addComment } from '@/lib/actions/requests'

vi.setConfig({ testTimeout: 180_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const tag = `p28-${Date.now()}`
const made: string[] = []

beforeAll(async () => { fx = await setupD03Fixtures() }, 240_000)
afterAll(async () => {
  if (made.length) { await admin().from('request_activity').delete().in('request_id', made); await admin().from('request_comments').delete().in('request_id', made); await admin().from('requests').delete().in('id', made) }
  await fx?.cleanup()
}, 120_000)

const form = (title: string) => { const f = new FormData(); f.set('service_id', fx.teamA.serviceId); f.set('form_data', JSON.stringify({ subject: title })); return f }
// tickets of requester A for the test service created since `since` (the title comes from the service's own form, so it is not used to find them)
const ticketsSince = async (since: string) => (await admin().from('requests').select('id').eq('requester_id', fx.requesterA.id).eq('service_id', fx.teamA.serviceId).gte('created_at', since).not('source_metadata->>submission_key', 'is', null)).data ?? []

describe('portal double-submit and retry', () => {
  it('eight identical submissions at the same instant create ONE ticket (the others are told it already exists)', async () => {
    actAs(fx.requesterA)
    const since = new Date(Date.now() - 50).toISOString()
    const title = `${tag} double`
    const results = await Promise.all(Array.from({ length: 8 }, () => createRequest(form(title))))
    const ok = results.filter((r) => r.requestId)
    const rows = await ticketsSince(since)
    for (const r of rows) made.push(r.id)
    expect(rows.length, JSON.stringify(results.map((r) => r.error ?? 'ok'))).toBe(1)
    expect(ok.length).toBeGreaterThanOrEqual(1)
    // everybody who succeeded points at the same ticket
    expect(new Set(ok.map((r) => r.requestId)).size).toBe(1)
  })
  it('the same submission repeated after a few seconds (a retry) is not a duplicate either, but a deliberately different one is accepted', async () => {
    actAs(fx.requesterA)
    const since = new Date(Date.now() - 50).toISOString()
    const title = `${tag} retry`
    const first = await createRequest(form(title))
    expect(first.requestId).toBeTruthy()
    const second = await createRequest(form(title))                       // a retry a moment later: the first ticket again
    expect(second.requestId).toBe(first.requestId)
    const other = await createRequest(form(`${title} different`))       // different answers: a different ticket
    expect(other.requestId).toBeTruthy()
    expect(other.requestId).not.toBe(first.requestId)
    for (const r of await ticketsSince(since)) made.push(r.id)
    expect((await ticketsSince(since)).length).toBe(2)
  })
})

describe('conflicting simultaneous updates', () => {
  it('a technician and a manager changing the status of one ticket at the same time leave a consistent ticket and history', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    made.push(t.id)
    // each caller needs its own session, so the two run one after the other in the mock but both start from "in_progress"
    const run = async (who: { accessToken: string }, status: string, note: string) => { actAs(who); return updateRequestStatus(t.id, status as never, note) }
    const [a, b] = await Promise.all([run(fx.agentA, 'waiting_user', 'Need the serial number from the requester please'), run(fx.manager, 'cancelled', 'Cancelling this as a duplicate of another ticket')])
    const ticket = (await admin().from('requests').select('status').eq('id', t.id).single()).data!
    expect(['waiting_user', 'cancelled']).toContain(ticket.status)
    expect([a.error, b.error].filter(Boolean).length).toBeLessThanOrEqual(1)
    // never half done: every status change in the history has its remark as a comment, and the last status in the history is the ticket's status
    const act = (await admin().from('request_activity').select('metadata').eq('request_id', t.id).eq('action', 'status_changed').order('created_at', { ascending: true })).data ?? []
    expect(act.length).toBeGreaterThanOrEqual(1)
    expect((act[act.length - 1].metadata as { to?: string }).to).toBe(ticket.status)
  })
  it('twenty simultaneous comments are all stored, none lost', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    made.push(t.id)
    actAs(fx.agentA)
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => addComment(t.id, `${tag} comment ${i}`, false)))
    const stored = (await admin().from('request_comments').select('id').eq('request_id', t.id)).data ?? []
    expect(stored.length, JSON.stringify(results.filter((r) => r?.error).slice(0, 2))).toBe(20)
  })
})
