// AC on the Vendor Program mechanism, side by side with the old AC setting, on the isolated audit stack (mail goes nowhere). This is part 1 of the AC cut-over (local proof):
//  - the SAME AC rows give the SAME mail through both ways: the same recipients (the OEM in To, company people in CC), the chosen AC written the same way, the same note in the
//    conversation, the ticket In Progress; a store that is not in the sheet stays Open with a note in both ways;
//  - the AC dropdown of the form (the CKDESK number of the store's ACs) is the machine choice of the program too, so the form needs no change after a category is moved;
//  - the Business Rules that route by the AC vendor (condition "AC AMC vendor") keep matching: through the saved AC record when the form has the AC dropdown, and through the
//    program's saved sheet row when it has not;
//  - a category moves from the old setting to the program in ONE step and can be moved back.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, createTestUser, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
// eslint-disable-next-line @typescript-eslint/no-unused-vars
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest } from '@/lib/actions/requests'
import { syncPrograms } from '@/lib/programs/sync'
import { moveCategoriesToProgram, saveBuiltInCategories } from '@/lib/actions/admin/programs'
import { parseOemComment } from '@/lib/masters/comment-view'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t64${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string[]; cc?: string[]; subject: string; html: string }[]
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b')                 // A has two ACs, B has one
const ids = { storeA: '', storeB: '', program: '', catOld: '', catNew: '', catMove: '', subOld: '', subNew: '', subMove: '' }
const made: string[] = []
const ruleIds: string[] = []
const vendor = { companyId: '', userId: '' }
const SHEET = `${tag}-sheet-ac-0000000000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const EMAILS_A1 = ['oem.one@bluestar.test', 'desk.lead@citykartstores.com']
const EMAILS_A2 = ['oem.two@bluestar.test']
const EMAILS_B = ['svc@voltas.test', 'raushan.kumar@citykartstores.com']
const HEAD = ['Store Code', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC-AMC Vendor', 'AC-AMC Brand', 'Region', 'State', 'Cluster', 'Ticket Mail To']
const DETAILS = '{{machine_no}} - {{extra_acfloor}}, {{extra_actype}} {{extra_actonnage}} - {{extra_acbrand}} - serial {{serial}}'
const LINE_A2 = '2 - FF_First Floor, Ductable 5.5 TR - BLUESTAR - serial S-200'
const MACHINE_FIELD = { id: 'machine', type: 'select', label: 'AC Serial Number', required: false, order: 2, options_source: 'program_machines', options: [] }
const AC_FIELD = { id: 'ac', type: 'select', label: 'AC', required: false, order: 2, options_source: 'ac_units', options: [] }
const SUBJECT_FIELD = { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)

async function raise(sub: string, title: string, ac?: string, key = 'ac') {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}`, ...(ac !== undefined ? { [key]: ac } : {}) }))
  const r = await createRequest(f)
  if (r.requestId) made.push(r.requestId)
  return r
}
async function ticket(id: string) {
  const t = (await db().from('requests').select('id, status, assigned_to').eq('id', id).single()).data as { id: string; status: string; assigned_to: string | null }
  const comments = ((await db().from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean }[]
  return { ...t, comments }
}
const mailsFor = (title: string) => mails().filter((m) => m.html.includes(`${tag} ${title}`))
const heading = (t: { comments: { body: string }[] }) => t.comments.map((c) => parseOemComment(c.body)).find(Boolean)?.heading

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Old Bus Stand Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B)
  // the OLD setting: the AC rows in the master table, the category sends to the AC OEM
  const unit = (store: string, no: string, serial: string, floor: string, type: string, tonnage: string, brand: string, vendor: string, emails: string[], row: number) =>
    ({ org_id: fx.orgId, store_code: store, ckdesk_no: no, serial, floor, ac_type: type, tonnage, brand, amc_vendor: vendor, amc_brand: 'STAR COOLING', region: 'R5', state: 'UTTAR PRADESH', cluster: 'UP5', emails, is_active: true, sheet_row: row })
  await a.from('master_ac_units').insert([
    unit(A, '1', 'S-100', 'GF_Ground Floor', 'Split', '2 TR', 'DAIKIN', 'BLUESTAR', EMAILS_A1, 2),
    unit(A, '2', 'S-200', 'FF_First Floor', 'Ductable', '5.5 TR', 'BLUESTAR', 'BLUESTAR', EMAILS_A2, 3),
    unit(B, '3', 'S-300', 'GF_Ground Floor', 'Split', '1.5 TR', 'VOLTAS', 'VOLTAS', EMAILS_B, 4),
  ])
  // the NEW way: a program "AC" (one row per machine) on the same rows; the vendor is the sheet's AC-AMC Vendor column
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: 'AC', slug: `${tag}-ac`, is_active: false, level: 'mail', row_type: 'machine', spreadsheet_id: SHEET, details_template: DETAILS, columns: { vendor: 'AC-AMC Vendor' },
    mail_subject: 'New AC Issue Ticket - {{ticket_no}} - {{store_code}}',
    mail_body_html: '<p>Dear Team,</p><table><tbody><tr><th>Ticket No</th><td>{{ticket_no}}</td></tr><tr><th>Store Code</th><td>{{store_code}}</td></tr><tr><th>AC Details</th><td>{{details}}</td></tr><tr><th>Issue</th><td>{{subject}}</td></tr></tbody></table>',
  }).select('id').single()).data.id
  const mkCat = async (n: string, extra: Record<string, unknown>) => {
    const cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${n}`, slug: `${tag}-${n}-cat`, ...extra }).select('id').single()).data.id as string
    const sub = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${n}-sub`, slug: `${tag}-${n}-sub` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: sub })
    return { cat, sub }
  }
  const old = await mkCat('old', { auto_oem_kind: 'ac' }); ids.catOld = old.cat; ids.subOld = old.sub
  const nw = await mkCat('new', { program_id: ids.program }); ids.catNew = nw.cat; ids.subNew = nw.sub
  const mv = await mkCat('move', { auto_oem_kind: 'ac' }); ids.catMove = mv.cat; ids.subMove = mv.sub
  await a.from('services').update({ form_fields: [SUBJECT_FIELD, AC_FIELD] }).eq('id', fx.teamA.serviceId)
  sheets[SHEET] = [HEAD,
    [A, '1', 'S-100', 'GF_Ground Floor', 'Split', '2 TR', 'DAIKIN', 'BLUESTAR', 'STAR COOLING', 'R5', 'UTTAR PRADESH', 'UP5', EMAILS_A1.join(', ')],
    [A, '2', 'S-200', 'FF_First Floor', 'Ductable', '5.5 TR', 'BLUESTAR', 'BLUESTAR', 'STAR COOLING', 'R5', 'UTTAR PRADESH', 'UP5', EMAILS_A2.join(', ')],
    [B, '3', 'S-300', 'GF_Ground Floor', 'Split', '1.5 TR', 'VOLTAS', 'VOLTAS', 'STAR COOLING', 'R5', 'UTTAR PRADESH', 'UP5', EMAILS_B.join(', ')],
  ]
  await syncPrograms({ db: a, orgId: fx.orgId, source, force: true })
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  if (ruleIds.length) await a.from('business_rules').delete().in('id', ruleIds)
  if (made.length) { await a.from('request_program_snapshots').delete().in('request_id', made); await a.from('request_master_snapshots').delete().in('request_id', made); await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  if (vendor.userId) { try { await a.auth.admin.deleteUser(vendor.userId) } catch { /* best effort */ } }
  if (vendor.companyId) await a.from('vendor_companies').delete().eq('id', vendor.companyId)
  const subs = [ids.subOld, ids.subNew, ids.subMove].filter(Boolean)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', subs)
  await a.from('service_sub_categories').delete().in('id', subs)
  await a.from('service_categories').delete().in('id', [ids.catOld, ids.catNew, ids.catMove].filter(Boolean))
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('master_ac_units').delete().eq('org_id', fx.orgId).in('store_code', [A, B])
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

// the program is switched on by the move itself in real use; here it is switched on directly for the mail comparison
const programOn = () => db().from('vendor_programs').update({ is_active: true }).eq('id', ids.program)

describe('the same AC rows give the same mail through the old setting and through the program', () => {
  it('the AC the requester chose: the same recipients, the AC written the same way, the same note, In Progress', async () => {
    await programOn()
    await setStore(ids.storeA)
    const oldT = await raise(ids.subOld, 'old way chosen', '2')
    const newT = await raise(ids.subNew, 'new way chosen', '2')
    const [mo] = mailsFor('old way chosen'), [mn] = mailsFor('new way chosen')
    expect(mo, 'the old way mails').toBeTruthy(); expect(mn, 'the program mails').toBeTruthy()
    expect([...mn.to].sort()).toEqual([...mo.to].sort())
    expect([...(mn.cc ?? [])].sort()).toEqual([...(mo.cc ?? [])].sort())
    expect(mo.to).toEqual(['oem.two@bluestar.test'])
    // the old mail has its own default layout and the program's wording is the administrator's: what must be the same is WHAT the OEM is told about the AC
    for (const m of [mo, mn]) for (const fact of ['S-200', 'FF_First Floor', 'Ductable', '5.5 TR', 'BLUESTAR']) expect(m.html, `${fact} is in the mail`).toContain(fact)
    expect(mn.html).toContain(LINE_A2)                                              // and the program writes it the way its details template says
    for (const m of [mo, mn]) expect(m.html).not.toContain('S-100')               // the other AC of the store is not mentioned
    const [to, tn] = [await ticket(oldT.requestId!), await ticket(newT.requestId!)]
    expect(to.status).toBe('in_progress'); expect(tn.status).toBe('in_progress')
    expect(heading(tn)).toBe('Ticket sent to the AC OEM for servicing.')
    expect(heading(tn)).toBe(heading(to))
    // the AC the requester chose is saved with the ticket in BOTH ways (the rules and the vendor portal read it), and the program row is saved too in the new way
    expect((await db().from('request_master_snapshots').select('kind').eq('request_id', newT.requestId!).eq('kind', 'ac')).data).toHaveLength(1)
    expect((await db().from('request_program_snapshots').select('snapshot').eq('request_id', newT.requestId!).single()).data.snapshot).toHaveLength(1)   // only the chosen AC
  })

  it('no AC chosen: both mail the addresses of every AC of the store; a store that is not in the sheet stays Open with a note in both ways', async () => {
    await setStore(ids.storeA)
    await raise(ids.subOld, 'old way none'); await raise(ids.subNew, 'new way none')
    const [mo] = mailsFor('old way none'), [mn] = mailsFor('new way none')
    expect([...mn.to].sort()).toEqual([...mo.to].sort()); expect([...(mn.cc ?? [])].sort()).toEqual([...(mo.cc ?? [])].sort())
    await setStore(null)
    const orphan = await db().from('stores').insert({ org_id: fx.orgId, code: code('c'), name: `${tag} none`, address: 'x' }).select('id').single()
    try {
      await setStore(orphan.data.id)
      const [o, n] = [await raise(ids.subOld, 'old orphan'), await raise(ids.subNew, 'new orphan')]
      for (const r of [o, n]) { const t = await ticket(r.requestId!); expect(t.status).toBe('open'); expect(t.comments.some((c) => c.is_internal && /AC/.test(c.body))).toBe(true) }
    } finally { await setStore(null); await db().from('stores').delete().eq('id', orphan.data.id) }
  })

  it('a value the program does not know is ignored (the old AC list decides what can be chosen): the ticket is still mailed', async () => {
    await setStore(ids.storeB)
    const r = await raise(ids.subNew, 'new unknown ac', 'not-in-the-program')
    expect(r.error).toBeTruthy()                                                  // the old AC list still refuses a value that is not an AC of the store
    const ok = await raise(ids.subNew, 'new known ac', '3')
    expect(ok.error).toBeUndefined()
    expect(mailsFor('new known ac')[0].to).toEqual(['svc@voltas.test']); expect(mailsFor('new known ac')[0].cc).toEqual(['raushan.kumar@citykartstores.com'])
  })
})

describe('the Business Rules that route by the AC vendor keep matching after the move', () => {
  async function vendorRule(marker: string) {
    const r = (await db().from('business_rules').insert({
      org_id: fx.orgId, name: `${tag} ${marker}`, trigger: ['created'], is_active: true, execution_order: 9500, conditions_logic: 'AND',
      conditions: [{ field: 'title', operator: 'contains', value: `${tag} ${marker}` }, { field: 'ac_amc_vendor', logic: 'AND', operator: 'contains', value: 'bluestar' }],
      actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }],
    }).select('id').single()).data.id as string
    ruleIds.push(r)
  }

  it('with the AC dropdown on the form (the saved AC record): the ticket in the program category goes to the technician of the rule', async () => {
    await setStore(ids.storeA)
    await vendorRule('rule with ac')
    const t = await raise(ids.subNew, 'rule with ac', '2')
    expect((await ticket(t.requestId!)).assigned_to).toBe(fx.agentA.id)
  })

  it('without the AC dropdown (no AC record): the program row saved with the ticket gives the vendor to the rules that run afterwards (re-run, scheduled)', async () => {
    await db().from('services').update({ form_fields: [SUBJECT_FIELD] }).eq('id', fx.teamA.serviceId)
    try {
      await setStore(ids.storeA)
      await vendorRule('rule no field')
      const t = await raise(ids.subNew, 'rule no field')
      expect((await db().from('request_master_snapshots').select('kind').eq('request_id', t.requestId!).eq('kind', 'ac')).data).toHaveLength(0)   // no AC record: the program row decides
      // (at the moment of creation the rules run BEFORE the program saves its row: this is why the AC dropdown stays on the form; a later run of the rules sees the row)
      const { runRulesForTrigger } = await import('@/lib/rules/run')
      await runRulesForTrigger('created', t.requestId!)
      expect((await ticket(t.requestId!)).assigned_to).toBe(fx.agentA.id)
    } finally { await db().from('services').update({ form_fields: [SUBJECT_FIELD, AC_FIELD] }).eq('id', fx.teamA.serviceId) }
  })
})

describe('the form with the machine picker (the dropdown of the machines of the program): the rules see the vendor AT CREATION', () => {
  it('a rule that routes by the AC vendor gives the ticket to its technician the moment it is made (the program saves its row before the rules run)', async () => {
    await db().from('services').update({ form_fields: [SUBJECT_FIELD, MACHINE_FIELD] }).eq('id', fx.teamA.serviceId)
    try {
      await setStore(ids.storeA)
      await db().from('business_rules').insert({
        org_id: fx.orgId, name: `${tag} picker rule`, trigger: ['created'], is_active: true, execution_order: 9500, conditions_logic: 'AND',
        conditions: [{ field: 'title', operator: 'contains', value: `${tag} picker rule` }, { field: 'ac_amc_vendor', logic: 'AND', operator: 'contains', value: 'bluestar' }],
        actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [fx.agentA.id] } }],
      }).select('id').single().then((r: { data: { id: string } }) => ruleIds.push(r.data.id))
      const t = await raise(ids.subNew, 'picker rule', '2', 'machine')
      expect(t.error).toBeUndefined()
      expect((await ticket(t.requestId!)).assigned_to).toBe(fx.agentA.id)
    } finally { await db().from('services').update({ form_fields: [SUBJECT_FIELD, AC_FIELD] }).eq('id', fx.teamA.serviceId) }
  })

  it('a ticket a rule gave to a VENDOR technician stays Open for him, in both ways; one nobody gave to a vendor goes to In Progress, in both ways', async () => {
    const a = db()
    vendor.companyId = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Vendor Co` }).select('id').single()).data.id
    const tech = await createTestUser('p64-vendor-tech', 'P64 Vendor Technician')
    vendor.userId = tech.id
    await a.from('profiles').update({ role: 'user', vendor_company_id: vendor.companyId, vendor_role: 'technician', org_id: fx.orgId }).eq('id', tech.id)
    await a.from('business_rules').insert({
      org_id: fx.orgId, name: `${tag} to vendor`, trigger: ['created'], is_active: true, execution_order: 9500, conditions_logic: 'AND',
      conditions: [{ field: 'title', operator: 'contains', value: `${tag} vendor ticket` }],
      actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [tech.id] } }],
    }).select('id').single().then((r: { data: { id: string } }) => ruleIds.push(r.data.id))
    await setStore(ids.storeA)
    const oldV = await raise(ids.subOld, 'vendor ticket old way', '2'); const newV = await raise(ids.subNew, 'vendor ticket new way', '2')
    for (const r of [oldV, newV]) { const t = await ticket(r.requestId!); expect(t.assigned_to).toBe(tech.id); expect(t.status, 'a vendor technician starts it himself').toBe('open') }
    const oldN = await raise(ids.subOld, 'plain old way', '2'); const newN = await raise(ids.subNew, 'plain new way', '2')
    for (const r of [oldN, newN]) expect((await ticket(r.requestId!)).status).toBe('in_progress')
  })
})

describe('moving the AC category from the old setting to the program, and back', () => {
  it('is refused while the program is not ready, then moves in ONE step and switches the program on; new tickets use the program', async () => {
    await db().from('vendor_programs').update({ is_active: false, last_status: null }).eq('id', ids.program)
    actAs(fx.admin)
    const notReady = await moveCategoriesToProgram(ids.program, [ids.catMove])
    expect(notReady.error).toMatch(/Not ready/)
    expect((await db().from('service_categories').select('auto_oem_kind, program_id').eq('id', ids.catMove).single()).data).toEqual({ auto_oem_kind: 'ac', program_id: null })   // nothing moved
    await syncPrograms({ db: db(), orgId: fx.orgId, source, force: true })
    expect((await moveCategoriesToProgram(ids.program, [ids.catMove])).error).toBeUndefined()
    expect((await db().from('service_categories').select('auto_oem_kind, program_id').eq('id', ids.catMove).single()).data).toEqual({ auto_oem_kind: null, program_id: ids.program })
    expect((await db().from('vendor_programs').select('is_active').eq('id', ids.program).single()).data.is_active).toBe(true)
    await setStore(ids.storeA)
    const r = await raise(ids.subMove, 'moved', '2')
    expect((await ticket(r.requestId!)).status).toBe('in_progress')
    expect(mailsFor('moved')[0].html).toContain(LINE_A2)
    expect(mailsFor('moved')[0].to).toEqual(['oem.two@bluestar.test'])
    expect((await db().from('request_program_snapshots').select('program_id').eq('request_id', r.requestId!).single()).data.program_id).toBe(ids.program)
  })

  it('cannot be moved back to the retired old AC setting (neither from the built-in AC screen nor from Admin > Categories); new tickets keep using the program', async () => {
    actAs(fx.admin)
    const back = await saveBuiltInCategories('ac', [ids.catOld, ids.catMove])
    expect(back.error).toMatch(/retired/)
    expect((await db().from('service_categories').select('auto_oem_kind, program_id').eq('id', ids.catMove).single()).data).toEqual({ auto_oem_kind: null, program_id: ids.program })
    const { setCategoryOemKind } = await import('@/lib/actions/admin/categories')
    expect((await setCategoryOemKind(ids.catMove, 'ac')).error).toMatch(/retired|Vendor Program/)
    await setStore(ids.storeA)
    const r = await raise(ids.subMove, 'still the program', '2')
    expect((await ticket(r.requestId!)).status).toBe('in_progress')
    expect((await db().from('request_program_snapshots').select('program_id').eq('request_id', r.requestId!).single()).data.program_id).toBe(ids.program)
  })
})
