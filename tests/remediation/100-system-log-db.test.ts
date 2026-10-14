// System Log (migration 160), database side: append-only, who can read it, the hash chain and its tamper detection, the audit triggers, secret
// redaction and the archive. Runs only against the audit stack.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { anon, asUser, svc, http, login, createUser, deleteUser, ORG_A, SERVICE, type Session } from './helpers'

const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const tag = `slog-${Date.now()}`
let admin: Session, manager: Session, staff: Session, adminB: Session
let orgB: string
const extraUsers: string[] = []
const rpc = <T = unknown>(fn: string, body: unknown = {}) => http<T>('POST', `/rest/v1/rpc/${fn}`, { key: SERVICE, token: SERVICE, body })
const rowsByTag = async () => (await svc<{ id: number; action: string; before_data: unknown; after_data: unknown; row_hash: string | null; prev_hash: string | null }[]>('GET', `/system_log?action=like.${tag}*&order=id.asc`)).json

beforeAll(async () => {
  ;[admin, manager, staff] = await Promise.all(['admin1', 'manager1', 'staff1'].map((n) => login(`${n}@audit.test`)))
  orgB = (await svc<{ id: string }[]>('POST', '/organizations', { name: `SysLog B ${tag}`, slug: tag, status: 'active', seat_limit: 5 }, { Prefer: 'return=representation' })).json[0].id
  adminB = await createUser(`${tag}-adminb@audit.test`, 'SysLog Admin B')
  extraUsers.push(adminB.id)
  await svc('PATCH', `/profiles?id=eq.${adminB.id}`, { org_id: orgB, role: 'admin', is_active: true })
}, 120_000)

afterAll(async () => {
  psql('alter table system_log enable trigger trg_system_log_guard')
  psql('alter table system_log enable trigger trg_system_log_chain')
  for (const id of extraUsers) await deleteUser(id)
  await http('POST', '/rest/v1/rpc/owner_delete_org', { key: SERVICE, token: SERVICE, body: { p_org_id: orgB } })
}, 120_000)

const entry = (action: string, extra: Record<string, unknown> = {}) => ({ org_id: ORG_A, category: 'audit', source: 'admin', action: `${tag}.${action}`, ...extra })

describe('append-only', () => {
  it('nobody can change or delete a row, not even the server key; truncate is refused too', async () => {
    const ins = await svc<{ id: number }[]>('POST', '/system_log', entry('immutable', { message: 'original' }), { Prefer: 'return=representation' })
    expect(ins.status).toBe(201)
    const id = ins.json[0].id
    const upd = await svc('PATCH', `/system_log?id=eq.${id}`, { message: 'changed' })
    expect(upd.status).toBeGreaterThanOrEqual(400)
    const del = await svc('DELETE', `/system_log?id=eq.${id}`)
    expect(del.status).toBeGreaterThanOrEqual(400)
    expect((await svc<{ message: string }[]>('GET', `/system_log?id=eq.${id}`)).json[0].message).toBe('original')
    expect(() => psql('truncate system_log')).toThrow()
  })
  it('signed-in and anonymous users cannot write', async () => {
    for (const s of [admin, manager, staff]) expect((await asUser(s, 'POST', '/system_log', entry('forged'))).status, s.email).toBeGreaterThanOrEqual(400)
    expect((await anon('POST', '/system_log', entry('forged'))).status).toBeGreaterThanOrEqual(400)
    expect((await rowsByTag()).filter((r) => r.action.endsWith('.forged'))).toHaveLength(0)
  })
})

describe('deleting an organization', () => {
  it('keeps the audit rows of that organization and leaves the chain intact (owner_delete_org skips the log)', async () => {
    const org = (await svc<{ id: string }[]>('POST', '/organizations', { name: `SysLog gone ${tag}`, slug: `${tag}-gone`, status: 'active', seat_limit: 5 }, { Prefer: 'return=representation' })).json[0].id
    await svc('POST', '/system_log', { org_id: org, category: 'audit', source: 'admin', action: `${tag}.before_org_delete` })
    const first = (await svc<{ id: number }[]>('GET', `/system_log?action=eq.${tag}.before_org_delete&select=id`)).json[0].id
    await svc('POST', '/system_log', entry('after_org_delete_marker'))
    await http('POST', '/rest/v1/rpc/owner_delete_org', { key: SERVICE, token: SERVICE, body: { p_org_id: org } })
    expect((await svc<unknown[]>('GET', `/system_log?action=eq.${tag}.before_org_delete`)).json).toHaveLength(1)
    expect((await rpc<unknown[]>('system_log_verify_chain', { p_from_id: first })).json).toEqual([])
  })
})

describe('who can read it', () => {
  it('an administrator reads their own organization; a manager, a requester and another organization\'s administrator read nothing of it', async () => {
    const seen = await asUser<unknown[]>(admin, 'GET', `/system_log?action=like.${tag}*&select=id`)
    expect(seen.status).toBe(200)
    expect(seen.json.length).toBeGreaterThan(0)
    for (const s of [manager, staff, adminB]) {
      const r = await asUser<unknown[]>(s, 'GET', `/system_log?action=like.${tag}*&select=id`)
      expect(r.status === 200 ? r.json : [], s.email).toHaveLength(0)
    }
    expect((await anon<unknown[]>('GET', '/system_log?select=id&limit=1')).status).toBeGreaterThanOrEqual(400)
  })
})

describe('hash chain', () => {
  it('audit rows are chained and verify intact; a changed row and a removed row are found', async () => {
    for (const n of ['chain1', 'chain2', 'chain3']) expect((await svc('POST', '/system_log', entry(n, { after_data: { n } }))).status).toBe(201)
    const rows = (await rowsByTag()).filter((r) => /chain\d$/.test(r.action))
    expect(rows).toHaveLength(3)
    expect(rows[1].prev_hash).toBe(rows[0].row_hash)
    expect(rows[2].prev_hash).toBe(rows[1].row_hash)
    const first = rows[0].id
    expect((await rpc<unknown[]>('system_log_verify_chain', { p_from_id: first })).json).toEqual([])

    // an edit made by someone with database access (the guard trigger switched off) is detected
    psql('alter table system_log disable trigger trg_system_log_guard')
    try {
      psql(`update system_log set after_data = '{"n":"forged"}' where id = ${rows[1].id}`)
      const broken = (await rpc<{ broken_id: number; reason: string }[]>('system_log_verify_chain', { p_from_id: first })).json
      expect(broken[0].broken_id).toBe(rows[1].id)
      psql(`update system_log set after_data = '{"n":"chain2"}' where id = ${rows[1].id}`)
      expect((await rpc<unknown[]>('system_log_verify_chain', { p_from_id: first })).json).toEqual([])

      // a removed row is found as well
      const saved = psql(`select row_to_json(s) from system_log s where id = ${rows[1].id}`)
      psql(`delete from system_log where id = ${rows[1].id}`)
      const gap = (await rpc<{ broken_id: number }[]>('system_log_verify_chain', { p_from_id: first })).json
      expect(gap[0].broken_id).toBe(rows[2].id)
      psql('alter table system_log disable trigger trg_system_log_chain') // the row goes back exactly as it was, not re-hashed
      try {
        psql(`insert into system_log overriding system value select * from json_populate_record(null::system_log, '${saved.replace(/'/g, "''")}')`)
      } finally {
        psql('alter table system_log enable trigger trg_system_log_chain')
      }
      expect((await rpc<unknown[]>('system_log_verify_chain', { p_from_id: first })).json).toEqual([])
    } finally {
      psql('alter table system_log enable trigger trg_system_log_guard')
    }
  })
})

describe('database audit triggers', () => {
  it('a role change by the server is recorded with before and after, and a change to a column that is not watched is not', async () => {
    const before = psql(`select count(*) from system_log where entity_type='profiles' and entity_id='${staff.id}'`)
    await svc('PATCH', `/profiles?id=eq.${staff.id}`, { role: 'agent' })
    await svc('PATCH', `/profiles?id=eq.${staff.id}`, { role: 'user' })
    const rows = (await svc<{ action: string; category: string; source: string; before_data: Record<string, string>; after_data: Record<string, string>; detail: { changed_columns: string[] } }[]>('GET', `/system_log?entity_type=eq.profiles&entity_id=eq.${staff.id}&order=id.desc&limit=2`)).json
    expect(Number(before)).toBeGreaterThanOrEqual(0)
    expect(rows[1]).toMatchObject({ action: 'profiles.update', category: 'security', source: 'database', before_data: { role: 'user' }, after_data: { role: 'agent' } })
    expect(rows[1].detail.changed_columns).toEqual(['role'])
    expect(rows[0]).toMatchObject({ before_data: { role: 'agent' }, after_data: { role: 'user' } })
    // updated_at alone is noise
    const count = () => Number(psql(`select count(*) from system_log where entity_type='profiles' and entity_id='${staff.id}'`))
    const n = count()
    psql(`update profiles set updated_at = now() where id = '${staff.id}'`)
    expect(count()).toBe(n)
  })
  it('a ticket records only its key fields and its status / assignment changes', async () => {
    const service = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
    const t = (await svc<{ id: string }[]>('POST', '/requests', { title: `${tag} ticket`, description: 'private text that must not be copied', requester_id: staff.id, service_id: service.id, team_id: service.team_id, org_id: ORG_A, status: 'open' }, { Prefer: 'return=representation' })).json[0].id
    try {
      await svc('PATCH', `/requests?id=eq.${t}`, { status: 'in_progress' })
      const rows = (await svc<{ action: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null }[]>('GET', `/system_log?entity_type=eq.requests&entity_id=eq.${t}&order=id.asc`)).json
      expect(rows.map((r) => r.action)).toEqual(['requests.insert', 'requests.update'])
      expect(Object.keys(rows[0].after_data!).sort()).toEqual(['assigned_to', 'id', 'org_id', 'priority', 'request_no', 'requester_id', 'service_id', 'status', 'team_id'])
      expect(JSON.stringify(rows[0])).not.toContain('private text')
      expect(rows[1]).toMatchObject({ before_data: { status: 'open' }, after_data: { status: 'in_progress' } })
    } finally {
      await svc('DELETE', `/requests?id=eq.${t}`)
    }
  })
  it('secret-looking columns are never copied and long values are shortened', () => {
    const out = JSON.parse(psql(`select system_log_clean('{"password":"hunter2","api_key":"k","smtp_secret":"s","name":"ok","note":"${'x'.repeat(1500)}"}'::jsonb)`))
    expect(out.password).toBe('[redacted]'); expect(out.api_key).toBe('[redacted]'); expect(out.smtp_secret).toBe('[redacted]')
    expect(out.name).toBe('ok')
    expect(out.note.length).toBeLessThan(1100)
  })
})

describe('retention', () => {
  it('old errors and very old audit rows move to the archive; recent rows stay; only the server can run it', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
    const ancient = new Date(Date.now() - 8 * 365 * 86_400_000).toISOString()
    await svc('POST', '/system_log', { org_id: ORG_A, category: 'error', source: 'app_server', severity: 'error', outcome: 'failure', action: `${tag}.old_error`, created_at: old })
    await svc('POST', '/system_log', entry('ancient_audit', { created_at: ancient }))
    await svc('POST', '/system_log', entry('recent_audit'))
    await svc('POST', '/system_log', { org_id: ORG_A, category: 'error', source: 'app_server', severity: 'error', outcome: 'failure', action: `${tag}.recent_error` })
    expect((await asUser(admin, 'POST', '/rpc/system_log_archive_old', {})).status).toBeGreaterThanOrEqual(400)
    const moved = await rpc<number>('system_log_archive_old', {})
    expect(Number(moved.json)).toBeGreaterThanOrEqual(2)
    const left = (await rowsByTag()).map((r) => r.action)
    expect(left).not.toContain(`${tag}.old_error`); expect(left).not.toContain(`${tag}.ancient_audit`)
    expect(left).toContain(`${tag}.recent_audit`); expect(left).toContain(`${tag}.recent_error`)
    const archived = (await svc<{ action: string }[]>('GET', `/system_log_archive?action=like.${tag}*`)).json.map((r) => r.action)
    expect(archived).toEqual(expect.arrayContaining([`${tag}.old_error`, `${tag}.ancient_audit`]))
    // archived rows cannot be changed either
    expect((await svc('DELETE', `/system_log_archive?action=like.${tag}*`)).status).toBeGreaterThanOrEqual(400)
  })
})
