// LOCAL DEMO 2: vendor companies, their technicians and managers, the Business Rules that give tickets to them, and the SENSOMATIC program switched on with addresses,
// all done for real in the LOCAL app with the REAL admin actions, then proved with real tickets raised from real local store accounts.
//   npx vitest run --config vitest.demo.config.ts scripts/local-demo/02-vendors-and-sensomatic.demo.ts
// Can be run again (what exists is left as it is). The results STAY in the local database: Admin > Vendors, Admin > Business Rules, Admin > Vendor Programs > Sensor Machine,
// the demo tickets (title starts with "DEMO vendor"), the mails in local-mail-outbox/. The addresses are made up (<vendor>.service@example.test); nothing is sent anywhere.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { db, tokenFor, clientForToken, sinkFiles, newMailsSince } from './helpers'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest } from '@/lib/actions/requests'
import { createVendorCompany, inviteVendorPerson } from '@/lib/actions/admin/vendors'
import { createBusinessRule } from '@/lib/actions/admin/business-rules'
import { saveProgramResolutions, setProgramLevel, saveProgramApprovers, saveProgramPortalOptions, setProgramActive } from '@/lib/actions/admin/programs'
import { loadProgramEditor } from '@/lib/programs/admin-data'

const ADMIN_EMAIL = 'suraj@citykart.org'
const actAs = (token: string) => vi.mocked(createClient).mockResolvedValue(clientForToken(token) as never)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = async (sql: PromiseLike<{ data: any; error: unknown }>): Promise<any> => { const r = await sql; if (r.error) throw new Error(JSON.stringify(r.error)); return r.data }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// company -> its people (the first technician takes part in the rules)
const SENSOMATIC_VENDORS: Record<string, { technicians: string[]; managers: string[] }> = {
  SECUREMATE: { technicians: ['Securemate Technician One', 'Securemate Technician Two'], managers: ['Securemate Manager'] },
  'BNR ELECTRO': { technicians: ['BNR Electro Technician One'], managers: [] },
  CHECKPOINT: { technicians: ['Checkpoint Technician One'], managers: [] },
  ENTHASIS: { technicians: ['Enthasis Technician One'], managers: [] },
}
const RO_VENDOR = { name: 'Radhey Water solution', technicians: ['Radhey Technician One'], managers: [] as string[] }

let adminToken = '', orgId = '', adminId = ''
const companyId: Record<string, string> = {}

async function fieldId(serviceId: string, label: string): Promise<string> {
  const svc = await q(db().from('services').select('template:form_templates(form_sections), form_sections').eq('id', serviceId).single())
  const sections = (svc.template?.form_sections ?? svc.form_sections ?? []) as { fields?: { id: string; label: string }[] }[]
  const hit = sections.flatMap((s) => s.fields ?? []).find((f) => f.label.toLowerCase() === label.toLowerCase())
  if (!hit) throw new Error(`the form has no field "${label}"`)
  return hit.id
}

beforeAll(async () => {
  adminToken = await tokenFor(ADMIN_EMAIL)
  const me = await q(db().from('profiles').select('id, org_id').eq('role', 'platform_owner').order('created_at').limit(1).single())
  orgId = me.org_id; adminId = me.id
})

async function ensureCompany(name: string): Promise<string> {
  const found = await q(db().from('vendor_companies').select('id').eq('org_id', orgId).ilike('name', name).limit(1))
  if (found.length) return found[0].id
  const r = await createVendorCompany(name)
  expect(r.error, `company ${name}`).toBeUndefined()
  return r.id!
}
async function ensurePerson(company: string, fullName: string, role: 'technician' | 'manager') {
  const found = await q(db().from('profiles').select('id').eq('org_id', orgId).eq('full_name', fullName).limit(1))
  if (found.length) return
  const r = await inviteVendorPerson({ email: `${slug(fullName)}@example.test`, full_name: fullName, company_id: companyId[company], vendor_role: role })
  expect(r.error, `invite ${fullName}`).toBeUndefined()
}
async function ensureRule(name: string, input: { conditions: unknown[]; actions: unknown[] }) {
  const found = await q(db().from('business_rules').select('id').eq('org_id', orgId).eq('name', name).limit(1))
  if (found.length) return found[0].id as string
  const r = await createBusinessRule({ name, description: 'Made by the local demo run (scripts/local-demo/02-vendors-and-sensomatic.demo.ts).', is_active: true, trigger: ['created'], schedule_check: null, schedule_threshold: null, conditions: input.conditions, conditions_logic: 'AND', actions: input.actions, execution_order: 50 } as never)
  expect(r.error, `rule ${name}`).toBeUndefined()
  return r.id!
}

describe('vendor companies, technicians and managers', () => {
  it('creates the companies and their logins (the "set your password" mail goes to the local outbox)', async () => {
    actAs(adminToken)
    const all: Record<string, { technicians: string[]; managers: string[] }> = { ...SENSOMATIC_VENDORS, [RO_VENDOR.name]: RO_VENDOR }
    for (const [name, people] of Object.entries(all)) {
      companyId[name] = await ensureCompany(name)
      for (const t of people.technicians) await ensurePerson(name, t, 'technician')
      for (const m of people.managers) await ensurePerson(name, m, 'manager')
    }
    const n = await q(db().from('profiles').select('id').eq('org_id', orgId).in('vendor_company_id', Object.values(companyId)))
    console.log(`vendor companies: ${Object.keys(companyId).join(', ')}; their people: ${n.length}`)
    expect(n.length).toBeGreaterThanOrEqual(6)
  })
})

describe('SENSOMATIC: addresses, switched on, and the rules that give its tickets to the vendors', () => {
  it('fills the made-up addresses, sets the portal options and switches the program on (the check list must allow it)', async () => {
    actAs(adminToken)
    const prog = await q(db().from('vendor_programs').select('id, level').eq('name', 'Sensor Machine').single())
    // the addresses (on live these come from the sheet's "Ticket Mail To" column)
    const rows = await q(db().from('program_rows').select('id, vendor').eq('program_id', prog.id))
    for (const v of new Set((rows as { vendor: string }[]).map((r) => r.vendor))) {
      await db().from('program_rows').update({ emails: [`${slug(v || 'vendor')}.service@example.test`] }).eq('program_id', prog.id).eq('vendor', v)
    }
    expect((await saveProgramResolutions(prog.id, 'Repaired on site\nSensor replaced\nCable repaired\nReset and tested')).error).toBeUndefined()
    expect((await saveProgramApprovers(prog.id, [adminId])).error).toBeUndefined()
    expect((await saveProgramPortalOptions(prog.id, { oemRequired: false })).error).toBeUndefined()
    const lv = await setProgramLevel(prog.id, 'portal'); expect(lv.error, 'portal level').toBeUndefined()
    const on = await setProgramActive(prog.id, true)
    const editor = await loadProgramEditor(orgId, prog.id)
    console.log('Sensor Machine check list:', JSON.stringify((editor as unknown as { readiness?: unknown })?.readiness ?? null).slice(0, 700))
    expect(on.error, 'switch on').toBeUndefined()
    expect((await q(db().from('vendor_programs').select('is_active').eq('id', prog.id).single())).is_active).toBe(true)
  })

  it('makes one rule per Sensomatic vendor (its stores -> all technicians of its company, in turn) and one for the RO purifier', async () => {
    actAs(adminToken)
    const prog = await q(db().from('vendor_programs').select('id').eq('name', 'Sensor Machine').single())
    const rows = await q(db().from('program_rows').select('store_code, vendor').eq('program_id', prog.id)) as { store_code: string; vendor: string }[]
    const stores = await q(db().from('stores').select('id, code').eq('org_id', orgId)) as { id: string; code: string }[]
    const idByCode = new Map(stores.map((s) => [s.code.toUpperCase(), s.id]))
    for (const name of Object.keys(SENSOMATIC_VENDORS)) {
      const storeIds = [...new Set(rows.filter((r) => r.vendor === name).map((r) => idByCode.get(r.store_code.toUpperCase())).filter((x): x is string => !!x))]
      expect(storeIds.length, `${name} has stores`).toBeGreaterThan(0)
      await ensureRule(`Sensomatic tickets of ${name}`, {
        conditions: [{ field: 'vendor_line', operator: 'equals', value: prog.id }, { field: 'requester_store_id', logic: 'AND', operator: 'in', value: storeIds }],
        actions: [{ type: 'assign', params: { strategy: 'round_robin', assigneeIds: [], vendorCompanyId: companyId[name] } }],
      })
    }
    const ro = await q(db().from('vendor_programs').select('id').eq('name', 'RO Purifier').single())
    await ensureRule(`RO Purifier tickets go to ${RO_VENDOR.name}`, {
      conditions: [{ field: 'vendor_line', operator: 'equals', value: ro.id }],
      actions: [{ type: 'assign', params: { strategy: 'round_robin', assigneeIds: [], vendorCompanyId: companyId[RO_VENDOR.name] } }],
    })
    const made = await q(db().from('business_rules').select('name').eq('org_id', orgId).or('name.like.Sensomatic tickets of%,name.like.RO Purifier tickets go to%'))
    console.log(`rules: ${(made as { name: string }[]).map((m) => m.name).join(' | ')}`)
    expect(made.length).toBe(5)
  })

  it('a real Sensomatic ticket and a real RO Purifier ticket from store accounts: the vendor is mailed, a technician of the vendor company has the ticket, it stays Open for him', async () => {
    const prog = await q(db().from('vendor_programs').select('id').eq('name', 'Sensor Machine').single())
    const pick = async (programName: string, vendor: string) => {
      const p = await q(db().from('vendor_programs').select('id').eq('name', programName).single())
      const rows = await q(db().from('program_rows').select('store_code').eq('program_id', p.id).eq('vendor', vendor).eq('is_active', true)) as { store_code: string }[]
      for (const r of rows) {
        const acc = await q(db().from('stores').select('id, code, profiles!profiles_store_id_fkey!inner(id, role, vendor_company_id)').eq('org_id', orgId).eq('code', r.store_code).eq('profiles.role', 'user').is('profiles.vendor_company_id', null).limit(1)) as { code: string; profiles: { id: string }[] }[]
        if (acc.length) {
          const u = await db().auth.admin.getUserById(acc[0].profiles[0].id)
          return { code: acc[0].code, email: u.data.user!.email! }
        }
      }
      throw new Error(`no store account for ${vendor}`)
    }
    async function raise(categoryName: string, store: { code: string; email: string }, title: string) {
      actAs(await tokenFor(store.email))
      const svc = await q(db().from('services').select('id').eq('name', 'ADMIN REPAIR').single())
      const cat = await q(db().from('service_categories').select('id').eq('name', categoryName).single())
      const subs = await q(db().from('service_sub_categories').select('id, service_sub_category_tags!inner(service_id)').eq('category_id', cat.id).eq('service_sub_category_tags.service_id', svc.id).limit(1))
      const before = sinkFiles()
      const f = new FormData()
      f.set('service_id', svc.id); f.set('sub_category_id', subs[0].id)
      f.set('form_data', JSON.stringify({
        [await fieldId(svc.id, 'Subject')]: title,
        [await fieldId(svc.id, 'Description')]: 'Demo ticket made by the local vendor demo run.',
        [await fieldId(svc.id, 'Contact Number')]: '9876543210',
        [await fieldId(svc.id, 'Faulty Item Qty')]: 1,
      }))
      const r = await createRequest(f)
      expect(r.error).toBeUndefined()
      const t = await q(db().from('requests').select('request_no, status, assigned_to').eq('id', r.requestId!).single())
      const who = t.assigned_to ? await q(db().from('profiles').select('full_name, vendor_role').eq('id', t.assigned_to).single()) : null
      const mails = newMailsSince(before).filter((m) => m.subject.includes(t.request_no) && /^New /.test(m.subject))
      console.log(`${t.request_no} (${categoryName}, store ${store.code}): status ${t.status}, assigned to ${who?.full_name ?? '(nobody)'} [${who?.vendor_role ?? '-'}]; vendor mail to ${mails[0]?.to ?? '(none)'}`)
      return { t, who, mails }
    }
    void prog
    const s = await raise('SENSOR MACHINE ISSUE', await pick('Sensor Machine', 'SECUREMATE'), 'DEMO vendor: sensor machine not working (Securemate store)')
    expect(s.who?.vendor_role).toBe('technician'); expect(s.who?.full_name).toMatch(/Securemate/i); expect(s.t.status).toBe('open'); expect(s.mails).toHaveLength(1)
    const r = await raise('RO-PURIFIER ISSUE', await pick('RO Purifier', 'Radhey Water solution'), 'DEMO vendor: RO purifier leaking')
    expect(r.who?.vendor_role).toBe('technician'); expect(r.who?.full_name).toMatch(/Radhey/i); expect(r.t.status).toBe('open'); expect(r.mails).toHaveLength(1)
  })
})
