// AC PMS on the isolated audit stack (the sheet is replaced by fixed rows, mail goes nowhere):
//  - the PMS sheet is copied into the database (store + date); a date that cannot be read, a store that does not exist and a missing date are reported;
//  - one ticket per store and PMS date, from 09:00 India time on that day only (a date that has passed is never made); the same date never makes two tickets,
//    not even when two runs overlap; a store with no login or no store record is reported, not forgotten; a date removed from the sheet leaves the tickets alone;
//  - a PMS ticket starts without an OEM ticket number and is resolved with a PMS report (no resolution list); a normal ticket still needs the OEM ticket number;
//  - the vendor's two tabs never share a ticket.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, createTestUser, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; subject: string; html: string; text?: string }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { syncMasters } from '@/lib/masters/sync'
import { createDuePmsTickets } from '@/lib/pms/tickets'
import { vendorResolve, vendorStartWorking } from '@/lib/actions/vendor'
import { getVendorTickets, ticketsOfTab } from '@/lib/queries/vendor'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t40${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b'), C = code('c'), D = code('d')
const ids = { storeA: '', storeB: '', catPms: '', catNormal: '', subPms: '', subNormal: '', co: '' }
const made: string[] = []
const rules: string[] = []
const SHEET = `${tag}-sheet-pms-000000000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const sync = () => syncMasters({ db: db(), orgId: fx.orgId, source, force: true })
// 08:30 and 09:30 India time on 26 Oct 2026
const T0830 = new Date('2026-10-26T03:00:00Z')
const T0900 = new Date('2026-10-26T03:30:00Z')
const T0900_27 = new Date('2026-10-27T03:30:00Z')   // the next day
const HEAD = ['Store Code', 'AC PMS Date']
const pmsTickets = async () => ((await db().from('requests').select('id, title, status, category_id, sub_category_id, service_id, requester_id, source_metadata').eq('category_id', ids.catPms).like('title', `%${tag}%`).order('created_at')).data ?? []) as
  { id: string; title: string; status: string; category_id: string; sub_category_id: string; service_id: string; requester_id: string; source_metadata: { pms_date?: string; pms_source?: string } }[]
const pmsIssues = async () => ((await db().from('master_issues').select('code, severity, message, store_code').eq('org_id', fx.orgId).eq('kind', 'pms')).data ?? []) as { code: string; severity: string; message: string; store_code: string | null }[]
const logOf = async (store: string, date: string) => (await db().from('pms_ticket_log').select('status, request_id, note').eq('org_id', fx.orgId).eq('store_code', store).eq('pms_date', date).maybeSingle()).data as { status: string; request_id: string | null; note: string | null } | null

let v1: TestUser
const OEM_SECTIONS = [{ id: 's1', title: 'AC', order: 1, fields: [
  { id: 'oemno', type: 'text', label: 'AC OEM Ticket Number', required: true, order: 1 },
  { id: 'oemdt', type: 'date', label: 'AC OEM Ticket Creation Date', required: true, order: 2 },
  { id: 'acres', type: 'select', label: 'AC resolution', required: true, order: 3, options: [{ value: 'r1', label: 'GAS FILLED' }] },
] }]
async function vendorTicket(category: string, title: string): Promise<string> {
  const r = (await db().from('requests').insert({
    request_no: '', title: `${tag} ${title}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: v1.id, status: 'open',
    category_id: category, form_sections_snapshot: OEM_SECTIONS, form_data: {},
  }).select('id').single()).data.id as string
  made.push(r)
  return r
}
const fsr = async (id: string, by: TestUser) => (await db().from('request_attachments').insert({ request_id: id, uploaded_by: by.id, file_name: 'pms-report.png', file_size: 70, mime_type: 'image/png', storage_path: `${id}/pms-${Date.now()}.png` }).select('id').single()).data.id as string

const setAside: { categories: string[]; source: Record<string, unknown> | null } = { categories: [], source: null }

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  // isolation: other AC PMS categories / an existing PMS sheet source of the same organisation (for example the QA seed company) are set aside while this file runs and put back afterwards
  const keepPms = ((await a.from('service_categories').select('id').eq('is_pms', true)).data ?? []).map((c: { id: string }) => c.id)
  if (keepPms.length) await a.from('service_categories').update({ is_pms: false }).in('id', keepPms)
  setAside.categories = keepPms
  setAside.source = (await a.from('master_sources').select('*').eq('org_id', fx.orgId).eq('kind', 'pms').maybeSingle()).data ?? null
  const mkStore = async (c: string, name: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name, address: 'x' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A, `${tag} Jaipur`); ids.storeB = await mkStore(B, `${tag} Nolgin`)
  await a.from('profiles').update({ store_id: ids.storeA }).eq('id', fx.requesterA.id)   // store A has a login; store B has none; store C does not exist
  const mkCat = async (name: string, pms: boolean) => (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ${name}`, slug: `${tag}-${name}`, is_pms: pms }).select('id').single()).data.id as string
  ids.catPms = await mkCat('ac-pms', true); ids.catNormal = await mkCat('ac-normal', false)
  const mkSub = async (cat: string, name: string) => {
    const s = (await a.from('service_sub_categories').insert({ category_id: cat, name: `${tag} ${name}`, slug: `${tag}-${name}` }).select('id').single()).data.id as string
    await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: s })
    return s
  }
  ids.subPms = await mkSub(ids.catPms, 'pms'); ids.subNormal = await mkSub(ids.catNormal, 'normal')
  await a.from('services').update({ form_fields: [
    { id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 },
    { id: 'desc', type: 'textarea', label: 'Description', required: false, order: 2 },
  ] }).eq('id', fx.teamA.serviceId)
  await a.from('master_sources').upsert({ org_id: fx.orgId, kind: 'pms', spreadsheet_id: SHEET }, { onConflict: 'org_id,kind' })
  sheets[SHEET] = [HEAD, [A, '26/10/2026'], [A, '25/10/2026'], [A, '23/10/2026'], [A, 'soon'], [B, '26/10/2026'], [C, '26/10/2026'], [D, '']]
  ids.co = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Voltas` }).select('id').single()).data.id
  v1 = await createTestUser(`${tag}-v1`, 'Vendor PMS')
  await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: ids.co, vendor_role: 'technician' }).eq('id', v1.id)
}, 300_000)

afterAll(async () => {
  const a = db()
  const all = [...made, ...(await pmsTickets()).map((t) => t.id)]
  if (rules.length) await a.from('business_rules').delete().in('id', rules)
  await a.from('master_ac_units').delete().eq('org_id', fx.orgId).eq('store_code', A)
  await a.from('pms_ticket_log').delete().eq('org_id', fx.orgId).like('store_code', `${tag.toUpperCase()}%`)
  await a.from('master_pms_dates').delete().eq('org_id', fx.orgId).like('store_code', `${tag.toUpperCase()}%`)
  await a.from('master_issues').delete().eq('org_id', fx.orgId).eq('kind', 'pms')
  await a.from('master_sources').delete().eq('org_id', fx.orgId).eq('kind', 'pms')
  if (all.length) {
    await a.from('request_master_snapshots').delete().in('request_id', all)
    await a.from('request_attachments').delete().in('request_id', all)
    await a.from('request_activity').delete().in('request_id', all); await a.from('request_comments').delete().in('request_id', all); await a.from('requests').delete().in('id', all)
  }
  await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null }).eq('id', v1.id)
  await a.from('vendor_companies').delete().eq('id', ids.co)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  const subs = [ids.subPms, ids.subNormal].filter(Boolean)
  await a.from('service_sub_category_tags').delete().in('sub_category_id', subs)
  await a.from('service_sub_categories').delete().in('id', subs)
  await a.from('service_categories').delete().in('id', [ids.catPms, ids.catNormal].filter(Boolean))
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB].filter(Boolean))
  if (setAside.categories.length) await a.from('service_categories').update({ is_pms: true }).in('id', setAside.categories)
  if (setAside.source) await a.from('master_sources').upsert(setAside.source, { onConflict: 'org_id,kind' })
  await fx?.cleanup()
}, 180_000)

describe('the AC PMS sheet is copied into the database', () => {
  it('keeps store + date, skips a blank date, and reports a bad date and an unknown store', async () => {
    const report = await sync()
    expect(report.pms.status).toBe('ok')
    const rows = ((await db().from('master_pms_dates').select('store_code, pms_date').eq('org_id', fx.orgId)).data ?? []) as { store_code: string; pms_date: string }[]
    const mine = rows.filter((r) => r.store_code.startsWith(tag.toUpperCase())).map((r) => `${r.store_code.slice(-1)} ${r.pms_date}`).sort()
    expect(mine).toEqual(['A 2026-10-23', 'A 2026-10-25', 'A 2026-10-26', 'B 2026-10-26', 'C 2026-10-26'])
    const issues = await pmsIssues()
    expect(issues.some((i) => i.code === 'bad_date' && i.store_code === A && /soon/.test(i.message))).toBe(true)
    expect(issues.some((i) => i.code === 'unknown_store' && i.store_code === C)).toBe(true)
    expect(issues.some((i) => i.store_code === D)).toBe(false)   // a store without a date is simply not due
  })
})

describe('the tickets are made from 09:00 on the PMS date', () => {
  it('before 09:00 nothing is made: not today (not open yet) and not the day before (a passed date is never made)', async () => {
    const r = await createDuePmsTickets(db(), fx.orgId, T0830)
    expect(r.created).toBe(0)
    expect(await pmsTickets()).toEqual([])
    expect((await logOf(A, '2026-10-26'))).toBeNull()
    expect((await logOf(A, '2026-10-25'))).toBeNull()
  })

  it('at 09:00 one ticket per store and date, even when two runs overlap; a passed date is never made', async () => {
    const [r1, r2] = await Promise.all([createDuePmsTickets(db(), fx.orgId, T0900), createDuePmsTickets(db(), fx.orgId, T0900)])
    expect(r1.created + r2.created).toBe(1)   // A 26 Oct only (A 25 Oct and 23 Oct have passed)
    const t = await pmsTickets()
    expect(t.map((x) => x.source_metadata.pms_date).sort()).toEqual(['2026-10-26'])
    expect(t.every((x) => x.category_id === ids.catPms && x.sub_category_id === ids.subPms && x.service_id === fx.teamA.serviceId && x.requester_id === fx.requesterA.id && x.source_metadata.pms_source === 'ac_pms_sheet')).toBe(true)
    expect(t.find((x) => x.source_metadata.pms_date === '2026-10-26')!.title).toBe(`AC PMS - ${tag} Jaipur - 26 Oct 2026`)
    expect(await logOf(A, '2026-10-25')).toBeNull()   // yesterday: never made
    expect(await logOf(A, '2026-10-23')).toBeNull()   // older: never made
  })

  it('a second run the same morning makes nothing new', async () => {
    const r = await createDuePmsTickets(db(), fx.orgId, T0900)
    expect(r.created).toBe(0)
    expect((await pmsTickets()).length).toBe(1)
  })

  it('a store with no login and a store that does not exist are reported, with the reason', async () => {
    const b = await logOf(B, '2026-10-26')
    expect(b?.status).toBe('skipped')
    expect(b?.note).toMatch(/no active login/)
    const c = await logOf(C, '2026-10-26')
    expect(c?.status).toBe('skipped')
    expect(c?.note).toMatch(/not in the CK Desk store master/)
    const issues = await pmsIssues()
    expect(issues.some((i) => i.code === 'pms_no_ticket' && i.store_code === B)).toBe(true)
    expect(issues.some((i) => i.code === 'pms_no_ticket' && i.store_code === C)).toBe(true)
  })

  it('once the store has a login the date is tried again and its ticket is made', async () => {
    await db().from('profiles').update({ store_id: ids.storeB }).eq('id', fx.requesterB.id)
    const r = await createDuePmsTickets(db(), fx.orgId, T0900)
    await db().from('profiles').update({ store_id: null }).eq('id', fx.requesterB.id)
    expect(r.created).toBe(1)
    expect((await logOf(B, '2026-10-26'))?.status).toBe('created')
  })

  it('says what is wrong when no category is marked as the AC PMS category', async () => {
    await db().from('service_categories').update({ is_pms: false }).eq('id', ids.catPms)
    const r = await createDuePmsTickets(db(), fx.orgId, T0900)
    await db().from('service_categories').update({ is_pms: true }).eq('id', ids.catPms)
    expect(r.setupProblem).toMatch(/No category is marked/)
    expect((await pmsIssues()).some((i) => i.code === 'pms_no_ticket' && /No category is marked/.test(i.message))).toBe(true)
  })

  it('a date removed from the sheet leaves the tickets already made alone', async () => {
    sheets[SHEET] = [HEAD, [A, '25/10/2026']]
    await sync()
    const rows = ((await db().from('master_pms_dates').select('store_code, pms_date').eq('org_id', fx.orgId).eq('store_code', A)).data ?? []) as { pms_date: string }[]
    expect(rows.map((r) => r.pms_date)).toEqual(['2026-10-25'])
    expect((await pmsTickets()).length).toBe(2)
  })

  it('nothing is made when the PMS sheet is not set up', async () => {
    await db().from('master_sources').delete().eq('org_id', fx.orgId).eq('kind', 'pms')
    sheets[SHEET] = [HEAD, [A, '26/10/2026']]
    const r = await createDuePmsTickets(db(), fx.orgId, T0900)
    expect(r).toEqual({ created: 0, alreadyDone: 0, skipped: 0, failed: 0 })
    await db().from('master_sources').upsert({ org_id: fx.orgId, kind: 'pms', spreadsheet_id: SHEET }, { onConflict: 'org_id,kind' })
  })
})

describe('an AC PMS ticket is routed to the vendor like an AC complaint (QA-D004)', () => {
  it('the active ACs of the store go with the ticket, so a rule that routes by the AC vendor gives it to that vendor technician, who sees it in the AC PMS tab', async () => {
    const a = db()
    await a.from('master_ac_units').insert({ org_id: fx.orgId, store_code: A, ckdesk_no: '1', serial: `${tag}-1`, brand: 'VOLTAS', amc_vendor: 'VOLTAS', region: 'R1', state: 'RJ', cluster: 'C1', is_active: true, emails: ['oem@oem.test'], po_emails: [], approver_emails: [] })
    const rule = (await a.from('business_rules').insert({ org_id: fx.orgId, name: `${tag} pms voltas`, is_active: true, trigger: ['created'], execution_order: -20, conditions_logic: 'AND',
      conditions: [{ field: 'category_id', operator: 'equals', value: ids.catPms }, { field: 'ac_amc_vendor', logic: 'AND', operator: 'contains', value: 'voltas' }],
      actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [v1.id] } }] }).select('id').single()).data.id
    rules.push(rule)
    await a.from('master_pms_dates').insert({ org_id: fx.orgId, store_code: A, pms_date: '2026-10-27', sheet_row: 99 })
    const r = await createDuePmsTickets(a, fx.orgId, T0900_27)   // the next day, 09:30 India time
    expect(r.created).toBe(1)
    const t = (await a.from('requests').select('id, assigned_to, status').eq('category_id', ids.catPms).like('title', '%27 Oct 2026').single()).data
    expect(t.assigned_to).toBe(v1.id)
    expect(t.status).toBe('open')
    const snap = (await a.from('request_master_snapshots').select('snapshot').eq('request_id', t.id).eq('kind', 'ac').single()).data.snapshot as { amc_vendor: string }[]
    expect(snap.length).toBe(1)
    actAs(v1)
    const mine = (await getVendorTickets()).filter((x) => x.id === t.id)
    expect(mine.length).toBe(1)
    expect(mine[0].is_pms).toBe(true)
  })

  it('a store with no active AC in the sheet still gets its PMS ticket, with a note that no vendor could be chosen', async () => {
    const a = db()
    const code = `${tag}N`.toUpperCase()
    const st = (await a.from('stores').insert({ org_id: fx.orgId, code, name: `${tag} No AC store`, address: 'x' }).select('id').single()).data.id
    await a.from('profiles').update({ store_id: st }).eq('id', fx.requesterB.id)
    await a.from('master_pms_dates').insert({ org_id: fx.orgId, store_code: code, pms_date: '2026-10-26', sheet_row: 97 })
    try {
      const r = await createDuePmsTickets(a, fx.orgId, T0900)
      expect(r.created).toBe(1)
      const t = (await a.from('requests').select('id, assigned_to').eq('category_id', ids.catPms).like('title', `%No AC store%`).single()).data
      expect(t.assigned_to).toBeNull()
      const notes = ((await a.from('request_comments').select('body').eq('request_id', t.id).eq('is_internal', true)).data ?? []) as { body: string }[]
      expect(notes.some((n) => /lists no active AC/.test(n.body))).toBe(true)
    } finally {
      await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterB.id)
      const rq = ((await a.from('requests').select('id').like('title', '%No AC store%')).data ?? []).map((x: { id: string }) => x.id)
      if (rq.length) { await a.from('request_comments').delete().in('request_id', rq); await a.from('request_activity').delete().in('request_id', rq); await a.from('requests').delete().in('id', rq) }
      await a.from('pms_ticket_log').delete().eq('store_code', code); await a.from('master_pms_dates').delete().eq('store_code', code); await a.from('stores').delete().eq('id', st)
    }
  })
})

describe('the vendor works an AC PMS ticket', () => {
  it('starts without an OEM ticket number and resolves with the PMS report; a normal ticket still needs the OEM number', async () => {
    const pms = await vendorTicket(ids.catPms, 'pms visit')
    const normal = await vendorTicket(ids.catNormal, 'normal ac issue')

    actAs(v1)
    const refused = await vendorStartWorking(normal, '')
    expect(refused.error).toMatch(/OEM ticket number/)

    expect((await vendorStartWorking(pms, '')).error).toBeUndefined()
    expect((await db().from('requests').select('status').eq('id', pms).single()).data.status).toBe('in_progress')
    const said = ((await db().from('request_comments').select('body').eq('request_id', pms)).data ?? []).map((c: { body: string }) => c.body)
    expect(said.some((b: string) => /started the AC PMS visit/.test(b))).toBe(true)

    const noReport = await vendorResolve({ requestId: pms, choice: '', remarks: 'all ACs serviced', attachmentIds: [] })
    expect(noReport.error).toMatch(/PMS report/)
    const file = await fsr(pms, v1)
    const done = await vendorResolve({ requestId: pms, choice: '', remarks: 'all ACs serviced', attachmentIds: [file] })
    expect(done.error).toBeUndefined()
    expect((await db().from('requests').select('status').eq('id', pms).single()).data.status).toBe('resolved')
    const after = ((await db().from('request_comments').select('body').eq('request_id', pms)).data ?? []).map((c: { body: string }) => c.body)
    expect(after.some((b: string) => /AC PMS done\. all ACs serviced/.test(b))).toBe(true)
  })

  it('the two tabs never share a ticket', async () => {
    actAs(v1)
    const rows = (await getVendorTickets()).filter((r) => r.title.includes(tag))
    const pmsTab = ticketsOfTab(rows, 'pms'), mainTab = ticketsOfTab(rows, 'tickets')
    expect(pmsTab.length).toBeGreaterThan(0)
    expect(mainTab.length).toBeGreaterThan(0)
    expect(pmsTab.every((r) => r.is_pms)).toBe(true)
    expect(mainTab.every((r) => !r.is_pms)).toBe(true)
    const inBoth = pmsTab.filter((r) => mainTab.some((m) => m.id === r.id))
    expect(inBoth).toEqual([])
    expect(pmsTab.length + mainTab.length).toBe(rows.length)
  })
})
