// QA SEED (local only). Builds a synthetic company on the ISOLATED audit stack (never the dev stack, never a real server) for the browser journeys, UAT and performance runs:
// people of every role, stores, vendors, services + forms + SLA, categories with the AC / Genset / CVM / PMS switches, Business Rules, sample sheets.
// Safe to run again (finds or updates what exists). Refuses to run unless the database address is the audit stack (127.0.0.1:55421).
// All logins share ONE random password that is written to qa-release-candidate-2026-10/evidence/.qa-credentials.json (git-ignored); it is never printed.
//   node qa-release-candidate-2026-10/tooling/seed-qa.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const env = Object.fromEntries(
  readFileSync(path.join(root, 'audit-2026-10', 'env', '.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(url)) throw new Error(`Refusing to seed: ${url} is not the isolated audit stack.`)
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const ORG = '00000000-0000-0000-0000-000000000001'
const credFile = path.join(root, 'qa-release-candidate-2026-10', 'evidence', '.qa-credentials.json')
mkdirSync(path.dirname(credFile), { recursive: true })
let PASSWORD
if (existsSync(credFile)) PASSWORD = JSON.parse(readFileSync(credFile, 'utf8')).password
else { PASSWORD = `Qa-${randomBytes(9).toString('base64url')}-9!`; writeFileSync(credFile, JSON.stringify({ password: PASSWORD, note: 'synthetic QA accounts on the isolated audit stack only' }, null, 2)) }

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
async function pick(table, match, insert = {}, update = null) {
  const found = must(await admin.from(table).select('id').match(match).limit(1), `read ${table}`)
  if (found.length) { if (update) must(await admin.from(table).update(update).eq('id', found[0].id), `update ${table}`); return found[0].id }
  return must(await admin.from(table).insert({ ...match, ...insert }).select('id').single(), `insert ${table}`).id
}
async function upsertUser(email, fullName, role, extra = {}) {
  let id
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } })
  if (created.error) {
    if (!/already|registered/i.test(created.error.message)) throw new Error(`user ${email}: ${created.error.message}`)
    let page = 1
    for (;;) {
      const list = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      id = list.data.users.find((u) => u.email === email)?.id
      if (id || list.data.users.length < 1000) break
      page++
    }
    await admin.auth.admin.updateUserById(id, { password: PASSWORD })
  } else id = created.data.user.id
  must(await admin.from('profiles').update({ role, full_name: fullName, org_id: ORG, is_active: true, must_reset_password: false, ...extra }).eq('id', id), `profile ${email}`)
  return id
}

// ── organisation structure ──────────────────────────────────────────────────────────────────────────────────────────────────────
const dept = await pick('departments', { org_id: ORG, name: 'QA Facilities' })
const teamAdmin = await pick('teams', { org_id: ORG, slug: 'qa-admin-group' }, { name: 'QA Admin Group', prefix: 'QAA', department_id: dept })
const teamIt = await pick('teams', { org_id: ORG, slug: 'qa-it-group' }, { name: 'QA IT Group', prefix: 'QAI', department_id: dept })
const locStores = await pick('locations', { org_id: ORG, name: 'QA STORES' })
const locHo = await pick('locations', { org_id: ORG, name: 'QA HEAD OFFICE' })

const STORES = [
  ['QSA', 'QA Store Alpha', 'Jaipur', 'RJ', 'R1', 'C1'], ['QSB', 'QA Store Bravo', 'Jaipur', 'RJ', 'R1', 'C1'], ['QSC', 'QA Store Charlie', 'Delhi', 'DL', 'R2', 'C2'],
  ['QSD', 'QA Store Delta', 'Lucknow', 'UP', 'R2', 'C3'], ['QSE', 'QA Store Echo', 'Delhi', 'DL', 'R2', 'C2'],
]
const stores = {}
for (const [code, name, city, state, region, cluster] of STORES) stores[code] = await pick('stores', { org_id: ORG, code }, { name, city, state, region, cluster, address: `${name}, ${city}` }, { name, city, state, region, cluster })

// ── people ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const P = {}
P.owner = await upsertUser('owner.qa@audit.test', 'QA Platform Owner', 'platform_owner', { department_id: dept })
P.admin = await upsertUser('admin.qa@audit.test', 'QA Administrator', 'admin', { department_id: dept })
P.manager = await upsertUser('manager.qa@audit.test', 'QA Manager', 'manager', { department_id: dept })
P.tech1 = await upsertUser('tech1.qa@audit.test', 'QA Technician One', 'agent', { department_id: dept })
P.tech2 = await upsertUser('tech2.qa@audit.test', 'QA Technician Two', 'agent', { department_id: dept })
P.itech = await upsertUser('itech.qa@audit.test', 'QA IT Technician', 'agent', { department_id: dept })
P.cvm = await upsertUser('cvm.qa@audit.test', 'QA CVM Approver', 'agent', { department_id: dept })
P.po = await upsertUser('poapprover.qa@audit.test', 'QA PO Approver', 'manager', { department_id: dept })
P.storeA = await upsertUser('storea.qa@audit.test', 'QA Store Alpha Manager', 'user', { store_id: stores.QSA, location_id: locStores })
P.storeA2 = await upsertUser('storea2.qa@audit.test', 'QA Store Alpha Assistant', 'user', { store_id: stores.QSA, location_id: locStores })
P.storeB = await upsertUser('storeb.qa@audit.test', 'QA Store Bravo Manager', 'user', { store_id: stores.QSB, location_id: locStores })
P.storeC = await upsertUser('storec.qa@audit.test', 'QA Store Charlie Manager', 'user', { store_id: stores.QSC, location_id: locStores })
P.storeE = await upsertUser('storee.qa@audit.test', 'QA Store Echo Manager', 'user', { store_id: stores.QSE, location_id: locStores })
P.ho = await upsertUser('ho.qa@audit.test', 'QA Head Office Requester', 'user', { location_id: locHo })
for (const [team, ids] of [[teamAdmin, [P.tech1, P.tech2, P.cvm, P.manager]], [teamIt, [P.itech, P.manager]]]) {
  for (const uid of ids) {
    const has = must(await admin.from('team_members').select('user_id').eq('team_id', team).eq('user_id', uid), 'read team members')
    if (!has.length) must(await admin.from('team_members').insert({ team_id: team, user_id: uid, org_id: ORG }), 'team member')
  }
}

// vendors (OEM engineers)
const coVoltas = await pick('vendor_companies', { org_id: ORG, name: 'QA Voltas' })
const coBlue = await pick('vendor_companies', { org_id: ORG, name: 'QA Blue Star' })
P.vt1 = await upsertUser('voltas.tech1.qa@audit.test', 'QA Voltas Technician One', 'user', { vendor_company_id: coVoltas, vendor_role: 'technician' })
P.vt2 = await upsertUser('voltas.tech2.qa@audit.test', 'QA Voltas Technician Two', 'user', { vendor_company_id: coVoltas, vendor_role: 'technician' })
P.vm = await upsertUser('voltas.mgr.qa@audit.test', 'QA Voltas Manager', 'user', { vendor_company_id: coVoltas, vendor_role: 'manager' })
P.bt1 = await upsertUser('bluestar.tech1.qa@audit.test', 'QA Blue Star Technician One', 'user', { vendor_company_id: coBlue, vendor_role: 'technician' })
P.bm = await upsertUser('bluestar.mgr.qa@audit.test', 'QA Blue Star Manager', 'user', { vendor_company_id: coBlue, vendor_role: 'manager' })
must(await admin.from('app_settings').upsert({ key: 'vendor_po_approver_id', value: P.po }, { onConflict: 'key' }), 'default PO approver')

// ── SLA, categories, forms, services ────────────────────────────────────────────────────────────────────────────────────────────
const sla = await pick('sla_policies', { org_id: ORG, name: 'QA SLA' }, {}, {
  config: { urgent: { response_hours: 1, resolution_hours: 4 }, high: { response_hours: 2, resolution_hours: 8 }, medium: { response_hours: 4, resolution_hours: 16 }, low: { response_hours: 8, resolution_hours: 48 } }, is_active: true,
})
const CATS = [
  ['fixtures', 'QA FIXTURES', { auto_cvm_approval: true, show_approval_history: true }], ['hangers', 'QA HANGERS', { auto_cvm_approval: true, show_approval_history: true }],
  ['ac', 'QA AC ISSUE', { auto_oem_kind: 'ac' }], ['genset', 'QA GENSET ISSUE', { auto_oem_kind: 'genset' }], ['pms', 'QA AC-PMS', { is_pms: true }],
  ['sensor', 'QA SENSOR MACHINE ISSUE', {}], ['general', 'QA GENERAL REQUEST', {}], ['itsupport', 'QA IT SUPPORT', {}],
]
const cats = {}
for (const [key, name, flags] of CATS) cats[key] = await pick('service_categories', { org_id: ORG, slug: `qa-${key}` }, { name }, { name, auto_oem_kind: null, auto_cvm_approval: false, show_approval_history: false, is_pms: false, ...flags })
const SUBS = [
  ['fixtures', 'FIXTURES 4 WAYS', 'medium'], ['fixtures', 'FIXTURES 2 WAYS', 'medium'], ['hangers', 'HANGERS T-SHIRT 13.5', 'low'], ['hangers', 'HANGERS CLIP 10', 'low'],
  ['ac', 'AC not cooling', 'high'], ['ac', 'AC water leakage', 'medium'], ['genset', 'Genset not starting', 'high'], ['pms', 'AC PMS', 'low'],
  ['sensor', 'Barcode sensor not working', 'medium'], ['sensor', 'Sensor gate alarm', 'high'], ['general', 'Office repair', 'low'], ['itsupport', 'Laptop problem', 'medium'],
]
const subs = {}
for (const [catKey, name, prio] of SUBS) subs[name] = await pick('service_sub_categories', { category_id: cats[catKey], slug: `qa-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }, { name }, { name, sla_priority: prio, is_active: true })

const subjectF = { id: 'f_subject', type: 'text', label: 'Subject', required: true, order: 1, validation: { max_length: 120 } }
const descF = (n) => ({ id: 'f_desc', type: 'textarea', label: 'Description', required: false, order: n })
const sec = (id, title, order, fields) => ({ id, title, order, fields })
const TEMPLATES = {
  admin: ['QA ADMIN REQUIREMENT TEMPLATE', [
    sec('s_req', 'Requester Detail', 0, [{ id: 'f_contact', type: 'phone', label: 'Contact Number', required: true, order: 1 }]),
    sec('s_tkt', 'Ticket Detail', 1, [
      { id: 'f_qty', type: 'number', label: 'Qty', required: true, order: 1, validation: { min: 1, max: 10000, integer: true }, show_for_categories: [cats.fixtures, cats.hangers], show_in_approval_history: true },
      { ...subjectF, order: 2 }, descF(3),
    ]),
  ]],
  ac: ['QA AC TEMPLATE', [
    sec('s_ac', 'Ticket Description', 0, [
      subjectF, { id: 'f_acno', type: 'select', label: 'AC Serial Number', required: false, order: 2, options_source: 'ac_units', options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })) }, descF(3),
    ]),
    sec('s_oem', 'Technician Only', 1, [
      { id: 'f_oemno', type: 'text', label: 'AC OEM Ticket Number', required: false, order: 1, requester_can_view: false, requester_can_set: false },
      { id: 'f_oemdt', type: 'date', label: 'AC OEM Ticket Creation Date', required: false, order: 2, requester_can_view: false, requester_can_set: false },
      { id: 'f_acres', type: 'select', label: 'AC resolution', required: false, order: 3, requester_can_view: false, requester_can_set: false, options: [{ value: 'gas', label: 'GAS FILLED' }, { value: 'comp', label: 'COMPRESSOR CHANGED' }, { value: 'pcb', label: 'PCB REPLACED' }] },
    ]),
  ]],
  pms: ['QA PMS TEMPLATE', [sec('s_pms', 'Ticket Detail', 0, [subjectF, descF(2)])]],
  general: ['QA GENERAL TEMPLATE', [sec('s_gen', 'Ticket Detail', 0, [subjectF, descF(2)])]],
}
const tpl = {}
for (const [key, [name, sections]] of Object.entries(TEMPLATES)) tpl[key] = await pick('form_templates', { org_id: ORG, name }, { form_sections: sections }, { form_sections: sections, is_active: true })

async function service(slug, name, team, templateId, subNames, extra = {}) {
  const id = await pick('services', { org_id: ORG, slug }, { name, team_id: team, form_fields: [], form_sections: [], is_active: true }, { name, team_id: team, template_id: templateId, sla_policy_id: sla, is_active: true, ...extra })
  for (const n of subNames) {
    const has = must(await admin.from('service_sub_category_tags').select('sub_category_id').eq('service_id', id).eq('sub_category_id', subs[n]), 'read tag')
    if (!has.length) must(await admin.from('service_sub_category_tags').insert({ service_id: id, sub_category_id: subs[n] }), 'tag')
  }
  return id
}
const svcAdmin = await service('qa-admin-requirements', 'QA ADMIN - REQUIREMENTS (NON TRADING)', teamAdmin, tpl.admin, ['FIXTURES 4 WAYS', 'FIXTURES 2 WAYS', 'HANGERS T-SHIRT 13.5', 'HANGERS CLIP 10', 'Barcode sensor not working', 'Sensor gate alarm', 'Office repair'])
const svcAc = await service('qa-ac-issues', 'QA ADMIN - AC AND GENSET ISSUES', teamAdmin, tpl.ac, ['AC not cooling', 'AC water leakage', 'Genset not starting'])
const svcPms = await service('qa-ac-pms', 'QA AC-PMS', teamAdmin, tpl.pms, ['AC PMS'])
const svcIt = await service('qa-it-support', 'QA IT SUPPORT', teamIt, tpl.general, ['Laptop problem'])
// the Admin Requirements service is for stores only (head office cannot see it): proves the location rule
must(await admin.from('service_location_tags').delete().eq('service_id', svcAdmin), 'clear location tags')
must(await admin.from('service_location_tags').insert({ service_id: svcAdmin, location_id: locStores }), 'location tag')

// ── Business Rules (the same shape the live AC rules use) ───────────────────────────────────────────────────────────────────────
async function rule(name, category, vendorWord, assignees, strategy = 'round_robin') {
  const conditions = [{ field: 'category_id', operator: 'equals', value: category }, ...(vendorWord ? [{ field: 'ac_amc_vendor', logic: 'AND', operator: 'contains', value: vendorWord }] : [])]
  const actions = [{ type: 'assign', params: { strategy, assigneeIds: assignees } }]
  await pick('business_rules', { org_id: ORG, name }, { trigger: ['created'], conditions, actions, execution_order: -20, conditions_logic: 'AND', is_active: true }, { conditions, actions, trigger: ['created'], is_active: true })
}
await rule('QA AC tickets of Voltas go to a Voltas technician', cats.ac, 'voltas', [P.vt1, P.vt2])
await rule('QA AC tickets of Blue Star go to a Blue Star technician', cats.ac, 'bluestar', [P.bt1])
await rule('QA AC PMS tickets of Voltas go to a Voltas technician', cats.pms, 'voltas', [P.vt1, P.vt2])
await rule('QA AC PMS tickets of Blue Star go to a Blue Star technician', cats.pms, 'bluestar', [P.bt1])
await rule('QA sensor machine tickets go to the Voltas technician', cats.sensor, null, [P.vt1], 'direct')
await rule('QA general tickets go to technician one', cats.general, null, [P.tech1], 'direct')

// ── sheets: the sample files the demo mode reads ─────────────────────────────────────────────────────────────────────────────────
const sheetDir = path.join(here, 'sheets'); mkdirSync(sheetDir, { recursive: true })
const csv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n') + '\n'
const AC_HEAD = ['Store Code', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC-AMC vendor', 'AC-AMC Brand', 'Zenatix (yes/No)', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode', 'Status', 'OEM Ticket Mail To', 'OEM PO Mail To', 'CK PO Approver Mail To']
const acRow = (store, no, serial, vendor, brand, city, state, region, cluster, status = 'Active') => [store, 'GF', 'Ductable', '5.5 TR', brand, no, serial, vendor, `${vendor} SERVICE`, 'NO', 'ROS', 'DIWALI', region, cluster, 46250, city, state, `${store} address, ${city}`, 302001, status,
  `service.desk@${vendor.toLowerCase().replace(/ /g, '')}-qa.test, oem.lead@${vendor.toLowerCase().replace(/ /g, '')}-qa.test, desk.lead@citykartstores.com`, `po@${vendor.toLowerCase().replace(/ /g, '')}-qa.test`, 'poapprover.qa@audit.test']
writeFileSync(path.join(sheetDir, 'qa-ac.csv'), csv([
  AC_HEAD,
  acRow('QSA', 1, 'QA-A1', 'VOLTAS', 'VOLTAS', 'Jaipur', 'RJ', 'R1', 'C1'), acRow('QSA', 2, 'QA-A2', 'VOLTAS', 'VOLTAS', 'Jaipur', 'RJ', 'R1', 'C1'), acRow('QSA', 3, 'QA-A3', 'VOLTAS', 'VOLTAS', 'Jaipur', 'RJ', 'R1', 'C1', 'Inactive'),
  acRow('QSB', 1, 'QA-B1', 'VOLTAS', 'VOLTAS', 'Jaipur', 'RJ', 'R1', 'C1'), acRow('QSB', 2, 'QA-B2', 'VOLTAS', 'VOLTAS', 'Jaipur', 'RJ', 'R1', 'C1'),
  acRow('QSC', 1, 'QA-C1', 'BLUESTAR', 'BLUESTAR', 'Delhi', 'DL', 'R2', 'C2'), acRow('QSC', 2, 'QA-C2', 'BLUESTAR', 'BLUESTAR', 'Delhi', 'DL', 'R2', 'C2'),
  acRow('QSE', 1, 'QA-E1', 'BLUESTAR', 'BLUESTAR', 'Delhi', 'DL', 'R2', 'C2'), acRow('QSE', 2, 'QA-E2', 'BLUESTAR', 'BLUESTAR', 'Delhi', 'DL', 'R2', 'C2'),
]))
writeFileSync(path.join(sheetDir, 'qa-genset.csv'), csv([
  ['Store Code', 'Genset Brand', 'Genset KVA', 'Genset Serial No', 'CPCB Group', 'Mail ID'],
  ['QSA', 'CUMMINS', 125, 'QA-GS-A1', 'CPCB-II', 'powerservice@cummins-qa.test, desk.lead@citykartstores.com'], ['QSD', 'MAHINDRA', 58.5, 'QA-GS-D1', 'CPCB-IV', 'powerol@mahindra-qa.test'],
]))
writeFileSync(path.join(sheetDir, 'qa-cvm.csv'), csv([['Store Code', 'CVM EMAIL ID'], ['QSA', 'cvm.qa@audit.test'], ['QSB', 'cvm.qa@audit.test'], ['QSC', 'cvm.qa@audit.test'], ['QSD', 'cvm.qa@audit.test'], ['QSE', 'cvm.qa@audit.test']]))
const ist = (offsetDays) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10).split('-').reverse().join('/')
writeFileSync(path.join(sheetDir, 'qa-pms.csv'), csv([['Store Code', 'AC PMS Date'], ['QSA', ist(0)], ['QSB', ist(0)], ['QSC', ist(-1)], ['QSE', ist(1)], ['QSD', ''], ['QSB', 'not a date']]))
for (const [kind, id] of [['ac', 'qa-ac'], ['genset', 'qa-genset'], ['cvm', 'qa-cvm'], ['pms', 'qa-pms']]) {
  must(await admin.from('master_sources').upsert({ org_id: ORG, kind, spreadsheet_id: id, tab_name: null, content_hash: null }, { onConflict: 'org_id,kind' }), `source ${kind}`)
}

console.log(JSON.stringify({ ok: true, accounts: Object.fromEntries(Object.entries({ owner: 'owner.qa', admin: 'admin.qa', manager: 'manager.qa', tech1: 'tech1.qa', tech2: 'tech2.qa', itech: 'itech.qa', cvm: 'cvm.qa', po: 'poapprover.qa', storeA: 'storea.qa', storeA2: 'storea2.qa', storeB: 'storeb.qa', storeC: 'storec.qa', storeE: 'storee.qa', ho: 'ho.qa', vt1: 'voltas.tech1.qa', vt2: 'voltas.tech2.qa', vm: 'voltas.mgr.qa', bt1: 'bluestar.tech1.qa', bm: 'bluestar.mgr.qa' }).map(([k, v]) => [k, `${v}@audit.test`])), ids: { svcAdmin, svcAc, svcPms, svcIt, cats, teamAdmin, teamIt } }, null, 1))
