// Audit findings D-002, D-003, D-007 (Critical, database). Each one was reproduced live in the audit; these are the regression tests.
// NEGATIVE: the original attacks are refused. POSITIVE: the legitimate workflows still work.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { anon, asUser, svc, http, login, createUser, deleteUser, profileRow, ORG_A, SERVICE, type Session } from './helpers'

let admin: Session, manager: Session, agent: Session, staff: Session
let snapshot: Record<string, unknown>[] = []
const tag = Date.now()
const extraOrgs: string[] = []
const extraUsers: string[] = []

async function makeOrg(name: string) {
  const r = await svc<{ id: string }[]>('POST', '/organizations', { name: `${name} ${tag}`, slug: `${name}-${tag}`.toLowerCase().replace(/\s+/g, '-'), status: 'active', seat_limit: 5 }, { Prefer: 'return=representation' })
  const id = r.json[0].id
  extraOrgs.push(id)
  return id
}
const orgExists = async (id: string) => (await svc<unknown[]>('GET', `/organizations?id=eq.${id}&select=id`)).json.length === 1

beforeAll(async () => {
  ;[admin, manager, agent, staff] = await Promise.all(['admin1', 'manager1', 'agent1', 'staff1'].map((n) => login(`${n}@audit.test`)))
  // the synthetic accounts are put back exactly as they were, whatever a test (or a failing attack) did to them
  snapshot = await Promise.all([admin, manager, agent, staff].map((u) => profileRow(u.id)))
})
afterAll(async () => {
  for (const row of snapshot) if (row) await svc('PATCH', `/profiles?id=eq.${row.id}`, { role: row.role, org_id: row.org_id, is_active: row.is_active, must_reset_password: row.must_reset_password, employee_id: row.employee_id, manager_id: row.manager_id, full_name: row.full_name })
  for (const id of extraUsers) await deleteUser(id)
  for (const id of extraOrgs) await http('POST', '/rest/v1/rpc/owner_delete_org', { key: SERVICE, token: SERVICE, body: { p_org_id: id } })
})

describe('D-002 owner_delete_org: only the server may delete an organization', () => {
  it('anonymous caller cannot delete an organization (original attack)', async () => {
    const org = await makeOrg('anon-target')
    const r = await http('POST', '/rest/v1/rpc/owner_delete_org', { body: { p_org_id: org } })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(await orgExists(org)).toBe(true)
  })
  it('signed-in users of every role cannot delete an organization', async () => {
    const org = await makeOrg('user-target')
    for (const s of [staff, agent, manager, admin]) {
      const r = await http('POST', '/rest/v1/rpc/owner_delete_org', { token: s.token, body: { p_org_id: org } })
      expect(r.status, s.email).toBeGreaterThanOrEqual(400)
    }
    expect(await orgExists(org)).toBe(true)
  })
  it('the server (service role) can still delete an organization', async () => {
    const org = await makeOrg('server-target')
    const r = await http<{ ok: boolean }>('POST', '/rest/v1/rpc/owner_delete_org', { key: SERVICE, token: SERVICE, body: { p_org_id: org } })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(await orgExists(org)).toBe(false)
  })
})

describe('D-007 internal functions are not public', () => {
  it('anonymous and signed-in users cannot burn ticket numbers', async () => {
    expect((await http('POST', '/rest/v1/rpc/generate_request_no', { body: {} })).status).toBeGreaterThanOrEqual(400)
    expect((await http('POST', '/rest/v1/rpc/generate_request_no', { token: staff.token, body: {} })).status).toBeGreaterThanOrEqual(400)
  })
  it('anonymous and signed-in users cannot seed SLA settings for an organization', async () => {
    const org = await makeOrg('sla-target')
    expect((await http('POST', '/rest/v1/rpc/seed_default_sla_config', { body: { p_org_id: org } })).status).toBeGreaterThanOrEqual(400)
    expect((await http('POST', '/rest/v1/rpc/seed_default_sla_config', { token: manager.token, body: { p_org_id: org } })).status).toBeGreaterThanOrEqual(400)
  })
  it('a ticket gets its number from the trigger when the SERVER creates it (a signed-in user has no direct INSERT since the VAPT migration 164)', async () => {
    const s = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
    expect((await asUser(staff, 'POST', '/requests', { title: 'direct insert', requester_id: staff.id, org_id: ORG_A, service_id: s.id, team_id: s.team_id }, { Prefer: 'return=representation' })).status).toBeGreaterThanOrEqual(400)
    const r = await svc<{ id: string; request_no: string }[]>('POST', '/requests', { title: 'remediation positive', requester_id: staff.id, org_id: ORG_A, service_id: s.id, team_id: s.team_id }, { Prefer: 'return=representation' })
    expect(r.status).toBe(201)
    expect(r.json[0].request_no).toMatch(/^CKSD-\d{6,}$/)
    await svc('DELETE', `/requests?id=eq.${r.json[0].id}`)
  })
  it('the server can still call the helpers', async () => {
    expect((await http('POST', '/rest/v1/rpc/generate_request_no', { key: SERVICE, token: SERVICE, body: {} })).status).toBe(200)
  })
})

describe('D-003 profiles: a user cannot rewrite their own organization, role, active flag or manager', () => {
  let victimOrg: string
  beforeAll(async () => { victimOrg = await makeOrg('profile-tenant-b') })

  it('a technician cannot move themselves into another organization (original attack)', async () => {
    const r = await asUser(agent, 'PATCH', `/profiles?id=eq.${agent.id}`, { org_id: victimOrg })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await profileRow(agent.id)).org_id).toBe(ORG_A)
  })
  it('an admin cannot make themselves platform_owner (original attack)', async () => {
    const r = await asUser(admin, 'PATCH', `/profiles?id=eq.${admin.id}`, { role: 'platform_owner' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await profileRow(admin.id)).role).toBe('admin')
  })
  it('a manager cannot rewrite their own employee id / manager (original attack)', async () => {
    const before = await profileRow(manager.id)
    const r = await asUser(manager, 'PATCH', `/profiles?id=eq.${manager.id}`, { employee_id: 'FORGED', manager_id: admin.id })
    expect(r.status).toBeGreaterThanOrEqual(400)
    const after = await profileRow(manager.id)
    expect(after.employee_id).toBe(before.employee_id)
    expect(after.manager_id).toBe(before.manager_id)
  })
  it('a deactivated user cannot re-activate themselves (original attack)', async () => {
    const u = await createUser(`reactivate-${tag}@audit.test`, 'Reactivate Test'); extraUsers.push(u.id)
    await svc('PATCH', `/profiles?id=eq.${u.id}`, { is_active: false })
    const r = await asUser(u, 'PATCH', `/profiles?id=eq.${u.id}`, { is_active: true })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await profileRow(u.id)).is_active).toBe(false)
  })
  it('a user cannot set the forced-reset flag on themselves, nor change other users', async () => {
    const r1 = await asUser(staff, 'PATCH', `/profiles?id=eq.${staff.id}`, { must_reset_password: true })
    expect(r1.status).toBeGreaterThanOrEqual(400)
    const other = await profileRow(agent.id)
    const r2 = await asUser(staff, 'PATCH', `/profiles?id=eq.${agent.id}`, { full_name: 'Hacked' })
    expect(r2.status >= 400 || (Array.isArray(r2.json) && r2.json.length === 0) || r2.status === 204).toBe(true)
    expect((await profileRow(agent.id)).full_name).toBe(other.full_name)
  })

  it('POSITIVE: a user can still change their own name and avatar', async () => {
    const before = await profileRow(staff.id)
    const r = await asUser(staff, 'PATCH', `/profiles?id=eq.${staff.id}`, { full_name: 'Audit Staff 1 (renamed)', avatar_url: null })
    expect(r.status).toBeLessThan(300)
    expect((await profileRow(staff.id)).full_name).toBe('Audit Staff 1 (renamed)')
    await svc('PATCH', `/profiles?id=eq.${staff.id}`, { full_name: before.full_name })
  })
  it('after setting a new password the SERVER clears the forced-reset flag; the user cannot clear it themselves (VAPT VA-API-02)', async () => {
    const u = await createUser(`clearflag-${tag}@audit.test`, 'Clear Flag'); extraUsers.push(u.id)
    await svc('PATCH', `/profiles?id=eq.${u.id}`, { must_reset_password: true })
    const r = await asUser(u, 'PATCH', `/profiles?id=eq.${u.id}`, { must_reset_password: false })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await profileRow(u.id)).must_reset_password).toBe(true)
    expect((await svc('PATCH', `/profiles?id=eq.${u.id}`, { must_reset_password: false })).status).toBeLessThan(300)
    expect((await profileRow(u.id)).must_reset_password).toBe(false)
  })
  it('POSITIVE: the server (service role) can still change role, active flag, organization fields (the admin screens)', async () => {
    const u = await createUser(`adminflow-${tag}@audit.test`, 'Admin Flow'); extraUsers.push(u.id)
    expect((await svc('PATCH', `/profiles?id=eq.${u.id}`, { role: 'agent', is_active: false, employee_id: 'E-1', manager_id: manager.id })).status).toBeLessThan(300)
    const row = await profileRow(u.id)
    expect(row.role).toBe('agent'); expect(row.is_active).toBe(false); expect(row.employee_id).toBe('E-1')
  })
  it('POSITIVE: reading profiles is unchanged (everyone in the organization can still be listed)', async () => {
    const r = await asUser<unknown[]>(staff, 'GET', '/profiles?select=id,full_name&limit=5')
    expect(r.status).toBe(200)
    expect(r.json.length).toBe(5)
  })
})
