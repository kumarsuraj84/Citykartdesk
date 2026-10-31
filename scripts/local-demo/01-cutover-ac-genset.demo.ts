// LOCAL DEMO 1: the AC and the Genset cut-over, done for real in the LOCAL app with the REAL actions, then proved with real tickets raised from a real local store account.
//   npx vitest run --config vitest.demo.config.ts scripts/local-demo/01-cutover-ac-genset.demo.ts
// It can be run again: a category that is already in its program is left as it is. The results STAY in the local database so they can be looked at in the app:
//   Admin > Vendor Programs > AC / Genset (card 2 no longer lists the categories), the demo tickets (title starts with "DEMO cut-over"), the mails in local-mail-outbox/.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { db, tokenFor, clientForToken, sinkFiles, newMailsSince } from './helpers'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createRequest } from '@/lib/actions/requests'
import { moveCategoriesToProgram } from '@/lib/actions/admin/programs'

const ADMIN_EMAIL = 'suraj@citykart.org'
const STORE_EMAIL = 'sm.krc@citykartstores.com'     // the store account of store KRC (14 Blue Star ACs, 1 Genset)
const actAs = (token: string) => vi.mocked(createClient).mockResolvedValue(clientForToken(token) as never)

let adminToken = ""
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = async (sql: PromiseLike<{ data: any; error: unknown }>): Promise<any> => { const r = await sql; if (r.error) throw new Error(JSON.stringify(r.error)); return r.data }

// the id of a field of a service's form, found by its label
async function fieldId(serviceId: string, label: string): Promise<string> {
  const svc = await q(db().from('services').select('template:form_templates(form_sections), form_sections, form_fields').eq('id', serviceId).single())
  const sections = (svc.template?.form_sections ?? svc.form_sections ?? []) as { fields?: { id: string; label: string }[] }[]
  const hit = sections.flatMap((s) => s.fields ?? []).find((f) => f.label.toLowerCase() === label.toLowerCase())
  if (!hit) throw new Error(`the form has no field "${label}"`)
  return hit.id
}
async function subCategoryOf(categoryName: string, serviceName: string): Promise<{ serviceId: string; subId: string }> {
  const svc = await q(db().from('services').select('id').eq('name', serviceName).single())
  const cat = await q(db().from('service_categories').select('id').eq('name', categoryName).single())
  const subs = await q(db().from('service_sub_categories').select('id, service_sub_category_tags!inner(service_id)').eq('category_id', cat.id).eq('service_sub_category_tags.service_id', svc.id).limit(1))
  if (!subs.length) throw new Error(`${categoryName} has no sub-category in ${serviceName}`)
  return { serviceId: svc.id, subId: subs[0].id }
}

beforeAll(async () => { adminToken = await tokenFor(ADMIN_EMAIL) })

describe('the cut-over, for real, in the local app', () => {
  it('moves ADMIN AC ISSUE into the AC program, and the four GENSET categories into the Genset program', async () => {
    actAs(adminToken)
    const progs = await q(db().from('vendor_programs').select('id, name, is_active').in('name', ['AC', 'Genset']))
    const ac = progs.find((p: { name: string }) => p.name === 'AC'), genset = progs.find((p: { name: string }) => p.name === 'Genset')
    expect(ac && genset, 'the local AC and Genset programs exist (scripts/local-demo/prepare-ac-program.sql)').toBeTruthy()
    const cats = await q(db().from('service_categories').select('id, name, auto_oem_kind, program_id').in('name', ['ADMIN AC ISSUE', 'GENSET-CUMMINS', 'GENSET-MAHINDRA', 'GENSET-EICHER', 'GENSET-KILOSKAR']))
    const todo = (names: string[]) => cats.filter((c: { name: string; program_id: string | null }) => names.includes(c.name) && !c.program_id).map((c: { id: string }) => c.id)

    const acIds = todo(['ADMIN AC ISSUE'])
    if (acIds.length) { const r = await moveCategoriesToProgram(ac.id, acIds); console.log('AC move result:', JSON.stringify(r)); expect(r.error, 'the AC move').toBeUndefined() }
    const gIds = todo(['GENSET-CUMMINS', 'GENSET-MAHINDRA', 'GENSET-EICHER', 'GENSET-KILOSKAR'])
    if (gIds.length) { const r = await moveCategoriesToProgram(genset.id, gIds); console.log('Genset move result:', JSON.stringify(r)); expect(r.error, 'the Genset move').toBeUndefined() }

    const after = await q(db().from('service_categories').select('name, auto_oem_kind, program_id').in('name', ['ADMIN AC ISSUE', 'GENSET-CUMMINS', 'GENSET-MAHINDRA', 'GENSET-EICHER', 'GENSET-KILOSKAR']))
    for (const c of after as { name: string; auto_oem_kind: string | null; program_id: string | null }[]) {
      expect(c.auto_oem_kind, `${c.name} no longer has the old setting`).toBeNull()
      expect(c.program_id, `${c.name} is in a program`).toBe(c.name === 'ADMIN AC ISSUE' ? ac.id : genset.id)
    }
  })

  // one AC ticket from a store account, for a chosen machine of the given vendor; returns what happened
  async function raiseAc(storeEmail: string, storeCode: string, vendorLike: string, title: string) {
    actAs(await tokenFor(storeEmail))
    const { serviceId, subId } = await subCategoryOf('ADMIN AC ISSUE', 'ADMIN - AC')
    const ac = await q(db().from('vendor_programs').select('id').eq('name', 'AC').single())
    const machine = await q(db().from('program_rows').select('machine_no, vendor').eq('program_id', ac.id).eq('store_code', storeCode).eq('is_active', true).ilike('vendor', vendorLike).order('sheet_row').limit(1))
    expect(machine.length, `${storeCode} has an AC of ${vendorLike}`).toBe(1)
    const before = sinkFiles()
    const f = new FormData()
    f.set('service_id', serviceId); f.set('sub_category_id', subId)
    f.set('form_data', JSON.stringify({
      [await fieldId(serviceId, 'Subject')]: title,
      [await fieldId(serviceId, 'Description')]: 'Demo ticket made by the local cut-over test. The AC blows warm air.',
      [await fieldId(serviceId, 'Contact Number')]: '9876543210',
      [await fieldId(serviceId, 'AC Serial Number')]: machine[0].machine_no,
    }))
    const r = await createRequest(f)
    expect(r.error).toBeUndefined()
    const t = await q(db().from('requests').select('request_no, status, assigned_to').eq('id', r.requestId!).single())
    const snap = await q(db().from('request_program_snapshots').select('snapshot, mailed_to').eq('request_id', r.requestId!).single())
    expect(snap.snapshot, 'only the chosen AC is kept with the ticket').toHaveLength(1)
    expect(snap.mailed_to.length, 'the mail went out').toBeGreaterThan(0)
    const mails = newMailsSince(before).filter((m) => m.subject.includes(t.request_no) && /^New AC Issue Ticket/.test(m.subject))
    expect(mails, 'the OEM mail is in the local outbox').toHaveLength(1)
    expect(mails[0].text).toContain(String(machine[0].machine_no))
    const person = t.assigned_to ? await q(db().from('profiles').select('full_name, vendor_role').eq('id', t.assigned_to).single()) : null
    console.log(`${t.request_no} (${storeCode}, ${machine[0].vendor}): status ${t.status}, assigned to ${person?.full_name ?? '(nobody)'}${person?.vendor_role ? ' [vendor ' + person.vendor_role + ']' : ''}; OEM mail to ${mails[0].to}`)
    return { t, person }
  }

  it('an AC ticket of a Voltas AC (store JHG): the OEM is mailed, the Voltas rule gives it to a Voltas technician and it STAYS OPEN for the vendor', async () => {
    const { t, person } = await raiseAc('sm.jhg@citykartstores.com', 'JHG', 'voltas%', 'DEMO cut-over: AC not cooling (Voltas AC)')
    expect(person?.vendor_role, 'a Voltas technician has it (the [LOCAL TEST] rule that reads "AC AMC vendor")').toBe('technician')
    expect(t.status, 'a vendor technician starts it himself: the ticket stays Open').toBe('open')
  })

  it('an AC ticket of another vendor (store KRC): no vendor rule matches, a Citykart technician has it, and it goes to IN PROGRESS, exactly as the old AC setting did', async () => {
    const { t, person } = await raiseAc('sm.krc@citykartstores.com', 'KRC', '%', 'DEMO cut-over: AC not cooling (KRC)')
    expect(person?.vendor_role ?? null, 'not a vendor technician').toBeNull()
    expect(t.status).toBe('in_progress')
  })

  it('a Genset ticket from store KRC: the Genset program mails the OEM and the ticket goes to In Progress', async () => {
    actAs(await tokenFor(STORE_EMAIL))
    const { serviceId, subId } = await subCategoryOf('GENSET-CUMMINS', 'ADMIN REPAIR')
    const before = sinkFiles()
    const f = new FormData()
    f.set('service_id', serviceId); f.set('sub_category_id', subId)
    f.set('form_data', JSON.stringify({
      [await fieldId(serviceId, 'Subject')]: 'DEMO cut-over: Genset does not start',
      [await fieldId(serviceId, 'Description')]: 'Demo ticket made by the local cut-over test. The genset does not start when the power goes.',
      [await fieldId(serviceId, 'Contact Number')]: '9876543210',
      [await fieldId(serviceId, 'Faulty Item Qty')]: 1,
    }))
    const r = await createRequest(f)
    expect(r.error).toBeUndefined()
    const t = await q(db().from('requests').select('request_no, status').eq('id', r.requestId!).single())
    const mails = newMailsSince(before).filter((m) => m.subject.includes(t.request_no) && /^New Genset/.test(m.subject))
    expect(mails, 'the OEM mail is in the local outbox').toHaveLength(1)
    console.log(`${t.request_no} (Genset, KRC): status ${t.status}; OEM mail to ${mails[0].to}`)
    expect(t.status).toBe('in_progress')
  })
})
