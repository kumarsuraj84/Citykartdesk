// D-023 (migration 163) + remediation phase 2 (migration 165): ticket status moves.
//  - Since migration 165 a signed-in user has NO direct write right on tickets at all (the server writes them, after its own role and transition checks), so every
//    direct status change through the API is refused whatever the role, and nothing changes.
//  - The database's list of allowed moves (request_status_transition_allowed, still in force as a second line of defence) is tested here as a function.
//  - The server (service role) can still do what only it may (e.g. auto-close). The moves the screens offer are tested through the real actions in
//    90-uat-lifecycle and 114-status-races.

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
const move = (u: TestUser, id: string, body: Record<string, unknown>) =>
  http<unknown>('PATCH', `/rest/v1/requests?id=eq.${id}`, { token: u.accessToken, body, headers: { Prefer: 'return=representation' } })
const statusOf = async (id: string) => (await db.from('requests').select('status').eq('id', id).single()).data!.status
const refused = (r: { status: number; text: string }) => r.status >= 400 || r.text.trim() === '[]'

describe('direct ticket writes by a signed-in user (migration 165)', () => {
  it('nobody — requester, technician, manager, administrator — can move a ticket through the API', async () => {
    for (const [label, who, from, to] of [
      ['requester', fx.requesterA, 'open', 'resolved'], ['requester', fx.requesterA, 'open', 'cancelled'],
      ['technician', fx.agentA, 'in_progress', 'waiting_user'], ['technician', fx.agentA, 'open', 'cancelled'], ['technician', fx.agentA, 'in_progress', 'closed'],
      ['manager', fx.manager, 'in_progress', 'resolved'], ['administrator', fx.admin, 'resolved', 'closed'],
    ] as const) {
      const id = await ticket(from)
      const r = await move(who, id, { status: to })
      expect(refused(r), `${label} ${from} -> ${to}: ${r.status} ${r.text}`).toBe(true)
      expect(await statusOf(id), `${label} ${from} -> ${to}`).toBe(from)
    }
  })

  it('nobody can change any other protected column either (assignee, description, form answers, timestamps, counters)', async () => {
    const id = await ticket('in_progress')
    const before = (await db.from('requests').select('assigned_to, description, form_data, resolved_at, reopen_count, category_id, waiting_since').eq('id', id).single()).data!
    for (const who of [fx.agentA, fx.manager, fx.admin, fx.requesterA]) {
      for (const body of [
        { assigned_to: fx.requesterB.id }, { description: 'rewritten by an insider' }, { form_data: { x: 'y' } }, { resolved_at: new Date().toISOString() },
        { reopen_count: 5 }, { waiting_since: new Date().toISOString() },
      ]) {
        const r = await move(who, id, body)
        expect(refused(r), `${who.email} ${JSON.stringify(body)}: ${r.status}`).toBe(true)
      }
    }
    const after = (await db.from('requests').select('assigned_to, description, form_data, resolved_at, reopen_count, category_id, waiting_since').eq('id', id).single()).data!
    expect(after).toEqual(before)
  })

  it('nobody can create or delete a ticket through the API', async () => {
    const ins = await http<unknown>('POST', '/rest/v1/requests', { token: fx.requesterA.accessToken, body: { title: 'direct', requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id }, headers: { Prefer: 'return=representation' } })
    expect(ins.status).toBeGreaterThanOrEqual(400)
    const id = await ticket('open')
    for (const who of [fx.requesterA, fx.agentA, fx.manager, fx.admin]) {
      const del = await http<unknown>('DELETE', `/rest/v1/requests?id=eq.${id}`, { token: who.accessToken, headers: { Prefer: 'return=representation' } })
      expect(refused(del), who.email).toBe(true)
    }
    expect(await statusOf(id)).toBe('open')
  })

  it('the server (service role) can still do what only it may, such as auto-close', async () => {
    const t = await ticket('resolved')
    const server = await db.from('requests').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', t)
    expect(server.error).toBeNull()
    expect(await statusOf(t)).toBe('closed')
  })
})

describe('the database list of allowed status moves (second line of defence, migration 163)', () => {
  const allowed = async (from: string, to: string) =>
    (await http<boolean>('POST', '/rest/v1/rpc/request_status_transition_allowed', { token: fx.agentA.accessToken, body: { p_from: from, p_to: to } })).text.trim() === 'true'
  it('refuses moves the screens never offer', async () => {
    for (const [from, to] of [['in_progress', 'closed'], ['resolved', 'closed'], ['cancelled', 'open'], ['cancelled', 'in_progress'], ['hold_purchase_ho', 'waiting_user']]) {
      expect(await allowed(from, to), `${from} -> ${to}`).toBe(false)
    }
  })
  it('allows every move the screens offer', async () => {
    for (const [from, to] of [['in_progress', 'waiting_user'], ['waiting_user', 'in_progress'], ['in_progress', 'hold_purchase_ho'], ['hold_purchase_ho', 'in_progress'], ['in_progress', 'resolved'], ['resolved', 'open'], ['open', 'assigned'], ['assigned', 'in_progress'], ['open', 'cancelled']]) {
      expect(await allowed(from, to), `${from} -> ${to}`).toBe(true)
    }
  })
})
