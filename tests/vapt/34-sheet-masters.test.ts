// The AC / Genset / CVM Google Sheets as the master, on the isolated audit stack (the sheets are replaced by fixed rows; nothing goes to Google):
//  - the sheets are copied into the database; an Inactive AC leaves the store's list; a corrected / renumbered row keeps its unit; a broken sheet is not applied;
//  - a big disappearance is only applied at a later update; the store details follow the AC sheet;
//  - an AC ticket is mailed to the chosen AC's addresses (OEM in To, company people in CC) and saves the AC's details; an AC that is not active for the store is refused;
//  - a Genset ticket goes in ONE mail to every genset row of the store; nothing in the sheet means the ticket stays Open with a note;
//  - the CVM comes from the CVM sheet: the approval goes to that staff member; no CVM / no staff login means Open with a note.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest, updateRequestStatus } from '@/lib/actions/requests'
import { approveApproval } from '@/lib/actions/approvals'
import { syncMasters } from '@/lib/masters/sync'
import { loadAcOptionsForStoreCode } from '@/lib/masters/resolve'
import { suggestedCvmForRequest } from '@/lib/cvm/suggest'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
const mails = () => vi.mocked(sendEmail).mock.calls as unknown as [{ to: string[]; cc?: string[]; subject: string; html: string }][]
const admin = () => getAdmin()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => admin() as any
const tag = `t34${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b'), C = code('c'), D = code('d'), E = code('e')
const ids = { storeA: '', storeB: '', storeD: '', storeE: '', catAc: '', catGenset: '', catFixture: '', subAc: '', subGenset: '', subFixture: '' }
const made: string[] = []

const AC_HEAD = ['Store Code', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC CKDESK SERIAL NO', 'AC Serial No', 'AC-AMC vendor', 'AC-AMC Brand', 'Zenatix (yes/No)', 'Store Priority list', 'Festival', 'Region', 'Cluster', 'Opening date', 'City', 'State', 'Address', 'pincode', 'Status', 'Mail ID']
const acRow = (store: string, no: number | string, serial: string, status = 'Active', mail = 'oem-one@oem.test, oem-two@oem.test, desk.lead@citykartstores.com') =>
  [store, 'GF', 'Ductable', '5.5 TR', 'BLUESTAR', no, serial, 'BLUESTAR', 'STAR COOLING', 'NO', 'ROS', 'PUJA', 'R6', 'NE', 46250, 'Pakur', 'JH', 'Khata 490 Pakur', 816107, status, mail]
const GS_HEAD = ['Store Code', 'Genset Brand', 'Genset KVA', 'Genset Serial No', 'CPCB Group', 'Mail ID']
const SHEET = { ac: `${tag}-sheet-ac-0000000000`, genset: `${tag}-sheet-gs-0000000000`, cvm: `${tag}-sheet-cv-0000000000` }
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const sync = (now?: Date) => syncMasters({ db: db(), orgId: fx.orgId, source, now, force: true })
const unitsOf = async (store: string) => ((await db().from('master_ac_units').select('*').eq('org_id', fx.orgId).eq('store_code', store)).data ?? []) as { id: string; ckdesk_no: string; serial: string | null; is_active: boolean; removed_at: string | null; missing_since: string | null }[]

const form = (sub: string, title: string, ac?: string) => {
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}`, ...(ac !== undefined ? { acno: ac } : {}) }))
  return f
}
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)
async function raise(sub: string, title: string, ac?: string) {
  actAs(fx.requesterA)
  const r = await createRequest(form(sub, title, ac))
  if (r.requestId) made.push(r.requestId)
  return r
}
async function ticket(id: string): Promise<{ id: string; status: string; request_no: string; comments: { body: string; is_internal: boolean }[]; approvals: { id: string; status: string; workflow_id: string }[] }> {
  const t = (await db().from('requests').select('id, status, request_no').eq('id', id).single()).data
  const comments = ((await db().from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean }[]
  const approvals = ((await db().from('approvals').select('id, status, workflow_id').eq('request_id', id)).data ?? []) as { id: string; status: string; workflow_id: string }[]
  return { ...t, comments, approvals }
}

const clearMasters = async () => { for (const table of ['master_issues', 'master_ac_units', 'master_gensets', 'master_store_cvm', 'master_sources', 'master_mail_templates']) await db().from(table).delete().eq('org_id', fx.orgId) }

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  await clearMasters()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'old address' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B); ids.storeD = await mkStore(D); ids.storeE = await mkStore(E)
  for (const [kind, id] of Object.entries(SHEET)) await a.from('master_sources').insert({ org_id: fx.orgId, kind, spreadsheet_id: id })
  const mkCat = async (name: string, extra: Record<string, unknown>) => (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${name}`, slug: `${tag}-${name}`, ...extra }).select('id').single()).data.id as string
  ids.catAc = await mkCat('ac', { auto_oem_kind: 'ac' }); ids.catGenset = await mkCat('genset', { auto_oem_kind: 'genset' }); ids.catFixture = await mkCat('fixture', { auto_cvm_approval: true })
  const mkSub = async (cat: string, name: string) => {
    const s = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${name}`, slug: `${tag}-${name}` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: s })
    return s
  }
  ids.subAc = await mkSub(ids.catAc, 'sub-ac'); ids.subGenset = await mkSub(ids.catGenset, 'sub-gs'); ids.subFixture = await mkSub(ids.catFixture, 'sub-fx')
  // the service asks for an AC number whose choices come from the AC sheet
  await a.from('services').update({
    form_fields: [
      { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 },
      { id: 'acno', type: 'select', label: 'AC Serial Number', required: false, order: 2, options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }], options_source: 'ac_units' },
    ],
  }).eq('id', fx.teamA.serviceId)

  sheets[SHEET.ac] = [AC_HEAD, acRow(A, 1, 'SER-A1'), acRow(A, 2, 'SER-A2', 'Inactive'), acRow(A, 3, 'SER-A3'), acRow(D, 1, 'SER-D1', 'Active', ''), acRow(E, 1, 'SER-E1')]
  sheets[SHEET.genset] = [
    GS_HEAD,
    [B, 'MAHINDRA', 125, 'GS-B1', 'CPCB-II', 'gs-one@oem.test, kuld,ep.x@oem.test, boss@citykartstores.com'],
    [B, 'CUMMINS', 40, 'GS-B2', 'CPCB-IV', 'gs-two@oem.test'],
  ]
  sheets[SHEET.cvm] = [['Store Code', 'CVM EMAIL ID'], [A, fx.agentA.email.toUpperCase()], [E, 'nobody.here@citykartstores.com']]
  await sync()
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  await clearMasters()
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  if (made.length) {
    const wf = ((await a.from('approvals').select('workflow_id').in('request_id', made)).data ?? []).map((x: { workflow_id: string }) => x.workflow_id)
    await a.from('approvals').delete().in('request_id', made)
    if (wf.length) { await a.from('approval_workflow_steps').delete().in('workflow_id', wf); await a.from('approval_workflows').delete().in('id', wf) }
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('service_sub_category_tags').delete().in('sub_category_id', [ids.subAc, ids.subGenset, ids.subFixture].filter(Boolean))
  await a.from('service_sub_categories').delete().in('id', [ids.subAc, ids.subGenset, ids.subFixture].filter(Boolean))
  await a.from('service_categories').delete().in('id', [ids.catAc, ids.catGenset, ids.catFixture].filter(Boolean))
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB, ids.storeD, ids.storeE].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('the sheets are copied into the database', () => {
  it('stores the units, flags what is wrong, and gives the store only its Active ACs', async () => {
    const opts = await loadAcOptionsForStoreCode(db(), fx.orgId, A)
    expect(opts.map((o) => o.value)).toEqual(['1', '3'])   // 2 is Inactive
    const issues = ((await db().from('master_issues').select('kind, code, store_code').eq('org_id', fx.orgId)).data ?? []) as { kind: string; code: string; store_code: string | null }[]
    expect(issues.some((i) => i.kind === 'genset' && i.code === 'bad_email')).toBe(true)
    expect(issues.some((i) => i.kind === 'genset' && i.code === 'store_has_several_gensets' && i.store_code === B)).toBe(true)
    expect(issues.some((i) => i.kind === 'ac' && i.code === 'no_email' && i.store_code === D)).toBe(true)
    expect(issues.some((i) => i.kind === 'cvm' && i.code === 'unknown_store')).toBe(false)
  })
  it('the AC sheet feeds the store details one way (count of Active ACs, address, opening date)', async () => {
    const s = (await db().from('stores').select('ac_total, address, city, state, open_date, ac_brand').eq('id', ids.storeA).single()).data
    expect(s).toMatchObject({ ac_total: 2, address: 'Khata 490 Pakur', city: 'Pakur', state: 'JH', open_date: '2026-08-16', ac_brand: 'BLUESTAR' })
  })
  it('an AC marked Inactive leaves the list at the next update, and comes back when it is Active again', async () => {
    sheets[SHEET.ac][3] = acRow(A, 3, 'SER-A3', 'Inactive')
    await sync()
    expect((await loadAcOptionsForStoreCode(db(), fx.orgId, A)).map((o) => o.value)).toEqual(['1'])
    expect((await db().from('stores').select('ac_total').eq('id', ids.storeA).single()).data.ac_total).toBe(1)
    sheets[SHEET.ac][3] = acRow(A, 3, 'SER-A3')
    await sync()
    expect((await loadAcOptionsForStoreCode(db(), fx.orgId, A)).map((o) => o.value)).toEqual(['1', '3'])
  })
  it('renumbering rows keeps each machine\'s unit, a deleted row is kept as removed, a corrected serial keeps its unit', async () => {
    const before = await unitsOf(A)
    const idOf = (serial: string) => before.find((u) => u.serial === serial)!.id
    // the team deletes AC 1 and renumbers 3 -> 1; the serial of AC 2 is corrected
    sheets[SHEET.ac] = [AC_HEAD, acRow(A, 1, 'SER-A3'), acRow(A, 2, 'SER-A2-fixed', 'Inactive'), acRow(D, 1, 'SER-D1', 'Active', ''), acRow(E, 1, 'SER-E1')]
    await sync()
    const after = await unitsOf(A)
    expect(after.find((u) => u.id === idOf('SER-A3'))).toMatchObject({ ckdesk_no: '1', removed_at: null })
    expect(after.find((u) => u.id === idOf('SER-A2'))).toMatchObject({ serial: 'SER-A2-fixed' })
    expect(after.find((u) => u.id === idOf('SER-A1'))!.removed_at).not.toBeNull()
    expect((await loadAcOptionsForStoreCode(db(), fx.orgId, A)).map((o) => o.value)).toEqual(['1'])
    // restore for the next tests
    sheets[SHEET.ac] = [AC_HEAD, acRow(A, 1, 'SER-A1'), acRow(A, 2, 'SER-A2-fixed', 'Inactive'), acRow(A, 3, 'SER-A3'), acRow(D, 1, 'SER-D1', 'Active', ''), acRow(E, 1, 'SER-E1')]
    await sync()
    expect((await loadAcOptionsForStoreCode(db(), fx.orgId, A)).map((o) => o.value)).toEqual(['1', '3'])
  })
  it('a sheet that lost a required column is not applied: the last good copy stays', async () => {
    const saved = sheets[SHEET.ac]
    sheets[SHEET.ac] = [['Store Code', 'Status'], [A, 'Active']]
    const r = await sync()
    expect(r.ac.status).toBe('error')
    expect((await loadAcOptionsForStoreCode(db(), fx.orgId, A)).map((o) => o.value)).toEqual(['1', '3'])
    const src = (await db().from('master_sources').select('last_status, last_error').eq('org_id', fx.orgId).eq('kind', 'ac').single()).data
    expect(src.last_status).toBe('error')
    expect(src.last_error).toMatch(/AC CKDESK SERIAL NO/)
    sheets[SHEET.ac] = saved
    expect((await sync()).ac.status).toBe('ok')
  })
  it('a sheet Google cannot deliver is not applied either', async () => {
    delete sheets[SHEET.genset]
    const r = await sync()
    expect(r.genset.status).toBe('error')
    expect((await db().from('master_gensets').select('id').eq('org_id', fx.orgId).is('removed_at', null)).data).toHaveLength(2)
    sheets[SHEET.genset] = [
      GS_HEAD,
      [B, 'MAHINDRA', 125, 'GS-B1', 'CPCB-II', 'gs-one@oem.test, kuld,ep.x@oem.test, boss@citykartstores.com'],
      [B, 'CUMMINS', 40, 'GS-B2', 'CPCB-IV', 'gs-two@oem.test'],
    ]
    await sync()
  })
  it('a big disappearance is only applied at a later update (a mistake can be undone)', async () => {
    const many = Array.from({ length: 25 }, (_, i) => acRow(C, i + 1, `SER-C${i + 1}`))
    sheets[SHEET.ac] = [...sheets[SHEET.ac], ...many]
    await sync()
    expect((await unitsOf(C)).filter((u) => !u.removed_at)).toHaveLength(25)
    // somebody deletes them all by mistake
    sheets[SHEET.ac] = sheets[SHEET.ac].slice(0, sheets[SHEET.ac].length - 25)
    const t0 = new Date()
    await sync(t0)
    let c = await unitsOf(C)
    expect(c.filter((u) => !u.removed_at)).toHaveLength(25)           // still there
    expect(c.every((u) => u.missing_since)).toBe(true)
    // undone in time: nothing is lost
    sheets[SHEET.ac] = [...sheets[SHEET.ac], ...many]
    await sync(new Date(t0.getTime() + 10 * 60_000))
    c = await unitsOf(C)
    expect(c.filter((u) => !u.removed_at && !u.missing_since)).toHaveLength(25)
    // deleted again and still missing at a later update: now they are removed
    sheets[SHEET.ac] = sheets[SHEET.ac].slice(0, sheets[SHEET.ac].length - 25)
    const t1 = new Date(t0.getTime() + 20 * 60_000)
    await sync(t1)
    await sync(new Date(t1.getTime() + 31 * 60_000))
    expect((await unitsOf(C)).filter((u) => !u.removed_at)).toHaveLength(0)
    expect((await unitsOf(C))).toHaveLength(25)                        // kept as removed, never deleted
  })
})

describe('an AC ticket goes to the OEM of the AC the requester chose', () => {
  it('one mail: OEM in To, company people in CC; the AC is saved with the ticket; status In Process', async () => {
    vi.mocked(sendEmail).mockClear()
    await setStore(ids.storeA)
    const r = await raise(ids.subAc, 'ac not cooling', '3')
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    const calls = mails().filter((c) => /AC Issue/.test(String(c[0].subject)))
    expect(calls).toHaveLength(1)
    expect(calls[0][0].to).toEqual(['oem-one@oem.test', 'oem-two@oem.test'])
    expect(calls[0][0].cc).toEqual(['desk.lead@citykartstores.com'])
    expect(String(calls[0][0].html)).toContain('SER-A3')
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('in_progress')
    expect(t.comments.some((c) => !c.is_internal && /sent to the AC OEM/.test(c.body) && /CC: desk\.lead@citykartstores\.com/.test(c.body))).toBe(true)
    const snap = (await db().from('request_master_snapshots').select('kind, snapshot, mailed_to, mailed_cc').eq('request_id', r.requestId!).single()).data
    expect(snap.kind).toBe('ac')
    expect(snap.snapshot[0]).toMatchObject({ ckdesk_no: '3', serial: 'SER-A3', brand: 'BLUESTAR' })
    expect(snap.mailed_to).toEqual(['oem-one@oem.test', 'oem-two@oem.test'])
  })
  it('when the store reopens the resolved ticket the OEM is e-mailed again, for the same AC, marked REOPENED with the reason of the store', async () => {
    await setStore(ids.storeA)
    const r = await raise(ids.subAc, 'ac stopped again', '3')
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    // resolved earlier (set directly: this test is about the reopen)
    await db().from('requests').update({ status: 'resolved', resolved_at: new Date().toISOString(), reopen_deadline_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', r.requestId!)
    vi.mocked(sendEmail).mockClear()
    actAs(fx.requesterA)
    const res = await updateRequestStatus(r.requestId!, 'open', 'The AC is not cooling again after two days')
    expect(res.error, JSON.stringify(res)).toBeUndefined()
    const sent = mails().filter((c) => /REOPENED/.test(String(c[0].subject)))
    expect(sent).toHaveLength(1)
    expect(sent[0][0].to).toEqual(['oem-one@oem.test', 'oem-two@oem.test'])
    expect(sent[0][0].cc).toEqual(['desk.lead@citykartstores.com'])
    expect(String(sent[0][0].html)).toContain('SER-A3')
    expect(String(sent[0][0].html)).toContain('not cooling again after two days')
    expect((await ticket(r.requestId!)).status).toBe('in_progress')
    // the first mailing's record (which unit, who was mailed) is kept as it was
    expect((await db().from('request_master_snapshots').select('snapshot').eq('request_id', r.requestId!).single()).data.snapshot[0]).toMatchObject({ ckdesk_no: '3' })
  })
  it('a reopened ticket that was never sent to an OEM sends nothing', async () => {
    await setStore(ids.storeA)
    const r = await raise(ids.subFixture, 'plain ticket')
    await db().from('requests').update({ status: 'resolved', resolved_at: new Date().toISOString(), reopen_deadline_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', r.requestId!)
    vi.mocked(sendEmail).mockClear()
    actAs(fx.requesterA)
    await updateRequestStatus(r.requestId!, 'open', 'not fixed')
    expect(mails().filter((c) => /REOPENED/.test(String(c[0].subject)))).toHaveLength(0)
  })
  it('an AC that is not active for the store is refused', async () => {
    await setStore(ids.storeA)
    const r = await raise(ids.subAc, 'ac inactive', '2')
    expect(r.error).toMatch(/not an active AC of your store/)
    const r2 = await raise(ids.subAc, 'ac unknown', '9')
    expect(r2.error).toMatch(/not an active AC of your store/)
  })
  it('an AC with no address in the sheet and no other address in the store: Open with an internal note, nothing sent', async () => {
    vi.mocked(sendEmail).mockClear()
    await setStore(ids.storeD)
    const r = await raise(ids.subAc, 'ac no mail', '1')
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('open')
    expect(t.comments.some((c) => c.is_internal && /no e-mail address for store/.test(c.body))).toBe(true)
    expect(mails().filter((c) => /AC Issue/.test(String(c[0].subject)))).toHaveLength(0)
  })
  it('a store that is not in the AC sheet at all: Open with an internal note', async () => {
    await setStore(ids.storeB)
    const r = await raise(ids.subAc, 'ac no store rows')
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('open')
    expect(t.comments.some((c) => c.is_internal && /no active AC in the AC sheet/.test(c.body))).toBe(true)
  })
})

describe('a Genset ticket goes to the store\'s genset rows in one mail', () => {
  it('two genset rows: one mail to every address (a broken address skipped), listing both gensets', async () => {
    vi.mocked(sendEmail).mockClear()
    await setStore(ids.storeB)
    const r = await raise(ids.subGenset, 'genset down')
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    const calls = mails().filter((c) => /Genset Issue/.test(String(c[0].subject)))
    expect(calls).toHaveLength(1)
    expect([...(calls[0][0].to as string[])].sort()).toEqual(['ep.x@oem.test', 'gs-one@oem.test', 'gs-two@oem.test'])
    expect(calls[0][0].cc).toEqual(['boss@citykartstores.com'])
    expect(String(calls[0][0].html)).toContain('GS-B1')
    expect(String(calls[0][0].html)).toContain('GS-B2')
    expect((await ticket(r.requestId!)).status).toBe('in_progress')
  })
  it('a store that is not in the Genset sheet: Open, internal note, no mail', async () => {
    vi.mocked(sendEmail).mockClear()
    await setStore(ids.storeA)
    const r = await raise(ids.subGenset, 'genset no row')
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('open')
    expect(t.comments.some((c) => c.is_internal && /not in the Genset sheet/.test(c.body))).toBe(true)
    expect(mails().filter((c) => /Genset Issue/.test(String(c[0].subject)))).toHaveLength(0)
  })
  it('a requester with no store: Open with an internal note', async () => {
    await setStore(null)
    const r = await raise(ids.subGenset, 'genset no store')
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('open')
    expect(t.comments.some((c) => c.is_internal && /not linked to a store/.test(c.body))).toBe(true)
  })
})

describe('the CVM comes from the CVM sheet', () => {
  it('the approval goes to the staff member whose e-mail the sheet lists (any capitals); the ticket is on hold in Pending Approval', async () => {
    await setStore(ids.storeA)
    const r = await raise(ids.subFixture, 'fixtures')
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('pending_approval')
    expect(t.approvals).toHaveLength(1)
    const steps = (await db().from('approval_workflow_steps').select('approver_user_id').eq('workflow_id', t.approvals[0].workflow_id)).data
    expect(steps.map((s: { approver_user_id: string }) => s.approver_user_id)).toEqual([fx.agentA.id])
    expect(t.comments.some((c) => !c.is_internal && /sent for approval to .*the CVM of your store/.test(c.body))).toBe(true)
    actAs(fx.agentA)
    expect((await approveApproval(t.approvals[0].id, 'ok')).error).toBeUndefined()
    expect((await db().from('requests').select('status').eq('id', t.id).single()).data.status).toBe('in_progress')
  })
  it('a store the CVM sheet does not list: Open, internal note, no approval', async () => {
    await setStore(ids.storeB)
    const t = await ticket((await raise(ids.subFixture, 'fixtures no cvm')).requestId!)
    expect(t.status).toBe('open')
    expect(t.approvals).toHaveLength(0)
    expect(t.comments.some((c) => c.is_internal && /No CVM is listed for this store in the CVM sheet/.test(c.body))).toBe(true)
  })
  it('a CVM e-mail that is not an active staff member in CK Desk: Open, internal note naming the address', async () => {
    await setStore(ids.storeE)
    const t = await ticket((await raise(ids.subFixture, 'fixtures cvm not staff')).requestId!)
    expect(t.status).toBe('open')
    expect(t.approvals).toHaveLength(0)
    expect(t.comments.some((c) => c.is_internal && /nobody\.here@citykartstores\.com\) is not an active staff member/.test(c.body))).toBe(true)
  })
})

describe('the CVM is offered as the approver, and a failing OEM mail is reported', () => {
  it('suggests the CVM listed for the requesting store to a technician or manager sending the ticket, and nobody when it is the sender, the store is not listed, or the requester has no store', async () => {
    await setStore(ids.storeA)
    expect((await suggestedCvmForRequest({ requesterId: fx.requesterA.id, orgId: fx.orgId, viewerId: fx.manager.id }))?.id).toBe(fx.agentA.id)
    expect(await suggestedCvmForRequest({ requesterId: fx.requesterA.id, orgId: fx.orgId, viewerId: fx.agentA.id })).toBeNull()
    await setStore(ids.storeB)
    expect(await suggestedCvmForRequest({ requesterId: fx.requesterA.id, orgId: fx.orgId, viewerId: fx.manager.id })).toBeNull()
    await setStore(null)
    expect(await suggestedCvmForRequest({ requesterId: fx.requesterA.id, orgId: fx.orgId, viewerId: fx.manager.id })).toBeNull()
  })
  it('when the OEM mail cannot be sent the ticket is not told it was sent: it stays Open with an internal note', async () => {
    // only the OEM mail fails (the other mails of a new ticket, for example to the requester, go through)
    vi.mocked(sendEmail).mockImplementation(async (p: { subject: string }) => (/AC Issue/.test(p.subject) ? { error: 'smtp down' } : {}))
    await setStore(ids.storeA)
    const r = await raise(ids.subAc, 'ac mail fails', '1')
    vi.mocked(sendEmail).mockImplementation(async () => ({}))
    expect(r.error, JSON.stringify(r)).toBeUndefined()
    const t = await ticket(r.requestId!)
    expect(t.status).toBe('open')
    expect(t.comments.some((c) => c.is_internal && /could not be sent/.test(c.body))).toBe(true)
    expect(t.comments.some((c) => !c.is_internal && /sent to the AC OEM/.test(c.body))).toBe(false)
  })
})

describe('the master tables are for the server only', () => {
  it('a signed-in user cannot read or write them through the data API', async () => {
    const user = clientForToken(fx.requesterA.accessToken)
    for (const table of ['master_ac_units', 'master_gensets', 'master_store_cvm', 'master_sources', 'master_issues', 'master_mail_templates', 'master_google_connection', 'request_master_snapshots']) {
      const read = await (user as never as { from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<{ error: unknown }> } } }).from(table).select('*').limit(1)
      expect(read.error, table).not.toBeNull()
    }
    const write = await (user as never as { from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> } }).from('master_ac_units').insert({ org_id: fx.orgId, store_code: 'X', ckdesk_no: '1' })
    expect(write.error).not.toBeNull()
  })
})

describe('the AC sheet columns OEM Ticket Mail To / OEM PO Mail To / CK PO Approver Mail To', () => {
  it('are stored per AC; an approver that is not an active staff login gets a health-page warning; the old headings still work', async () => {
    const saved = sheets[SHEET.ac]
    const head = [...AC_HEAD.slice(0, 20), 'OEM Ticket Mail To', 'OEM PO Mail To', 'CK PO Approver Mail To']
    const row = (store: string, no: number, serial: string, approvers: string) => [...acRow(store, no, serial).slice(0, 20), 'oem-new@oem.test', 'po-new@oem.test', approvers]
    sheets[SHEET.ac] = [head, row(A, 1, 'SER-A1', `${fx.agentA.email}; nobody.here@citykartstores.com`), row(E, 1, 'SER-E1', '')]
    const known = async (email: string) => (email.toLowerCase() === fx.agentA.email.toLowerCase() ? 'ok' as const : 'unknown' as const)
    await syncMasters({ db: db(), orgId: fx.orgId, source, force: true, cvmEmailKnown: known })
    const a1 = (await unitsOf(A)).find((u) => u.ckdesk_no === '1') as unknown as { emails: string[]; po_emails: string[]; approver_emails: string[] }
    expect(a1.emails).toEqual(['oem-new@oem.test']); expect(a1.po_emails).toEqual(['po-new@oem.test'])
    expect(a1.approver_emails).toEqual([fx.agentA.email.toLowerCase(), 'nobody.here@citykartstores.com'])
    const e1 = (await unitsOf(E))[0] as unknown as { approver_emails: string[] }
    expect(e1.approver_emails).toEqual([])
    const issues = ((await db().from('master_issues').select('kind, code, message').eq('org_id', fx.orgId)).data ?? []) as { kind: string; code: string; message: string }[]
    const warn = issues.find((i) => i.kind === 'ac' && i.code === 'approver_no_login')
    expect(warn?.message).toContain('nobody.here@citykartstores.com')
    expect(issues.some((i) => i.code === 'approver_no_login' && i.message.includes(fx.agentA.email))).toBe(false)
    sheets[SHEET.ac] = saved
    await sync()   // back to the old-heading sheet the other tests use
    expect(((await unitsOf(A)).find((u) => u.ckdesk_no === '1') as unknown as { emails: string[] }).emails.length).toBeGreaterThan(0)
  })
})
