// Vendor Programs at the "vendor works the ticket in the vendor portal" level, on the isolated audit stack (mail goes nowhere):
//  - a ticket goes to a vendor technician ONLY through Business Rules set up in CK Desk (nothing in the sheet routes it, not even the Vendor column); it stays Open until he starts;
//  - no rule = the ticket stays with Citykart staff with an internal note;
//  - start: the OEM ticket number is optional unless the program says compulsory (any reference will do); kept in the form's OEM box or in the background; resolve only from the program's own fixed list (Other needs remarks, the FSR is compulsory);
//  - Business Rules have conditions for the program, the vendor company, the store and "with a vendor", and an action that gives the ticket to ALL the technicians of a vendor company;
//  - quote / PO: the approvers are the sheet's "Quote Approval Mail To", else the PROGRAM's own default approvers (never the one global default of AC), the OEM is told at "PO Mail To", the mails name the program instead of "AC";
//  - the program vendor's addresses are known vendor contacts, so their e-mail replies are recognised; a reply's files are kept under it (checked like any upload).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, createTestUser, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string; attachments?: { filename: string }[] }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { createRequest } from '@/lib/actions/requests'
import { vendorResolve, vendorStartWorking } from '@/lib/actions/vendor'
import { vendorRequestPo } from '@/lib/actions/vendor-requests'
import { approveVendorPo } from '@/lib/actions/vendor-po'
import { syncPrograms } from '@/lib/programs/sync'
import { loadSheetOemContacts } from '@/lib/masters/contacts'
import { senderMayReply } from '@/lib/email/inbound-participant'
import { addReplyFiles, pickReplyAttachments } from '@/lib/email/inbound-files'
import { PO_APPROVER_SETTING } from '@/lib/vendor/po'
import type { SheetsSource } from '@/lib/masters/google'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t43${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string | string[]; cc?: string | string[]; subject: string; html: string; attachments?: { filename: string }[] }[]
const code = (s: string) => `${tag}${s}`.toUpperCase()
const A = code('a'), B = code('b')
const NAME = `${tag} RO Purifier`
const ids = { storeA: '', storeB: '', program: '', cat: '', sub: '', coAqua: '' }
const ruleIds: string[] = []
// a Business Rule of the program's category that assigns tickets to vendor technicians, as an administrator sets it up in CK Desk
async function mkRule(strategy: 'direct' | 'round_robin', assignees: string[], order: number): Promise<string> {
  const id = (await db().from('business_rules').insert({ org_id: fx.orgId, name: `${tag} ${strategy} ${order}`, trigger: ['created'], is_active: true, conditions: [{ field: 'category_id', operator: 'equals', value: ids.cat }], actions: [{ type: 'assign', params: { strategy, assigneeIds: assignees } }], execution_order: order }).select('id').single()).data.id as string
  ruleIds.push(id)
  return id
}
let t1: TestUser, t2: TestUser
const made: string[] = []
const vendorUsers: TestUser[] = []
const SHEET = `${tag}-sheet-portal-00000`
const sheets: Record<string, unknown[][]> = {}
const source: SheetsSource = { fetchValues: async (id) => { if (!sheets[id]) throw new Error('no such sheet'); return sheets[id] } }
const HEAD = ['Store Code', 'Ticket Mail To', 'Vendor', 'PO Mail To', 'Quote Approval Mail To']
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const png = (name: string) => new File([PNG], name, { type: 'image/png' })
const setStore = (storeId: string | null) => db().from('profiles').update({ store_id: storeId }).eq('id', fx.requesterA.id)

async function vendorUser(label: string): Promise<TestUser> {
  const u = await createTestUser(`${tag}-${label}`, `Vendor ${label}`)
  await db().from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: ids.coAqua, vendor_role: 'technician' }).eq('id', u.id)
  vendorUsers.push(u)
  return u
}
async function raise(title: string) {
  actAs(fx.requesterA)
  const f = new FormData()
  f.set('service_id', fx.teamA.serviceId); f.set('sub_category_id', ids.sub)
  f.set('form_data', JSON.stringify({ subject: `${tag} ${title}` }))
  const r = await createRequest(f)
  if (r.requestId) made.push(r.requestId)
  return r
}
const row = async (id: string) => (await db().from('requests').select('id, org_id, requester_id, assigned_to, team_id, status').eq('id', id).single()).data as { id: string; org_id: string; requester_id: string; assigned_to: string | null; team_id: string; status: string }
const comments = async (id: string) => ((await db().from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean }[]
const fsr = async (id: string, by: TestUser) => (await db().from('request_attachments').insert({ request_id: id, uploaded_by: by.id, file_name: 'fsr.png', file_size: 70, mime_type: 'image/png', storage_path: `${id}/fsr-${Date.now()}.png` }).select('id').single()).data.id as string

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const mkStore = async (c: string) => (await a.from('stores').insert({ org_id: fx.orgId, code: c, name: `${tag} ${c}`, address: 'Old Bus Stand Road' }).select('id').single()).data.id as string
  ids.storeA = await mkStore(A); ids.storeB = await mkStore(B)
  ids.coAqua = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Aqua Care` }).select('id').single()).data.id
  t1 = await vendorUser('t1'); t2 = await vendorUser('t2')
  ids.program = (await a.from('vendor_programs').insert({
    org_id: fx.orgId, name: NAME, slug: `${tag}-ro`, is_active: true, level: 'portal', row_type: 'store', spreadsheet_id: SHEET,
    resolution_options: ['Cartridge replaced', 'Pump replaced'], default_approver_ids: [fx.manager.id],
    mail_subject: 'RO ticket {{ticket_no}} - {{store_code}}', mail_body_html: '<p>Dear vendor</p><table><tbody><tr><th>Ticket No</th><td>{{ticket_no}}</td></tr><tr><th>Issue</th><td>{{subject}}</td></tr></tbody></table>',
  }).select('id').single()).data.id
  ids.cat = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ro`, slug: `${tag}-ro-cat`, program_id: ids.program }).select('id').single()).data.id
  ids.sub = (await a.from('service_sub_categories').insert({ category_id: ids.cat, name: `${tag} ro-sub`, slug: `${tag}-ro-sub` }).select('id').single()).data.id
  await a.from('service_sub_category_tags').insert({ service_id: fx.teamA.serviceId, sub_category_id: ids.sub })
  await a.from('services').update({ form_fields: [{ id: 'subject', type: 'text', label: 'Subject', required: false, order: 1 }] }).eq('id', fx.teamA.serviceId)
  // the one global default (AC's) is somebody else: a program must never use it; the sheet names the agent, the program's own default approver is the manager
  await a.from('app_settings').upsert({ key: PO_APPROVER_SETTING, value: fx.agentB.id }, { onConflict: 'key' })
  sheets[SHEET] = [HEAD, [A, 'svc@aqua.test, desk.lead@citykartstores.com', 'Whatever Name The Sheet Has', 'po@aqua.test', fx.agentA.email], [B, 'x@unknown.test', 'Unknown Co', '', '']]
  await mkRule('round_robin', [t1.id, t2.id], 9100)
  await syncPrograms({ db: a, orgId: fx.orgId, source, force: true })
}, 300_000)

afterAll(async () => {
  const a = db()
  await setStore(null)
  await a.from('app_settings').delete().eq('key', PO_APPROVER_SETTING)
  if (ruleIds.length) await a.from('business_rules').delete().in('id', ruleIds)
  if (made.length) {
    await a.from('vendor_requests').delete().in('request_id', made)
    await a.from('request_program_snapshots').delete().in('request_id', made)
    await a.from('request_attachments').delete().in('request_id', made)
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('service_sub_category_tags').delete().eq('sub_category_id', ids.sub)
  await a.from('service_sub_categories').delete().eq('id', ids.sub)
  await a.from('service_categories').delete().eq('id', ids.cat)
  await a.from('vendor_programs').delete().eq('id', ids.program)
  await a.from('services').update({ form_fields: [] }).eq('id', fx.teamA.serviceId)
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null }).in('id', vendorUsers.map((u) => u.id))
  await a.from('vendor_companies').delete().eq('id', ids.coAqua)
  await a.from('stores').delete().in('id', [ids.storeA, ids.storeB].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('a ticket reaches a vendor technician only through Business Rules set up in CK Desk', () => {
  it('a round-robin rule gives the tickets to the technicians in turn; the ticket stays Open and the vendor is mailed', async () => {
    await setStore(ids.storeA)
    const before = mails().length
    const r1 = await raise('first'), r2 = await raise('second'), r3 = await raise('third')
    const rows = await Promise.all([r1, r2, r3].map((r) => row(r.requestId!)))
    expect(rows.every((x) => x.status === 'open')).toBe(true)
    const who = rows.map((x) => x.assigned_to)
    expect(who.every((w) => w === t1.id || w === t2.id)).toBe(true)
    expect(new Set(who.slice(0, 2)).size).toBe(2)          // two tickets in a row go to two different technicians
    expect(who[2]).toBe(who[0])                             // and the third starts the round again
    const sent = mails().slice(before).filter((m) => /RO ticket/.test(m.subject))
    expect(sent).toHaveLength(3)
    expect(String(sent[0].to)).toContain('svc@aqua.test')
    expect((await db().from('request_program_snapshots').select('program_id').eq('request_id', r1.requestId!).single()).data.program_id).toBe(ids.program)
  })

  it('a direct rule that runs first sends the tickets to the technician it names; the vendor named in the sheet changes nothing, and a store that is not matched by the sheet\'s vendor is routed the same way', async () => {
    const direct = await mkRule('direct', [t2.id], 9000)     // runs before the round-robin rule
    try {
      for (const store of [ids.storeA, ids.storeB]) {
        await setStore(store)
        const r = await raise(`direct ${store === ids.storeA ? 'A' : 'B'}`)
        expect((await row(r.requestId!)).assigned_to).toBe(t2.id)   // store B's row names "Unknown Co": it makes no difference
      }
    } finally {
      await db().from('business_rules').delete().eq('id', direct)
    }
  })

  it('with no rule the ticket stays with Citykart staff and says so; the sheet routes nothing', async () => {
    await db().from('business_rules').update({ is_active: false }).in('id', ruleIds)
    try {
      await setStore(ids.storeA)
      const r = await raise('no rule')
      expect((await row(r.requestId!)).assigned_to).toBeNull()
      expect((await comments(r.requestId!)).some((c) => c.is_internal && /no vendor technician has it yet/.test(c.body))).toBe(true)
      expect(mails().some((m) => String(m.to).includes('svc@aqua.test'))).toBe(true)   // the vendor is still mailed
    } finally {
      await db().from('business_rules').update({ is_active: true }).in('id', ruleIds)
    }
  })
})

describe('Business Rule conditions and actions for vendor programs and vendor technicians', () => {
  it('conditions on the program, the store and the vendor company; the action gives the ticket to ALL the technicians of a vendor company, including one added later', async () => {
    const a = db()
    await a.from('business_rules').update({ is_active: false }).in('id', ruleIds)      // only the rule below may act
    const mine: string[] = []
    let t3: TestUser | null = null
    try {
      const id = (await a.from('business_rules').insert({
        org_id: fx.orgId, name: `${tag} company rule`, trigger: ['created'], is_active: true, execution_order: 9200,
        conditions: [{ field: 'vendor_line', operator: 'equals', value: ids.program }, { field: 'requester_store_id', operator: 'equals', value: ids.storeA, logic: 'AND' }],
        actions: [{ type: 'assign', params: { strategy: 'round_robin', assigneeIds: [], vendorCompanyId: ids.coAqua } }],
      }).select('id').single()).data.id as string
      mine.push(id)
      await setStore(ids.storeA)
      const first = await Promise.all([raise('co one'), raise('co two')])
      const got = await Promise.all(first.map((r) => row(r.requestId!)))
      expect(got.map((x) => x.assigned_to).sort()).toEqual([t1.id, t2.id].sort())       // both technicians of the company, in turn
      // a store the rule does not name is not routed by it
      await setStore(ids.storeB)
      expect((await row((await raise('co other store')).requestId!)).assigned_to).toBeNull()
      // a technician added to the company later takes part without editing the rule
      t3 = await vendorUser('t3')
      await setStore(ids.storeA)
      const more = await Promise.all([raise('co three'), raise('co four'), raise('co five')])
      const who = (await Promise.all(more.map((r) => row(r.requestId!)))).map((x) => x.assigned_to)
      expect(new Set(who)).toEqual(new Set([t1.id, t2.id, t3.id]))
    } finally {
      if (mine.length) await a.from('business_rules').delete().in('id', mine)
      await a.from('business_rules').update({ is_active: true }).in('id', ruleIds)
    }
  })
})

describe('the vendor works the ticket in the portal', () => {
  let t = ''
  it('starts with or without an OEM ticket number (the program\'s choice); a given number is kept in the background when the form has no OEM box; the technician of another ticket cannot start', async () => {
    await setStore(ids.storeA)
    const r = await raise('portal work')
    t = r.requestId!
    const assignee = (await row(t)).assigned_to
    const other = assignee === t1.id ? t2 : t1
    actAs(other)
    expect((await vendorStartWorking(t, '')).error).toMatch(/not assigned/i)
    actAs(assignee === t1.id ? t1 : t2)
    await db().from('vendor_programs').update({ oem_number_required: true }).eq('id', ids.program)
    expect((await vendorStartWorking(t, '')).error).toMatch(/OEM ticket number/i)       // compulsory when the program says so
    expect((await row(t)).status).toBe('open')
    expect((await vendorStartWorking(t, 'NA')).error).toBeUndefined()                      // a vendor with no number writes any reference
    expect((await row(t)).status).toBe('in_progress')
    await db().from('vendor_programs').update({ oem_number_required: false }).eq('id', ids.program)
    const fd = (await db().from('requests').select('form_data').eq('id', t).single()).data.form_data as Record<string, string>
    expect(fd._oem_ticket_no).toBe('NA')                                                    // no OEM box in this form: kept in the background
    expect(fd._oem_ticket_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await comments(t)).some((c) => /OEM ticket number: NA/.test(c.body))).toBe(true)
  })

  it('goes into the form\'s own OEM box when the form has one', async () => {
    const sections = [{ id: 's1', title: 'Vendor', order: 1, fields: [{ id: 'oemno', type: 'text', label: 'RO OEM Ticket Number', required: false, order: 1 }, { id: 'oemdt', type: 'date', label: 'RO OEM Ticket Creation Date', required: false, order: 2 }] }]
    await setStore(ids.storeA)
    const r = await raise('form box')
    const id = r.requestId!
    await db().from('requests').update({ form_sections_snapshot: sections }).eq('id', id)
    const tech = (await row(id)).assigned_to === t1.id ? t1 : t2
    actAs(tech)
    expect((await vendorStartWorking(id, 'RV-100')).error).toBeUndefined()
    const fd = (await db().from('requests').select('form_data').eq('id', id).single()).data.form_data as Record<string, string>
    expect(fd.oemno).toBe('RV-100')
    expect(fd.oemdt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(fd._oem_ticket_no).toBe('RV-100')
  })

  it('resolves only from the program\'s own list; Other needs remarks; the FSR is compulsory', async () => {
    const tech = (await row(t)).assigned_to === t1.id ? t1 : t2
    actAs(tech)
    const f = await fsr(t, tech)
    expect((await vendorResolve({ requestId: t, choice: 'COMPRESSOR CHANGED', remarks: '', attachmentIds: [f] })).error).toMatch(/list/i)   // an AC resolution is not in this list
    expect((await vendorResolve({ requestId: t, choice: 'Cartridge replaced', remarks: '', attachmentIds: [] })).error).toMatch(/FSR/i)
    expect((await vendorResolve({ requestId: t, choice: 'Other', remarks: 'short', attachmentIds: [f] })).error).toMatch(/Other/)
    expect((await vendorResolve({ requestId: t, choice: 'Cartridge replaced', remarks: '', attachmentIds: [f] })).error).toBeUndefined()
    expect((await row(t)).status).toBe('resolved')
    expect((await comments(t)).some((c) => /Resolution: Cartridge replaced/.test(c.body))).toBe(true)
  })
})

describe('quote and PO approval for a program ticket', () => {
  it('goes to the sheet\'s approver (not the fallback), says the program name, and the approved PO mails the "PO Mail To" address with the document', async () => {
    await setStore(ids.storeA)
    const r = await raise('needs a part')
    const t = r.requestId!
    const tech = (await row(t)).assigned_to === t1.id ? t1 : t2
    actAs(tech)
    expect((await vendorStartWorking(t, 'VT-9')).error).toBeUndefined()
    const before = mails().length
    const lines = [{ item_name: 'Membrane', qty: 1, price_excl_gst: 2500 }]
    expect((await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, tech)] })).error).toBeUndefined()
    expect((await row(t)).status).toBe('hold_purchase_ho')
    const vr = (await db().from('vendor_requests').select('id, approver_ids').eq('request_id', t).single()).data
    expect(vr.approver_ids).toEqual([fx.agentA.id])
    const ask = mails().slice(before).find((m) => /PO approval needed/.test(m.subject))
    expect(ask, 'the approval mail').toBeTruthy()
    expect(ask!.html).toContain(`repair the ${NAME} on the ticket`)

    const form = new FormData(); form.set('vendor_request_id', vr.id); form.set('po_number', 'PO-77'); form.set('po_date', '2026-10-01'); form.set('po_document', png('PO-77.png'))
    actAs(fx.agentA)
    const mid = mails().length
    expect((await approveVendorPo(form)).error).toBeUndefined()
    expect((await row(t)).status).toBe('in_progress')
    const oem = mails().slice(mid).find((m) => /PO PO-77 approved/.test(m.subject))
    expect(oem, 'the mail to the vendor').toBeTruthy()
    expect(String(oem!.to)).toContain('po@aqua.test')
    expect(oem!.html).toContain(NAME)
    expect(oem!.attachments?.map((x) => x.filename)).toEqual(['PO-77.png'])
  })
})

describe('the default PO approvers belong to the program', () => {
  it('a store whose row names no approver uses the PROGRAM\'s default approvers (not the global default of AC); with none set the vendor cannot ask for a PO', async () => {
    await setStore(ids.storeB)                                   // store B's row has no Quote Approval Mail To
    const r = await raise('default approver')
    const t = r.requestId!
    const tech = (await row(t)).assigned_to === t1.id ? t1 : (await row(t)).assigned_to === t2.id ? t2 : null
    expect(tech, 'the base rule gives the ticket to a vendor technician').toBeTruthy()
    actAs(tech!)
    expect((await vendorStartWorking(t, '')).error).toBeUndefined()
    const lines = [{ item_name: 'Pump', qty: 1, price_excl_gst: 900 }]
    expect((await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, tech!)] })).error).toBeUndefined()
    const vr = (await db().from('vendor_requests').select('approver_ids').eq('request_id', t).single()).data
    expect(vr.approver_ids).toEqual([fx.manager.id])             // the program's own approver; the global default (agent B) is not used
    // no default approver on the program and none in the sheet = nobody can decide, and the vendor is told
    await db().from('vendor_programs').update({ default_approver_ids: [] }).eq('id', ids.program)
    try {
      const r2 = await raise('no approver at all')
      const t2id = r2.requestId!
      const tech2 = (await row(t2id)).assigned_to === t1.id ? t1 : t2
      actAs(tech2)
      await vendorStartWorking(t2id, '')
      expect((await vendorRequestPo({ requestId: t2id, lines, quoteAttachmentIds: [await fsr(t2id, tech2)] })).error).toMatch(/No PO approver/i)
    } finally {
      await db().from('vendor_programs').update({ default_approver_ids: [fx.manager.id] }).eq('id', ids.program)
    }
  })
})

describe('what the vendor answers by e-mail', () => {
  it('the program vendor\'s addresses are known vendor contacts, and only a person of the mail may write on the ticket', async () => {
    const contacts = await loadSheetOemContacts(db(), fx.orgId)
    expect(contacts.some((c) => c.emails.includes('svc@aqua.test') && c.name.includes(NAME))).toBe(true)
    await setStore(ids.storeA)
    const r = await raise('reply check')
    const req = await row(r.requestId!)
    expect(await senderMayReply(db(), req, { kind: 'oem', name: 'RO vendor', email: 'svc@aqua.test' })).toBe(true)
    expect(await senderMayReply(db(), req, { kind: 'oem', name: 'Stranger', email: 'stranger@elsewhere.test' })).toBe(false)
  })

  it('the files of a reply are kept under it (checked like any upload); a logo of the signature is skipped and a file that is not allowed is refused with a note', async () => {
    await setStore(ids.storeA)
    const r = await raise('reply files')
    const t = r.requestId!
    const req = await row(t)
    const { data: c } = await db().from('request_comments').insert({ request_id: t, author_id: null, body: 'Please find the report attached.', is_internal: false, source: 'email', external_name: 'RO vendor', external_email: 'svc@aqua.test' }).select('id').single()
    const picked = pickReplyAttachments([
      { filename: 'report.png', contentType: 'image/png', content: Buffer.from(PNG) },
      { filename: 'logo.png', contentType: 'image/png', content: Buffer.from(PNG), related: true, contentDisposition: 'inline' },
      { filename: 'run.exe', contentType: 'application/x-msdownload', content: Buffer.from('MZ-not-a-real-program') },
    ])
    expect(picked.keep.map((f) => f.name)).toEqual(['report.png', 'run.exe'])
    const done = await addReplyFiles({ admin: db(), requestId: t, commentId: c.id, uploadedBy: req.assigned_to ?? req.requester_id, fromAddress: 'svc@aqua.test', files: picked.keep, dropped: picked.dropped })
    expect(done.added).toBe(1)
    const files = ((await db().from('request_attachments').select('file_name, comment_id').eq('request_id', t)).data ?? []) as { file_name: string; comment_id: string | null }[]
    expect(files).toEqual([{ file_name: 'report.png', comment_id: c.id }])
    expect((await comments(t)).some((x) => x.is_internal && /run\.exe/.test(x.body))).toBe(true)
  })
})
