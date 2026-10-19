// OEM engineer visit reports and the store's confirmation, on the isolated audit stack (nothing leaves the machine; e-mail is a recording stub):
//  - the engineer needs the store code AND the store's daily visit code; wrong codes lock the store; the page lists only that store's open AC issues, grouped by AC;
//  - a report saves the engineer's details, the FSR photo and a note on EVERY ticket of the AC; "parts, PO needed" puts the tickets on hold and onto the parts list;
//  - the rules: engineer resolved + store resolved = resolved; engineer resolved + store not resolved = open and the OEM is e-mailed once to send an engineer again;
//    engineer not resolved + store resolved = resolved; no answer for the deadline = resolved automatically; the store is reminded once; not-resolved is never auto-resolved;
//  - only the store of the AC can answer; staff can record the PO, mark a report wrong and read a store's visit code; the tables are server-only.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
process.env.VISIT_CODE_SECRET = 'audit-visit-secret-0123456789abcdef'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest } from '@/lib/actions/requests'
import { syncMasters } from '@/lib/masters/sync'
import { checkEngineerAccess } from '@/lib/visits/access'
import { visitCodeFor } from '@/lib/visits/code'
import { loadOpenAcIssues } from '@/lib/visits/issues'
import { submitEngineerReport } from '@/lib/visits/submit'
import { runVisitAutomation } from '@/lib/visits/auto'
import { confirmVisit, savePartsPo, voidVisitReport, saveVisitSettings, lookupVisitCode } from '@/lib/actions/visits'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
const mails = () => vi.mocked(sendEmail).mock.calls as unknown as [{ to: string[]; cc?: string[]; subject: string; html: string }][]
const admin = () => getAdmin()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => admin() as any
const tag = `t35${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const S1 = `${tag}A`.toUpperCase(), S2 = `${tag}B`.toUpperCase()
const ids = { store1: '', store2: '', cat: '', sub: '' }
const made: string[] = []

const AC_HEAD = ['Store Code', 'AC Floor', 'AC Type', 'AC Tonnage', 'AC Brand', 'AC CKDESK SERIAL NO', 'AC Serial No', 'Status', 'Mail ID']
const acRow = (store: string, no: number, serial: string) => [store, 'GF', 'Ductable', '5.5 TR', 'BLUESTAR', no, serial, 'Active', 'oem-one@oem.test, desk.lead@citykartstores.com']
const SHEET = `${tag}-sheet-ac-0000000000`
const source: SheetsSource = { fetchValues: async () => [AC_HEAD, ...[1, 2, 3, 4].map((n) => acRow(S1, n, `SER-${n}`)), acRow(S2, 1, 'OTHER-1')] }

const form = (title: string, ac: string) => {
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', ids.sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}`, acno: ac }))
  return f
}
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)
async function raise(title: string, ac: string): Promise<string> {
  actAs(fx.requesterA)
  const r = await createRequest(form(title, ac))
  expect(r.error, JSON.stringify(r)).toBeUndefined()
  made.push(r.requestId!)
  return r.requestId!
}
const statusOf = async (id: string) => (await db().from('requests').select('status').eq('id', id).single()).data.status as string
const commentsOf = async (id: string) => ((await db().from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean }[]
const itemOf = async (reportId: string, ckdesk: string) => (await db().from('ac_visit_items').select('*').eq('report_id', reportId).eq('ckdesk_no', ckdesk).single()).data
const FSR = [{ name: 'fsr.jpg', mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]) }]
const report = (items: Parameters<typeof submitEngineerReport>[1]['items'], over: Partial<Parameters<typeof submitEngineerReport>[1]> = {}) =>
  submitEngineerReport(admin(), { orgId: fx.orgId, storeCode: S1, engineerName: 'Ramesh Kumar', engineerMobile: '9876543210', visitDate: new Date().toISOString().slice(0, 10), items, files: FSR, ...over })
const unitId = async (store: string, no: string) => (await db().from('master_ac_units').select('id').eq('org_id', fx.orgId).eq('store_code', store).eq('ckdesk_no', no).single()).data.id as string

let t: Record<string, string> = {}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  for (const table of ['master_issues', 'master_ac_units', 'master_gensets', 'master_store_cvm', 'master_sources', 'master_mail_templates']) await a.from(table).delete().eq('org_id', fx.orgId)
  await a.from('ac_visit_settings').delete().eq('org_id', fx.orgId)
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Test road' }).select('id').single()).data.id as string
  ids.store1 = await mkStore(S1); ids.store2 = await mkStore(S2)
  await a.from('master_sources').insert({ org_id: fx.orgId, kind: 'ac', spreadsheet_id: SHEET })
  await syncMasters({ db: a, orgId: fx.orgId, source, force: true })
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ac`, slug: `${tag}-ac`, auto_oem_kind: 'ac' }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} sub`, slug: `${tag}-sub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  await a.from('services').update({ form_fields: [
    { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 },
    { id: 'acno', type: 'select', label: 'AC Serial Number', required: false, order: 2, options: [{ value: '1', label: '1' }], options_source: 'ac_units' },
  ] }).eq('id', fx.teamA.serviceId)
  await setStore(ids.store1)
  // ALC-style example: AC 1 once, AC 2 once, AC 3 TWICE, AC 4 once
  t = { ac1: await raise('ac1 not cooling', '1'), ac2: await raise('ac2 noisy', '2'), ac3a: await raise('ac3 leak', '3'), ac3b: await raise('ac3 smell', '3'), ac4: await raise('ac4 off', '4') }
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('ac_visit_reports').delete().eq('org_id', fx.orgId)
  await a.from('ac_visit_settings').delete().eq('org_id', fx.orgId)
  for (const table of ['master_issues', 'master_ac_units', 'master_gensets', 'master_store_cvm', 'master_sources', 'master_mail_templates']) await a.from(table).delete().eq('org_id', fx.orgId)
  if (made.length) {
    await a.from('request_attachments').delete().in('request_id', made)
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('csat_surveys').delete().in('request_id', made)
    await a.from('requests').delete().in('id', made)
  }
  await a.from('service_sub_category_tags').delete().eq('sub_category_id', ids.sub)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await a.from('stores').delete().in('id', [ids.store1, ids.store2].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('getting in: the store code and the store\'s visit code', () => {
  it('refuses a wrong code, the same way for an unknown store; locks the store after five wrong tries; accepts the right code (today\'s) and not another store\'s', async () => {
    const good = visitCodeFor(fx.orgId, S1)!
    const other = visitCodeFor(fx.orgId, S2)!
    expect((await checkEngineerAccess(S1, '000000')).ok).toBe(false)
    const unknown = await checkEngineerAccess('NO-SUCH-STORE', good)
    expect(unknown.ok).toBe(false)
    expect((unknown as { error: string }).error).toBe(((await checkEngineerAccess(S1, '000001')) as { error: string }).error)
    expect((await checkEngineerAccess(S1, other)).ok).toBe(false)          // another store's code does not open this store (3 wrong so far here: 000000, 000001, other)
    expect((await checkEngineerAccess(S1, good)).ok).toBe(true)
    await checkEngineerAccess(S1, '111111'); await checkEngineerAccess(S1, '222222')   // five wrong tries
    const locked = await checkEngineerAccess(S1, good)
    expect(locked.ok).toBe(false)
    expect((locked as { status: number }).status).toBe(429)
    // a different store is not affected, and the right code works there
    expect((await checkEngineerAccess(S2, other)).ok).toBe(true)
  })

  it('the page lists only that store\'s open AC issues, grouped by AC (AC 3 has both its tickets)', async () => {
    const issues = await loadOpenAcIssues(db(), fx.orgId, S1)
    expect(issues.map((i) => i.ckdeskNo)).toEqual(['1', '2', '3', '4'])
    expect(issues.find((i) => i.ckdeskNo === '3')!.tickets).toHaveLength(2)
    expect(await loadOpenAcIssues(db(), fx.orgId, S2)).toEqual([])
  })
})

describe('the engineer\'s report', () => {
  it('is refused when something is missing or wrong', async () => {
    const u1 = await unitId(S1, '1')
    expect((await report([{ unitId: u1, status: 'resolved' }], { engineerName: 'R' })).ok).toBe(false)
    expect((await report([{ unitId: u1, status: 'resolved' }], { engineerMobile: '12345' })).ok).toBe(false)
    expect((await report([{ unitId: u1, status: 'resolved' }], { files: [] })).ok).toBe(false)
    expect((await report([{ unitId: u1, status: 'resolved' }], { visitDate: '2099-01-01' })).ok).toBe(false)
    expect((await report([])).ok).toBe(false)
    expect((await report([{ unitId: u1, status: 'not_resolved', reason: 'parts_po', parts: [] }])).ok).toBe(false)
    expect((await report([{ unitId: await unitId(S2, '1'), status: 'resolved' }])).ok).toBe(false)   // an AC of another store
    expect((await db().from('ac_visit_reports').select('id').eq('org_id', fx.orgId)).data).toHaveLength(0)
  })

  it('saves details, FSR and a note on EVERY ticket; parts needing a PO put the tickets on hold and on the parts list', async () => {
    const [u1, u2, u3, u4] = await Promise.all(['1', '2', '3', '4'].map((n) => unitId(S1, n)))
    const r = await report([
      { unitId: u1, status: 'resolved', remarks: 'cooling checked' },
      { unitId: u2, status: 'not_resolved', reason: 'parts_po', parts: [{ name: 'Compressor', qty: 1 }, { name: 'Capacitor 45uF', qty: 2 }], remarks: 'compressor seized' },
      { unitId: u3, status: 'resolved' },
      { unitId: u4, status: 'not_resolved', reason: 'come_again' },
    ])
    expect(r.ok, JSON.stringify(r)).toBe(true)
    if (!r.ok) return
    t.report1 = r.reportId
    const i3 = await itemOf(r.reportId, '3')
    expect(i3.request_ids.sort()).toEqual([t.ac3a, t.ac3b].sort())
    expect(i3.outcome).toBe('pending_store')
    expect(new Date(i3.auto_resolve_at).getTime() - new Date(i3.created_at).getTime()).toBeGreaterThan(47 * 3600_000)   // 48 hours
    for (const id of [t.ac3a, t.ac3b]) {
      expect((await commentsOf(id)).some((c) => !c.is_internal && /Engineer: Ramesh Kumar, mobile 9876543210/.test(c.body) && /Resolved/.test(c.body))).toBe(true)
      expect((await db().from('request_attachments').select('id').eq('request_id', id)).data).toHaveLength(1)
    }
    expect((await itemOf(r.reportId, '3')).fsr).toHaveLength(1)
    const i2 = await itemOf(r.reportId, '2')
    expect(i2.outcome).toBe('open'); expect(i2.po_status).toBe('to_raise'); expect(i2.parts).toEqual([{ name: 'Compressor', qty: 1 }, { name: 'Capacitor 45uF', qty: 2 }])
    expect(await statusOf(t.ac2)).toBe('hold_purchase_ho')
    expect(await statusOf(t.ac4)).toBe('in_progress')                    // come again: nothing special
    expect(await statusOf(t.ac1)).toBe('in_progress')                    // waiting for the store
  })

  it('a fresh report for the same AC replaces an unanswered one (it can no longer resolve the tickets by itself)', async () => {
    const u4 = await unitId(S1, '4')
    const first = await report([{ unitId: u4, status: 'resolved' }])
    const second = await report([{ unitId: u4, status: 'resolved', remarks: 'second visit' }])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect((await itemOf(first.reportId, '4')).outcome).toBe('void')
    expect((await itemOf(second.reportId, '4')).outcome).toBe('pending_store')
    t.report4 = second.reportId
  })
})

describe('the store answers', () => {
  it('only the store of that AC can answer', async () => {
    const i1 = await itemOf(t.report1, '1')
    actAs(fx.requesterB)                                                   // a requester of another organisation / store
    expect((await confirmVisit(i1.id, 'resolved', '')).error).toBeTruthy()
    await db().from('profiles').update({ store_id: ids.store2 }).eq('id', fx.requesterB.id)
    expect((await confirmVisit(i1.id, 'resolved', '')).error).toMatch(/not for your store/)
    await db().from('profiles').update({ store_id: null }).eq('id', fx.requesterB.id)
  })

  it('engineer resolved + store resolved: both tickets of the AC are resolved at once, with the remarks in the conversation', async () => {
    const i3 = await itemOf(t.report1, '3')
    actAs(fx.requesterA)
    const r = await confirmVisit(i3.id, 'resolved', 'checked, cooling well')
    expect(r.error).toBeUndefined()
    expect(await statusOf(t.ac3a)).toBe('resolved'); expect(await statusOf(t.ac3b)).toBe('resolved')
    expect((await itemOf(t.report1, '3')).outcome).toBe('resolved_both')
    expect((await commentsOf(t.ac3a)).some((c) => /confirmed that AC 3 is resolved/.test(c.body) && /cooling well/.test(c.body))).toBe(true)
    expect((await confirmVisit(i3.id, 'resolved', '')).error).toMatch(/already been answered/)     // a second answer is refused
    // the other AC is untouched
    expect(await statusOf(t.ac1)).toBe('in_progress')
  })

  it('engineer resolved + store NOT resolved: the ticket stays open and ONE e-mail asks the OEM to send an engineer again', async () => {
    const i1 = await itemOf(t.report1, '1')
    vi.mocked(sendEmail).mockClear()
    actAs(fx.requesterA)
    expect((await confirmVisit(i1.id, 'not_resolved', '')).error).toMatch(/what is still wrong/)   // a reason is needed
    const r = await confirmVisit(i1.id, 'not_resolved', 'Still not cooling after two hours')
    expect(r.error).toBeUndefined()
    expect(await statusOf(t.ac1)).toBe('in_progress')
    expect((await itemOf(t.report1, '1')).outcome).toBe('disputed')
    const sent = mails().filter((c) => /send an engineer again/i.test(String(c[0].subject)))
    expect(sent).toHaveLength(1)
    expect(sent[0][0].to).toEqual(['oem-one@oem.test']); expect(sent[0][0].cc).toEqual(['desk.lead@citykartstores.com'])
    expect(sent[0][0].html).toContain('Ramesh Kumar'); expect(sent[0][0].html).toContain('Still not cooling after two hours')
    expect((await itemOf(t.report1, '1')).oem_notified_at).not.toBeNull()
    expect((await commentsOf(t.ac1)).some((c) => !c.is_internal && /asked to send an engineer again/.test(c.body))).toBe(true)
  })

  it('engineer NOT resolved + store resolved: resolved (the store\'s answer is final), and the PO line is closed', async () => {
    const i2 = await itemOf(t.report1, '2')
    actAs(fx.requesterA)
    expect((await confirmVisit(i2.id, 'resolved', 'the OEM fixed it on a later day')).error).toBeUndefined()
    expect(await statusOf(t.ac2)).toBe('resolved')                       // even from "on hold for purchase"
    const row = await itemOf(t.report1, '2')
    expect(row.outcome).toBe('resolved_by_store'); expect(row.po_status).toBe('done')
  })

  it('engineer NOT resolved + store NOT resolved: stays open, nothing is e-mailed', async () => {
    const u = await unitId(S1, '4')
    const r = await report([{ unitId: u, status: 'not_resolved', reason: 'come_again', remarks: 'needs a ladder' }])
    expect(r.ok).toBe(true); if (!r.ok) return
    vi.mocked(sendEmail).mockClear()
    actAs(fx.requesterA)
    expect((await confirmVisit((await itemOf(r.reportId, '4')).id, 'not_resolved', 'still broken')).error).toBeUndefined()
    expect((await itemOf(r.reportId, '4')).outcome).toBe('open')
    expect(mails().filter((c) => /send an engineer again/i.test(String(c[0].subject)))).toHaveLength(0)
    expect(await statusOf(t.ac4)).toBe('in_progress')
  })
})

describe('no answer from the store', () => {
  it('after the deadline an unanswered "resolved" resolves the tickets by itself; "not resolved" is never touched', async () => {
    const u1 = await unitId(S1, '1')
    const r = await report([{ unitId: u1, status: 'resolved', remarks: 'rechecked' }])
    expect(r.ok).toBe(true); if (!r.ok) return
    const item = await itemOf(r.reportId, '1')
    const before = await runVisitAutomation(admin(), new Date())
    expect(before.autoResolved).toBe(0)                                  // not yet due
    expect(await statusOf(t.ac1)).toBe('in_progress')
    const later = new Date(new Date(item.auto_resolve_at).getTime() + 60_000)
    const run = await runVisitAutomation(admin(), later)
    expect(run.autoResolved).toBeGreaterThanOrEqual(1)
    expect(await statusOf(t.ac1)).toBe('resolved')
    expect((await itemOf(r.reportId, '1')).outcome).toBe('resolved_auto')
    expect((await commentsOf(t.ac1)).some((c) => /Resolved automatically/.test(c.body) && /did not answer within 48 hours/.test(c.body))).toBe(true)
    expect((await runVisitAutomation(admin(), later)).autoResolved).toBe(0)           // never twice
    // the engineer's own "not resolved" item for AC 4 was not touched
    expect(await statusOf(t.ac4)).toBe('in_progress')
  })

  it('the store is reminded once after the reminder time', async () => {
    const u4 = await unitId(S1, '4')
    const r = await report([{ unitId: u4, status: 'resolved' }])
    expect(r.ok).toBe(true); if (!r.ok) return
    const item = await itemOf(r.reportId, '4')
    const at25h = new Date(new Date(item.created_at).getTime() + 25 * 3600_000)
    const first = await runVisitAutomation(admin(), at25h)
    expect(first.reminded).toBeGreaterThanOrEqual(1)
    expect((await itemOf(r.reportId, '4')).reminder_sent_at).not.toBeNull()
    expect((await runVisitAutomation(admin(), at25h)).reminded).toBe(0)
    expect(await statusOf(t.ac4)).toBe('in_progress')                      // reminded, not resolved
  })
})

describe('technicians, managers and administrators', () => {
  it('a technician records the OEM\'s parts list and the PO; a store cannot', async () => {
    const u2 = await unitId(S1, '2')
    await db().from('requests').update({ status: 'in_progress' }).eq('id', t.ac2)
    const r = await report([{ unitId: u2, status: 'not_resolved', reason: 'parts_po', parts: [{ name: 'Fan motor', qty: 1 }] }])
    expect(r.ok).toBe(true); if (!r.ok) return
    const item = await itemOf(r.reportId, '2')
    actAs(fx.requesterA)
    expect((await savePartsPo(item.id, { oemPartsNote: 'x', poNumber: 'PO-1', poDate: '2026-10-19', poVendor: 'Blue Star', poStatus: 'raised' })).error).toMatch(/technician/)
    actAs(fx.agentA)
    expect((await savePartsPo(item.id, { oemPartsNote: '', poNumber: '', poDate: '', poVendor: '', poStatus: 'raised' })).error).toMatch(/PO number/)
    const ok = await savePartsPo(item.id, { oemPartsNote: 'Fan motor 1/4 HP, 1 pc (from the OEM mail)', poNumber: 'PO-7781', poDate: '2026-10-19', poVendor: 'Blue Star', poStatus: 'raised' })
    expect(ok.error).toBeUndefined()
    const saved = await itemOf(r.reportId, '2')
    expect(saved).toMatchObject({ po_number: 'PO-7781', po_status: 'raised', po_vendor: 'Blue Star' })
    expect((await commentsOf(t.ac2)).some((c) => !c.is_internal && /PO raised \(PO PO-7781/.test(c.body))).toBe(true)
  })

  it('a report can be marked wrong: its unanswered items are cancelled and can no longer resolve anything', async () => {
    const u4 = await unitId(S1, '4')
    const r = await report([{ unitId: u4, status: 'resolved' }])
    expect(r.ok).toBe(true); if (!r.ok) return
    actAs(fx.requesterA)
    expect((await voidVisitReport(r.reportId, 'wrong store')).error).toMatch(/technician/)
    actAs(fx.agentA)
    expect((await voidVisitReport(r.reportId, 'x')).error).toMatch(/why/)
    expect((await voidVisitReport(r.reportId, 'engineer entered the wrong store')).error).toBeUndefined()
    const item = await itemOf(r.reportId, '4')
    expect(item.outcome).toBe('void')
    const far = new Date(Date.now() + 10 * 24 * 3600_000)
    await runVisitAutomation(admin(), far)
    expect(await statusOf(t.ac4)).toBe('in_progress')
    actAs(fx.requesterA)
    expect((await confirmVisit(item.id, 'resolved', '')).error).toBeTruthy()
  })

  it('an administrator sets the hours (a reminder must come first); others cannot; a technician can read a store\'s visit code', async () => {
    actAs(fx.agentA)
    expect((await saveVisitSettings(72, 24)).error).toMatch(/Administrator/)
    actAs(fx.admin)
    expect((await saveVisitSettings(24, 48)).error).toMatch(/before/)
    expect((await saveVisitSettings(0, 0)).error).toBeTruthy()
    expect((await saveVisitSettings(72, 36)).error).toBeUndefined()
    const u4 = await unitId(S1, '4')
    const r = await report([{ unitId: u4, status: 'resolved' }])
    expect(r.ok).toBe(true); if (!r.ok) return
    const item = await itemOf(r.reportId, '4')
    expect(new Date(item.auto_resolve_at).getTime() - new Date(item.created_at).getTime()).toBeGreaterThan(71 * 3600_000)
    await db().from('ac_visit_items').update({ outcome: 'void' }).eq('id', item.id)
    actAs(fx.requesterA)
    expect((await lookupVisitCode(S1)).error).toMatch(/technician/)
    actAs(fx.agentA)
    expect((await lookupVisitCode(S1)).code).toBe(visitCodeFor(fx.orgId, S1))
    expect((await lookupVisitCode('NO-SUCH')).error).toMatch(/No store/)
  })

  it('the visit tables are for the server only', async () => {
    const user = clientForToken(fx.requesterA.accessToken) as never as { from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<{ error: unknown }> } } }
    for (const table of ['ac_visit_reports', 'ac_visit_items', 'ac_visit_settings']) expect((await user.from(table).select('*').limit(1)).error, table).not.toBeNull()
  })
})
