// QA 2026-11 — creates the test personas in the DISPOSABLE audit database (synthetic @audit.test accounts, one shared synthetic password).
// Refuses to run against anything but the isolated audit stack (127.0.0.1:55421). Safe to run again. `--remove` deletes the personas.
//   node docs/qa-full-audit-2026-11/seed/seed-personas.mjs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ROOT = 'D:/ANKUR AI PROJECTS/CitykartDesk-ZOHO Alternate'
const { createClient } = createRequire(`${ROOT}/package.json`)('@supabase/supabase-js')
const env = Object.fromEntries(
  readFileSync(`${ROOT}/audit-2026-10/env/.env.audit`, 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(url)) throw new Error(`Refusing: ${url} is not the isolated audit stack.`)
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
export const QA_PASSWORD = 'QA-Audit-Pw-2026!'
const ORG = '00000000-0000-0000-0000-000000000001'
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }

const PEOPLE = [
  { key: 'store',    email: 'qa11.store@audit.test',    name: 'QA11 Store Requester',   role: 'user',           loc: 'QA STORES', store: true },
  { key: 'ho',       email: 'qa11.ho@audit.test',       name: 'QA11 HO Requester',      role: 'user',           loc: 'QA HEAD OFFICE' },
  { key: 'tech',     email: 'qa11.tech@audit.test',     name: 'QA11 Technician One',    role: 'agent',          loc: 'QA HEAD OFFICE', teams: ['QA IT Group', 'QA Admin Group', 'ADMIN GROUP', 'IT SUPPORT'] },
  { key: 'tech2',    email: 'qa11.tech2@audit.test',    name: 'QA11 Technician Two',    role: 'agent',          loc: 'QA HEAD OFFICE', teams: ['QA IT Group', 'QA Admin Group', 'ADMIN GROUP', 'IT SUPPORT'] },
  { key: 'techmgr',  email: 'qa11.techmgr@audit.test',  name: 'QA11 Technician Manager', role: 'manager',       loc: 'QA HEAD OFFICE', teams: ['QA IT Group', 'QA Admin Group'] },
  { key: 'approver', email: 'qa11.approver@audit.test', name: 'QA11 Approver',          role: 'manager',        loc: 'QA HEAD OFFICE' },
  { key: 'admin',    email: 'qa11.admin@audit.test',    name: 'QA11 Administrator',     role: 'admin',          loc: 'QA HEAD OFFICE' },
  { key: 'owner',    email: 'qa11.owner@audit.test',    name: 'QA11 Platform Owner',    role: 'platform_owner', loc: 'QA HEAD OFFICE' },
  { key: 'vtech',    email: 'qa11.vtech@audit.test',    name: 'QA11 Vendor Technician', role: 'user', vendor: ['QA11 Vendor Co', 'technician'] },
  { key: 'vtech2',   email: 'qa11.vtech2@audit.test',   name: 'QA11 Vendor Technician Two', role: 'user', vendor: ['QA11 Vendor Co', 'technician'] },
  { key: 'vmgr',     email: 'qa11.vmgr@audit.test',     name: 'QA11 Vendor Manager',    role: 'user', vendor: ['QA11 Vendor Co', 'manager'] },
  { key: 'vother',   email: 'qa11.vother@audit.test',   name: 'QA11 Other Vendor Technician', role: 'user', vendor: ['QA11 Other Vendor', 'technician'] },
]

const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 2000 })
const byEmail = new Map((list?.users ?? []).map((u) => [u.email, u.id]))

if (process.argv.includes('--remove')) {
  for (const p of PEOPLE) {
    const id = byEmail.get(p.email); if (!id) continue
    await db.from('team_members').delete().eq('user_id', id)
    await db.from('profiles').delete().eq('id', id)
    await db.auth.admin.deleteUser(id)
    console.log('removed', p.email)
  }
  process.exit(0)
}

const locs = Object.fromEntries(must(await db.from('locations').select('id, name').in('name', ['QA STORES', 'QA HEAD OFFICE']), 'locations').map((l) => [l.name, l.id]))
const store = must(await db.from('stores').select('id, code').eq('org_id', ORG).order('code').limit(1).single(), 'store')
const teams = Object.fromEntries(must(await db.from('teams').select('id, name').eq('org_id', ORG), 'teams').map((t) => [t.name, t.id]))
const vendorIds = {}
for (const name of ['QA11 Vendor Co', 'QA11 Other Vendor']) {
  const have = must(await db.from('vendor_companies').select('id').eq('org_id', ORG).eq('name', name), 'vendor read')[0]
  vendorIds[name] = have?.id ?? must(await db.from('vendor_companies').insert({ org_id: ORG, name }).select('id').single(), 'vendor insert').id
}

for (const p of PEOPLE) {
  let id = byEmail.get(p.email)
  if (!id) {
    const made = await db.auth.admin.createUser({ email: p.email, password: QA_PASSWORD, email_confirm: true, user_metadata: { full_name: p.name } })
    if (made.error) throw new Error(`create ${p.email}: ${made.error.message}`)
    id = made.data.user.id
  } else await db.auth.admin.updateUserById(id, { password: QA_PASSWORD, email_confirm: true })
  must(await db.from('profiles').upsert({
    id, org_id: ORG, role: p.role, full_name: p.name, is_active: true, must_reset_password: false,
    location_id: p.loc ? locs[p.loc] : null,
    store_id: p.store ? store.id : null,
    vendor_company_id: p.vendor ? vendorIds[p.vendor[0]] : null,
    vendor_role: p.vendor ? p.vendor[1] : null,
  }), `profile ${p.email}`)
  for (const tn of p.teams ?? []) {
    if (!teams[tn]) { console.log('  (no such team', tn, ')'); continue }
    const has = must(await db.from('team_members').select('user_id').eq('team_id', teams[tn]).eq('user_id', id), 'team read')
    if (!has.length) must(await db.from('team_members').insert({ team_id: teams[tn], user_id: id, org_id: ORG }), 'team insert')
  }
  console.log('ready:', p.email.padEnd(28), p.role.padEnd(15), p.vendor ? `vendor ${p.vendor[1]}` : '')
}
// the technicians report to the technician manager (org chart)
const mgr = byEmail.get('qa11.techmgr@audit.test') ?? (await db.auth.admin.listUsers({ page: 1, perPage: 2000 })).data.users.find((u) => u.email === 'qa11.techmgr@audit.test')?.id
for (const e of ['qa11.tech@audit.test', 'qa11.tech2@audit.test']) {
  const u = (await db.auth.admin.listUsers({ page: 1, perPage: 2000 })).data.users.find((x) => x.email === e)
  if (u && mgr) await db.from('profiles').update({ manager_id: mgr }).eq('id', u.id)
}
console.log('personas ready. password is the synthetic one in this script (QA_PASSWORD).')
