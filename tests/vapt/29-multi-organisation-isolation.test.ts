// Multi-organisation isolation, checked against EVERY table that carries an org_id, with real signed-in users of a second synthetic organisation calling the data
// API directly. Organisation A is the seeded one (thousands of tickets, hundreds of people); organisation B has one administrator and one requester.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, getAdmin, createTestUser, type D03Fixtures } from '../setup/fixtures-d03'
import { http } from '../remediation/helpers'

vi.setConfig({ testTimeout: 600_000 })
const DB = 'supabase_db_ckdesk_audit'
const psql = (sql: string) => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
const tag = `p29-${Date.now()}`
let fx: D03Fixtures
let orgB = '', adminB: { id: string; accessToken: string }, userB: { id: string; accessToken: string }
const created = { users: [] as string[] }
let tables: string[] = []

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const org = await getAdmin().from('organizations').insert({ name: `${tag} Org B`, slug: `${tag}-b`, status: 'active', seat_limit: 5 } as never).select('id').single()
  orgB = org.data!.id
  adminB = await createTestUser('p29-adminb', 'P29 Admin B'); created.users.push(adminB.id)
  userB = await createTestUser('p29-userb', 'P29 User B'); created.users.push(userB.id)
  await getAdmin().from('profiles').update({ org_id: orgB, role: 'admin' }).eq('id', adminB.id)
  await getAdmin().from('profiles').update({ org_id: orgB, role: 'user' }).eq('id', userB.id)
  tables = psql("select table_name from information_schema.columns where table_schema='public' and column_name='org_id' and table_name not in ('organizations') and table_name not like '\\_%' order by 1").split('\n').filter(Boolean)
}, 300_000)
afterAll(async () => {
  for (const id of created.users) { try { await getAdmin().auth.admin.deleteUser(id) } catch { /* best effort */ } }
  await getAdmin().rpc('owner_delete_org', { p_org_id: orgB })
  await fx?.cleanup()
}, 120_000)

describe('an administrator and a requester of organisation B see nothing of organisation A', () => {
  it('covers a meaningful number of tables', () => { expect(tables.length).toBeGreaterThan(40) })

  it('READ: no table returns a single row of organisation A to B\'s administrator or B\'s requester', async () => {
    const leaks: string[] = []
    for (const t of tables) {
      for (const [who, token] of [['admin', adminB.accessToken], ['requester', userB.accessToken]] as const) {
        const r = await http<unknown[]>('GET', `/rest/v1/${t}?org_id=eq.${fx.orgId}&select=org_id&limit=1`, { token })
        if (r.status < 300 && Array.isArray(r.json) && r.json.length > 0) leaks.push(`${t} (${who})`)
      }
    }
    expect(leaks).toEqual([])
    // positive control: the SAME query made by organisation A's own administrator does return A's rows, so "nothing came back" above is isolation, not a broken query
    for (const t of ['requests', 'profiles', 'services', 'teams']) {
      const own = await http<unknown[]>('GET', `/rest/v1/${t}?org_id=eq.${fx.orgId}&select=org_id&limit=1`, { token: fx.admin.accessToken })
      expect(own.status, t).toBe(200)
      expect((own.json as unknown[]).length, t).toBe(1)
    }
  })

  it('READ with no filter: the rows B\'s administrator gets back from the busiest tables are all organisation B\'s (or empty)', async () => {
    for (const t of ['requests', 'profiles', 'request_comments', 'request_activity', 'tasks', 'projects', 'approvals', 'request_attachments', 'notifications', 'saved_reports', 'services', 'teams', 'system_log', 'admin_audit_log']) {
      const r = await http<{ org_id?: string }[]>('GET', `/rest/v1/${t}?select=*&limit=50`, { token: adminB.accessToken })
      if (r.status >= 300) continue                                   // refused outright is fine
      const rows = (Array.isArray(r.json) ? r.json : []) as { org_id?: string }[]
      for (const row of rows) if (row.org_id !== undefined) expect(row.org_id, t).toBe(orgB)
    }
  })

  it('WRITE: B\'s administrator cannot change or delete a row of organisation A in any table (nothing is affected)', async () => {
    const hits: string[] = []
    for (const t of tables) {
      const patch = await http<unknown[]>('PATCH', `/rest/v1/${t}?org_id=eq.${fx.orgId}`, { token: adminB.accessToken, body: { org_id: fx.orgId }, headers: { Prefer: 'return=representation' } })
      if (patch.status < 300 && Array.isArray(patch.json) && patch.json.length > 0) hits.push(`PATCH ${t}`)
      const del = await http<unknown[]>('DELETE', `/rest/v1/${t}?org_id=eq.${fx.orgId}`, { token: adminB.accessToken, headers: { Prefer: 'return=representation' } })
      if (del.status < 300 && Array.isArray(del.json) && del.json.length > 0) hits.push(`DELETE ${t}`)
    }
    expect(hits).toEqual([])
    // and the seeded organisation still has its data
    expect(Number(psql(`select count(*) from requests where org_id='${fx.orgId}'`))).toBeGreaterThan(1000)
  })

  it('WRITE: B\'s administrator cannot create a row that belongs to organisation A', async () => {
    const attempts: [string, object][] = [
      ['requests', { request_no: '', title: 'x', requester_id: adminB.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, org_id: fx.orgId }],
      ['tasks', { title: 'x', created_by: adminB.id, org_id: fx.orgId, task_type: 'personal' }],
      ['services', { name: 'x', slug: `${tag}-x`, team_id: fx.teamA.id, org_id: fx.orgId, form_fields: [], form_sections: [] }],
      ['request_comments', { request_id: fx.requestA.id, author_id: adminB.id, body: 'x', org_id: fx.orgId }],
      ['business_rules', { name: 'x', org_id: fx.orgId, trigger: ['created'], conditions: [], actions: [] }],
      ['app_settings', { key: `${tag}`, value: 'x' }],
    ]
    for (const [t, body] of attempts) {
      const r = await http('POST', `/rest/v1/${t}`, { token: adminB.accessToken, body, headers: { Prefer: 'return=representation' } })
      expect(r.status, t).toBeGreaterThanOrEqual(400)
    }
  })

  it('FUNCTIONS: the home dashboard of B\'s administrator counts only organisation B, even when it claims every role', async () => {
    const r = await http<{ counts?: Record<string, number> }>('POST', '/rest/v1/rpc/get_home_dashboard', { token: adminB.accessToken, body: { p_is_manager: true, p_is_agent: true, p_has_tasks: true } })
    expect(r.status).toBe(200)
    for (const v of Object.values(r.json.counts ?? {})) expect(v).toBe(0)
  })

  it('STORAGE: B\'s administrator cannot read a ticket file of organisation A', async () => {
    const API = process.env.NEXT_PUBLIC_SUPABASE_URL!, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const path = `${fx.requestA.id}/${tag}-a.txt`
    const up = await fetch(`${API}/storage/v1/object/request-attachments/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'text/plain' }, body: 'a-secret' })
    expect(up.status).toBeLessThan(300)
    const row = await getAdmin().from('request_attachments').insert({ request_id: fx.requestA.id, uploaded_by: fx.requesterA.id, file_name: 'a.txt', file_size: 8, mime_type: 'text/plain', storage_path: path }).select('id').single()
    try {
      const own = await fetch(`${API}/storage/v1/object/authenticated/request-attachments/${path}`, { headers: { Authorization: `Bearer ${fx.requesterA.accessToken}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } })
      expect(own.status).toBe(200)
      const other = await fetch(`${API}/storage/v1/object/authenticated/request-attachments/${path}`, { headers: { Authorization: `Bearer ${adminB.accessToken}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } })
      expect(other.status).toBeGreaterThanOrEqual(400)
    } finally {
      await getAdmin().from('request_attachments').delete().eq('id', row.data!.id)
      await fetch(`${API}/storage/v1/object/request-attachments`, { method: 'DELETE', headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) })
    }
  })
})
