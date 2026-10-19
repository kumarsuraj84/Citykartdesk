// LOCAL DEMO ONLY. Creates a small demo company on the ISOLATED audit stack (never the dev stack, never a real server): users, stores, one AC / admin-repair service with
// the AC-number field that reads the sheet, three categories, and the three sheet sources that point at the sample CSV files in ./sheets.
// Safe to run again. Refuses to run unless the database address is the audit stack (127.0.0.1:55421).
//   node audit-2026-10/demo/seed-demo.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../env/.env.audit', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(url)) throw new Error(`Refusing to seed: ${url} is not the isolated audit stack.`)
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

export const DEMO_PASSWORD = 'Demo-Desk-Pw-2026!'
const ORG = '00000000-0000-0000-0000-000000000001'
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }

async function upsertUser(email, fullName, role, extra = {}) {
  let id
  const created = await admin.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } })
  if (created.error) {
    if (!/already|registered/i.test(created.error.message)) throw new Error(`user ${email}: ${created.error.message}`)
    const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    id = list.data.users.find((u) => u.email === email)?.id
    await admin.auth.admin.updateUserById(id, { password: DEMO_PASSWORD })
  } else id = created.data.user.id
  must(await admin.from('profiles').update({ role, full_name: fullName, org_id: ORG, is_active: true, must_reset_password: false, ...extra }).eq('id', id), `profile ${email}`)
  return id
}
async function pick(table, match, insert) {
  const found = must(await admin.from(table).select('id').match(match).limit(1), `read ${table}`)
  if (found.length) return found[0].id
  return must(await admin.from(table).insert({ ...match, ...insert }).select('id').single(), `insert ${table}`).id
}

const dept = await pick('departments', { org_id: ORG, name: 'Demo Facilities' }, {})
const team = await pick('teams', { org_id: ORG, slug: 'demo-admin-repair' }, { name: 'Demo Admin Repair', prefix: 'DEMO', department_id: dept })

// stores
const stores = {}
for (const [code, name] of [['ALC', 'Alwar City'], ['MAR', 'Marwar Road'], ['COB', 'Cooch Behar'], ['PAR', 'Pakur']]) {
  stores[code] = await pick('stores', { org_id: ORG, code }, { name })
}

// people (all share the demo password; see README-DEMO.md)
const people = {
  admin: await upsertUser('admin.demo@audit.test', 'Demo Admin', 'admin', { department_id: dept }),
  tech: await upsertUser('tech.demo@audit.test', 'Demo Technician', 'agent', { department_id: dept }),
  cvm: await upsertUser('vishal.kumar@audit.test', 'Vishal Kumar (CVM)', 'agent', { department_id: dept }),
  alc: await upsertUser('alc.demo@audit.test', 'ALC Store Manager', 'user', { store_id: stores.ALC }),
  mar: await upsertUser('mar.demo@audit.test', 'MAR Store Manager', 'user', { store_id: stores.MAR }),
  cob: await upsertUser('cob.demo@audit.test', 'COB Store Manager', 'user', { store_id: stores.COB }),
}
for (const uid of [people.tech, people.cvm]) {
  const has = must(await admin.from('team_members').select('user_id').eq('team_id', team).eq('user_id', uid), 'read team members')
  if (!has.length) must(await admin.from('team_members').insert({ team_id: team, user_id: uid, org_id: ORG }), 'team member')
}

// categories (AC and Genset go to the OEM by e-mail from the sheets; Fixture goes to the store's CVM for approval) and their sub-categories
const cats = {}
for (const [key, name, extra] of [['ac', 'AC Repair', { auto_oem_kind: 'ac' }], ['genset', 'Genset Repair', { auto_oem_kind: 'genset' }], ['fixture', 'Fixture (needs CVM approval)', { auto_cvm_approval: true }]]) {
  cats[key] = await pick('service_categories', { org_id: ORG, slug: `demo-${key}` }, { name, ...extra })
  must(await admin.from('service_categories').update({ name, ...extra }).eq('id', cats[key]), 'update category')
}
const subs = {}
for (const [key, name] of [['ac', 'AC not cooling / not working'], ['genset', 'Genset not starting'], ['fixture', 'Fixture request']]) {
  subs[key] = await pick('service_sub_categories', { category_id: cats[key], slug: `demo-sub-${key}` }, { name })
}

// the service: the AC serial number is a dropdown that reads the sheet; Qty exists only for the Fixture category
const fields = [
  { id: 'subject', type: 'text', label: 'Subject', required: true, order: 1 },
  { id: 'acno', type: 'select', label: 'AC Serial Number', help_text: 'Choose the AC that has the problem (AC tickets only).', required: false, order: 2, options_source: 'ac_units', options: Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })) },
  { id: 'qty', type: 'number', label: 'Qty', required: true, order: 3, show_for_categories: [cats.fixture] },
  { id: 'desc', type: 'textarea', label: 'Describe the problem', required: false, order: 4 },
]
const existing = must(await admin.from('services').select('id').eq('slug', 'demo-ac-repair'), 'read service')
let service = existing[0]?.id
if (service) must(await admin.from('services').update({ form_fields: fields, is_active: true }).eq('id', service), 'update service')
else service = must(await admin.from('services').insert({ org_id: ORG, name: 'AC and Facilities Repair', slug: 'demo-ac-repair', team_id: team, form_fields: fields, form_sections: [], is_active: true }).select('id').single(), 'insert service').id
for (const sub of Object.values(subs)) {
  const tag = must(await admin.from('service_sub_category_tags').select('sub_category_id').eq('service_id', service).eq('sub_category_id', sub), 'read tag')
  if (!tag.length) must(await admin.from('service_sub_category_tags').insert({ service_id: service, sub_category_id: sub }), 'tag')
}

// the three sheets (files in ./sheets, read by the demo mode)
for (const [kind, id] of [['ac', 'demo-ac'], ['genset', 'demo-genset'], ['cvm', 'demo-cvm']]) {
  must(await admin.from('master_sources').upsert({ org_id: ORG, kind, spreadsheet_id: id, tab_name: null, content_hash: null }, { onConflict: 'org_id,kind' }), `source ${kind}`)
}
console.log('Demo company ready on the isolated stack. Logins and steps: audit-2026-10/demo/README-DEMO.md')
