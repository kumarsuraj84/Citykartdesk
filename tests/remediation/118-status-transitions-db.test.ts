// D-023: the database itself refuses ticket status moves that the screens never offer, for anyone writing as a signed-in user (API calls made
// directly), while the server's own writes and every move the screens do offer still work. Migration 163.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'
import { http } from './helpers'

let fx: D03Fixtures
const db = getAdmin()
const made: string[] = []

beforeAll(async () => { fx = await setupD03Fixtures() }, 120_000)
afterAll(async () => {
  if (made.length) { await db.from('request_activity').delete().in('request_id', made); await db.from('requests').delete().in('id', made) }
  await fx?.cleanup()
}, 120_000)

const ticket = async (status: string) => {
  const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: status as never })
  made.push(t.id)
  return t.id
}
const move = (u: TestUser, id: string, to: string) =>
  http<{ code?: string; message?: string }[] | { code?: string; message?: string }>('PATCH', `/rest/v1/requests?id=eq.${id}`, { token: u.accessToken, body: { status: to }, headers: { Prefer: 'return=representation' } })
const statusOf = async (id: string) => (await db.from('requests').select('status').eq('id', id).single()).data!.status
const refused = (r: { status: number; text: string }) => r.status >= 400 && /cannot move from/.test(r.text)

describe('ticket status moves checked by the database (D-023)', () => {
  it('a requester cannot move their own ticket through the API at all (row security), and a technician can cancel an open one', async () => {
    const a = await ticket('open')
    const tryResolve = await move(fx.requesterA, a, 'resolved')
    // refused by the database rule, or by row security (no row to update): either way the ticket does not move
    expect(refused(tryResolve) || tryResolve.status >= 400 || tryResolve.text.trim() === '[]', tryResolve.text).toBe(true)
    expect(await statusOf(a)).toBe('open')
    const b = await ticket('open')
    expect((await move(fx.agentA, b, 'cancelled')).status).toBeLessThan(300)
    expect(await statusOf(b)).toBe('cancelled')
  })

  it('a technician cannot jump to closed, cannot close a resolved ticket, and cannot revive a cancelled one', async () => {
    const a = await ticket('in_progress')
    expect(refused(await move(fx.agentA, a, 'closed'))).toBe(true)
    const r = await ticket('resolved')
    expect(refused(await move(fx.agentA, r, 'closed'))).toBe(true)
    const c = await ticket('cancelled')
    expect(refused(await move(fx.agentA, c, 'open'))).toBe(true)
    expect(refused(await move(fx.agentA, c, 'in_progress'))).toBe(true)
    const h = await ticket('hold_purchase_ho')
    expect(refused(await move(fx.agentA, h, 'waiting_user'))).toBe(true)
    for (const id of [a, r, c, h]) expect(await statusOf(id)).not.toBe('closed')
  })

  it('every move the screens offer still works', async () => {
    const t = await ticket('in_progress')
    for (const to of ['waiting_user', 'in_progress', 'hold_purchase_ho', 'in_progress', 'resolved', 'open', 'assigned', 'in_progress', 'resolved']) {
      const r = await move(fx.agentA, t, to)
      expect(r.status, `to ${to}: ${r.text}`).toBeLessThan(300)
    }
    expect(await statusOf(t)).toBe('resolved')
  })

  it('a change that does not touch the status is not affected, and the server may still do what only it may (auto-close)', async () => {
    const t = await ticket('resolved')
    const same = await http('PATCH', `/rest/v1/requests?id=eq.${t}`, { token: fx.agentA.accessToken, body: { priority: 'high' }, headers: { Prefer: 'return=representation' } })
    expect(same.status).toBeLessThan(300)
    const server = await db.from('requests').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', t)
    expect(server.error).toBeNull()
    expect(await statusOf(t)).toBe('closed')
  })
})
