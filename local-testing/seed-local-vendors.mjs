// LOCAL TESTING ONLY. Adds test vendor companies (Voltas, Blue Star), their technicians and managers, a PO approver, two test AC units for the stores ALC and MAR
// (so a Voltas ticket can be tried; the COB store already has Blue Star ACs from the AC sheet) and the two Business Rules that give an "ADMIN AC ISSUE" ticket to a
// technician of the right vendor. Safe to run again. Refuses to run unless the database is the local one (127.0.0.1:54321).
//   node local-testing/seed-local-vendors.mjs
// All logins share the local test password written in README-LOCAL-TESTING.md.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
)
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error(`Refusing: ${env.NEXT_PUBLIC_SUPABASE_URL} is not the local dev database.`)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PASSWORD = 'Local-Test-Pw-2026!'
const ORG = '00000000-0000-0000-0000-000000000001'
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }

async function login(email, fullName, extra = {}) {
  let id
  const made = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } })
  if (made.error) {
    if (!/already|registered/i.test(made.error.message)) throw new Error(`${email}: ${made.error.message}`)
    for (let page = 1; !id && page <= 5; page++) id = (await admin.auth.admin.listUsers({ page, perPage: 1000 })).data.users.find((u) => u.email === email)?.id
    await admin.auth.admin.updateUserById(id, { password: PASSWORD })
  } else id = made.data.user.id
  must(await admin.from('profiles').update({ role: 'user', full_name: fullName, org_id: ORG, is_active: true, must_reset_password: false, ...extra }).eq('id', id), `profile ${email}`)
  return id
}

async function company(name) {
  const found = await admin.from('vendor_companies').select('id').eq('org_id', ORG).ilike('name', name).maybeSingle()
  if (found.data) return found.data.id
  return must(await admin.from('vendor_companies').insert({ org_id: ORG, name }).select('id').single(), `company ${name}`).id
}

const voltas = await company('Voltas')
const blue = await company('Blue Star')
const people = {}
for (const [key, name, co, kind] of [
  ['voltas.tech1', 'Voltas Technician One', voltas, 'technician'], ['voltas.tech2', 'Voltas Technician Two', voltas, 'technician'], ['voltas.manager', 'Voltas Manager', voltas, 'manager'],
  ['bluestar.tech1', 'Blue Star Technician One', blue, 'technician'], ['bluestar.tech2', 'Blue Star Technician Two', blue, 'technician'], ['bluestar.tech3', 'Blue Star Technician Three', blue, 'technician'],
  ['bluestar.manager', 'Blue Star Manager', blue, 'manager'],
]) people[key] = await login(`${key}@example.test`, name, { vendor_company_id: co, vendor_role: kind })

// the PO approver used by the PO flow (administrator-changeable setting): an ordinary Citykart manager
const approver = await login('local.po.approver@example.test', 'Local PO Approver (Krishan)', {})
must(await admin.from('profiles').update({ role: 'manager' }).eq('id', approver), 'approver role')

// two test AC units, Voltas, for the ALC and MAR stores (the COB store already has Blue Star units from the AC sheet)
for (const code of ['ALC', 'MAR']) {
  const have = await admin.from('master_ac_units').select('id').eq('org_id', ORG).eq('store_code', code).is('removed_at', null).limit(1)
  if (!have.data?.length) {
    must(await admin.from('master_ac_units').insert([
      { org_id: ORG, store_code: code, ckdesk_no: '1', serial: `TEST-${code}-1`, floor: 'GF', ac_type: 'Split', tonnage: '1.5', brand: 'VOLTAS', amc_vendor: 'VOLTAS', amc_brand: 'VOLTAS', region: 'R1', cluster: 'C1', state: 'DL', city: 'Delhi', emails: ['oem.voltas@example.test', 'po.voltas@example.test'], sheet_row: 9000 },
      { org_id: ORG, store_code: code, ckdesk_no: '2', serial: `TEST-${code}-2`, floor: 'FF', ac_type: 'Cassette', tonnage: '2', brand: 'VOLTAS', amc_vendor: 'VOLTAS', amc_brand: 'VOLTAS', region: 'R1', cluster: 'C1', state: 'DL', city: 'Delhi', emails: ['oem.voltas@example.test', 'po.voltas@example.test'], sheet_row: 9001 },
    ]), `test units ${code}`)
  }
}

// the two routing rules
const cat = must(await admin.from('service_categories').select('id').eq('org_id', ORG).eq('name', 'ADMIN AC ISSUE').single(), 'category').id
async function rule(name, vendorText, ids) {
  const row = {
    org_id: ORG, name, trigger: ['created'], is_active: true, conditions_logic: 'AND', execution_order: 900,
    conditions: [
      { field: 'category_id', operator: 'equals', value: cat },
      { field: 'ac_amc_vendor', operator: 'contains', value: vendorText, logic: 'AND' },
    ],
    actions: [{ type: 'assign', params: { strategy: 'round_robin', assigneeIds: ids } }],
  }
  const found = await admin.from('business_rules').select('id').eq('org_id', ORG).eq('name', name).maybeSingle()
  if (found.data) must(await admin.from('business_rules').update(row).eq('id', found.data.id), `rule ${name}`)
  else must(await admin.from('business_rules').insert(row), `rule ${name}`)
}
await rule('[LOCAL TEST] AC tickets of Voltas go to a Voltas technician', 'voltas', [people['voltas.tech1'], people['voltas.tech2']])
await rule('[LOCAL TEST] AC tickets of Blue Star go to a Blue Star technician', 'bluestar', [people['bluestar.tech1'], people['bluestar.tech2'], people['bluestar.tech3']])

console.log('Vendor test data ready. Logins (password in README-LOCAL-TESTING.md):')
for (const k of Object.keys(people)) console.log(`  ${k}@example.test`)
console.log('  local.po.approver@example.test (manager, the PO approver)')
