// SLA calendar and pauses, on the isolated audit stack (NOT run by the author of the change; the lead runs it):
//  - B-01: the business-hours calendar is read with the server key, so a caller with no browser session (AC PMS job, WhatsApp, scheduled rules, the CSAT e-mail reopen) still gets deadlines;
//  - F-28: an all-day calendar (00:00-23:59) loses no minute at midnight;
//  - F-13: a pause is credited ONCE (when it ends) to the deadline and the ledger, and a re-classification does not wipe a deadline it cannot work out;
//  - a reopened ticket's SLA clock starts at the reopen, not at the creation.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
// the signed-in user's (cookie-bound) client: for the calendar it must never be used - here it is nobody's session at all
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { computeSLADeadline, computeElapsedBusinessMinutes, pauseCreditMs } from '@/lib/sla/business-hours'
import { slaClockStart } from '@/lib/sla/resolve'
import { updateRequestStatus } from '@/lib/actions/requests'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
let fx: D03Fixtures
const made: string[] = []
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)

beforeAll(async () => {
  fx = await setupD03Fixtures()
  vi.mocked(createClient).mockImplementation(async () => { throw new Error('no browser session') })
}, 180_000)

afterAll(async () => {
  if (made.length) {
    await db().from('request_time_entries').delete().in('request_id', made)
    await db().from('request_activity').delete().in('request_id', made)
    await db().from('request_comments').delete().in('request_id', made)
    await db().from('requests').delete().in('id', made)
  }
  await fx?.cleanup()
}, 180_000)

const newTicket = async (status: string, extra: Record<string, unknown> = {}) => {
  const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: status as never })
  made.push(t.id)
  if (Object.keys(extra).length) await db().from('requests').update(extra).eq('id', t.id)
  return t.id as string
}

describe('B-01: a caller with no browser session gets a deadline', () => {
  it('computeSLADeadline works although the cookie-bound client would throw', async () => {
    const d = await computeSLADeadline(new Date(), 120)
    expect(d).not.toBeNull()
    expect(d!.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('F-28: no minute is lost at midnight on an all-day calendar', () => {
  it('24 hours of business time from a start is 24 hours of business time to the deadline', async () => {
    const start = new Date(2031, 2, 10, 10, 59, 0)
    const d = await computeSLADeadline(start, 24 * 60)
    expect(d).not.toBeNull()
    const elapsed = await computeElapsedBusinessMinutes(start, d!)
    expect(elapsed).toBe(24 * 60)
  })
})

describe('F-13: a pause is credited once, in the deadline and in the ledger', () => {
  it('waiting on the user for 2 hours moves the deadline by 2 hours and the ledger by 2 hours', async () => {
    const due = new Date(Date.now() + 24 * 3_600_000)
    const id = await newTicket('in_progress', { resolution_due_at: due.toISOString(), response_due_at: due.toISOString(), responded_at: new Date().toISOString() })

    actAs(fx.agentA)
    expect((await updateRequestStatus(id, 'waiting_user', 'Please send the photo of the cable.')).error).toBeUndefined()
    // pretend the pause started two hours ago
    const since = new Date(Date.now() - 2 * 3_600_000)
    await db().from('requests').update({ waiting_since: since.toISOString() }).eq('id', id)
    expect((await updateRequestStatus(id, 'in_progress', 'Photo received, continuing.')).error).toBeUndefined()

    const row = (await db().from('requests').select('resolution_due_at, paused_ms_total, waiting_since').eq('id', id).single()).data
    const credit = await pauseCreditMs(since, new Date())
    expect(row.waiting_since).toBeNull()
    expect(Math.abs(Number(row.paused_ms_total) - credit)).toBeLessThan(60_000)
    // The deadline is a business-time deadline, so the pause moves it by the same amount of BUSINESS time (not calendar time: a deadline that falls
    // outside business hours, such as over a weekend, lands on the next working time). The business time between the old and the new deadline is the credit, once.
    const movedMinutes = await computeElapsedBusinessMinutes(due, new Date(row.resolution_due_at))
    expect(Math.abs(movedMinutes * 60_000 - credit)).toBeLessThan(120_000)
  })
})

describe('a reopened ticket\'s SLA clock starts at the reopen', () => {
  it('slaClockStart is the last "reopened" entry, and the creation for a ticket never reopened', async () => {
    const id = await newTicket('open')
    const created = (await db().from('requests').select('created_at').eq('id', id).single()).data.created_at as string
    expect((await slaClockStart(db(), { id, created_at: created, reopen_count: 0 })).toISOString()).toBe(new Date(created).toISOString())

    await db().from('requests').update({ reopen_count: 1 }).eq('id', id)
    const at = new Date(Date.now() + 5 * 60_000).toISOString()
    await db().from('request_activity').insert({ request_id: id, actor_id: fx.agentA.id, action: 'reopened', metadata: {}, created_at: at })
    const start = await slaClockStart(db(), { id, created_at: created, reopen_count: 1 })
    expect(start.toISOString()).toBe(new Date(at).toISOString())
  })
})
