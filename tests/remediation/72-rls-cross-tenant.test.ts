// Migration 158 changed how the ticket row-security rule is evaluated. This proves, with a real second organization, that organizations still cannot
// see or change each other's tickets (read, count, search, update, delete), for an ordinary user and for an administrator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API, ANON, asUser, svc, http, login, createUser, deleteUser, ORG_A, SERVICE, type Session } from './helpers'

const tag = Date.now()
let orgB: string
let adminB: Session, staffB: Session, adminA: Session, managerA: Session, staffA: Session
let ticketB: string, ticketA: string
const extraUsers: string[] = []

beforeAll(async () => {
  ;[adminA, managerA, staffA] = await Promise.all(['admin1', 'manager1', 'staff1'].map((n) => login(`${n}@audit.test`)))
  orgB = (await svc<{ id: string }[]>('POST', '/organizations', { name: `Tenant B ${tag}`, slug: `tenant-b-${tag}`, status: 'active', seat_limit: 5 }, { Prefer: 'return=representation' })).json[0].id
  adminB = await createUser(`tenantb-admin-${tag}@audit.test`, 'Tenant B Admin')
  staffB = await createUser(`tenantb-staff-${tag}@audit.test`, 'Tenant B Staff')
  extraUsers.push(adminB.id, staffB.id)
  await svc('PATCH', `/profiles?id=eq.${adminB.id}`, { org_id: orgB, role: 'admin', is_active: true })
  await svc('PATCH', `/profiles?id=eq.${staffB.id}`, { org_id: orgB, role: 'user', is_active: true })
  const service = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
  const mk = async (title: string, requester: string, org: string) =>
    (await svc<{ id: string }[]>('POST', '/requests', { title, requester_id: requester, service_id: service.id, team_id: service.team_id, org_id: org, status: 'open' }, { Prefer: 'return=representation' })).json[0].id
  ticketB = await mk(`tenant-b ticket ${tag}`, staffB.id, orgB)
  ticketA = await mk(`tenant-a ticket ${tag}`, staffA.id, ORG_A)
}, 120_000)

afterAll(async () => {
  await svc('DELETE', `/requests?id=in.(${ticketA},${ticketB})`).catch(() => {})
  for (const id of extraUsers) await deleteUser(id)
  await http('POST', '/rest/v1/rpc/owner_delete_org', { key: SERVICE, token: SERVICE, body: { p_org_id: orgB } })
}, 120_000)

describe('organizations cannot see or change each other\'s tickets', () => {
  it('an administrator of organization B sees only organization B tickets', async () => {
    const r = await asUser<{ id: string; org_id: string }[]>(adminB, 'GET', '/requests?select=id,org_id&limit=1000')
    expect(r.status).toBe(200)
    expect(r.json.map((x) => x.id)).toEqual([ticketB])
    expect(r.json.every((x) => x.org_id === orgB)).toBe(true)
  })
  it('a requester of organization B sees only their own ticket', async () => {
    const r = await asUser<{ id: string }[]>(staffB, 'GET', '/requests?select=id&limit=1000')
    expect(r.json.map((x) => x.id)).toEqual([ticketB])
  })
  it('organization A (manager, administrator, requester) cannot see organization B\'s ticket, directly or by search', async () => {
    for (const s of [adminA, managerA, staffA]) {
      const direct = await asUser<unknown[]>(s, 'GET', `/requests?id=eq.${ticketB}&select=id`)
      expect(direct.json, s.email).toEqual([])
      const search = await asUser<unknown[]>(s, 'GET', `/requests?title=ilike.*tenant-b*&select=id&limit=50`)
      expect(search.json, s.email).toEqual([])
    }
  })
  it('exact counts do not leak across organizations', async () => {
    const count = async (s: Session) => {
      const r = await fetch(`${API}/rest/v1/requests?select=id`, { method: 'HEAD', headers: { apikey: ANON, Authorization: `Bearer ${s.token}`, Prefer: 'count=exact' } })
      return r.headers.get('content-range')
    }
    expect(await count(adminB)).toMatch(/\/1$/) // organization B has exactly one ticket
    expect(await count(staffB)).toMatch(/\/1$/)
    const a = await count(adminA)
    expect(a).toMatch(/\/\d+$/)
    expect(Number(a!.split('/')[1])).toBeGreaterThan(1)
  })
  it('an administrator of organization B cannot change or delete an organization A ticket', async () => {
    const patch = await asUser<unknown[]>(adminB, 'PATCH', `/requests?id=eq.${ticketA}`, { title: 'hijacked' }, { Prefer: 'return=representation' })
    expect(patch.status === 200 ? patch.json : []).toHaveLength(0)
    const del = await asUser<unknown[]>(adminB, 'DELETE', `/requests?id=eq.${ticketA}`, undefined, { Prefer: 'return=representation' })
    expect(del.status === 200 ? del.json : []).toHaveLength(0)
    const still = await svc<{ title: string }[]>('GET', `/requests?id=eq.${ticketA}&select=title`)
    expect(still.json[0].title).toBe(`tenant-a ticket ${tag}`)
  })
  it('an administrator of organization B cannot move their own ticket into organization A', async () => {
    const r = await asUser(adminB, 'PATCH', `/requests?id=eq.${ticketB}`, { org_id: ORG_A })
    expect([200, 204, 401, 403]).toContain(r.status)
    const row = await svc<{ org_id: string }[]>('GET', `/requests?id=eq.${ticketB}&select=org_id`)
    expect(row.json[0].org_id).toBe(orgB)
  })
})
