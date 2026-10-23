// OEM engineers who log in (vendor technicians) and their managers, on the isolated audit stack:
//  - a vendor reads only his own tickets (a vendor manager: his company's), never an internal comment, never anybody else's ticket; nobody can make himself a vendor;
//  - the ticket stays Open until the vendor starts it with the OEM ticket number; resolving needs a choice from the AC RESOLUTION list (Other needs remarks) and the FSR;
//  - "Part required" puts the ticket on hold and only "Parts received" brings it back; a hold cannot be resolved;
//  - a PO request goes to ONE approver: approve (number, date, document) returns the ticket to In Progress and mails the OEM; reject cancels it (48 h to reopen) and mails the OEM;
//  - a Business Rule can route a ticket by the AC's vendor and never takes a ticket away from a vendor;
//  - a reopened ticket goes back to the same vendor technician with the OEM boxes emptied.
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
import { createRequest, updateRequestStatus } from '@/lib/actions/requests'
import { vendorAddComment, vendorResolve, vendorStartWorking } from '@/lib/actions/vendor'
import { vendorPartsReceived, vendorRequestParts, vendorRequestPo, vendorRevisePo, vendorUpdateParts, vendorWithdrawRequest } from '@/lib/actions/vendor-requests'
import { approveVendorPo, rejectVendorPo, requestPoRevision } from '@/lib/actions/vendor-po'
import { holdKindsFor } from '@/lib/vendor/requests'
import { runRulesForTrigger } from '@/lib/rules/run'
import { PO_APPROVER_SETTING } from '@/lib/vendor/po'

vi.setConfig({ testTimeout: 120_000 })
const db = () => getAdmin() as any // eslint-disable-line @typescript-eslint/no-explicit-any
const tag = `t36${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string | string[]; subject: string; attachments?: { filename: string }[] }[]

let co1 = '', co2 = ''
let v1a: TestUser, v1b: TestUser, v1m: TestUser, v2a: TestUser
const made: string[] = []
const vendorUsers: TestUser[] = []
const rules: string[] = []

const SECTIONS = [{
  id: 's1', title: 'AC', order: 1,
  fields: [
    { id: 'oemno', type: 'text', label: 'AC OEM Ticket Number', required: true, order: 1 },
    { id: 'oemdt', type: 'date', label: 'AC OEM Ticket Creation Date', required: true, order: 2 },
    { id: 'acres', type: 'select', label: 'AC resolution', required: true, order: 3, options: [{ value: 'r1', label: 'COMPRESSOR CHANGED' }, { value: 'r2', label: 'GAS FILLED' }] },
  ],
}]
const UNIT = { id: '00000000-0000-0000-0000-0000000000aa', ckdesk_no: '1', brand: 'VOLTAS', tonnage: '1.5', amc_vendor: 'VOLTAS', region: 'R1', state: 'DL', cluster: 'C1', emails: ['oem@oem.test'], po_emails: ['po@oem.test'] }

// a tiny valid PNG (the PO document and the FSR)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const png = (name: string) => new File([PNG], name, { type: 'image/png' })

async function vendorUser(label: string, company: string, kind: 'technician' | 'manager'): Promise<TestUser> {
  const u = await createTestUser(`${tag}-${label}`, `Vendor ${label}`)
  await db().from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: company, vendor_role: kind }).eq('id', u.id)
  vendorUsers.push(u)
  return u
}

async function ticket(assignee: string | null, status = 'open', title = 'vendor test'): Promise<string> {
  const r = (await db().from('requests').insert({
    request_no: '', title: `${tag} ${title}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: assignee, status,
    form_sections_snapshot: SECTIONS, form_data: {},
  }).select('id').single()).data.id as string
  made.push(r)
  await db().from('request_master_snapshots').insert({ request_id: r, kind: 'ac', unit_ids: [UNIT.id], snapshot: [UNIT] })
  return r
}
const row = async (id: string) => (await db().from('requests').select('status, assigned_to, form_data, cancellation_reason, reopen_deadline_at, waiting_since').eq('id', id).single()).data
const comments = async (id: string) => ((await db().from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []) as { body: string; is_internal: boolean }[]
const fsr = async (id: string, by: TestUser) => (await db().from('request_attachments').insert({ request_id: id, uploaded_by: by.id, file_name: 'fsr.png', file_size: 70, mime_type: 'image/png', storage_path: `${id}/fsr-${Date.now()}.png` }).select('id').single()).data.id as string

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  co1 = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Voltas` }).select('id').single()).data.id
  co2 = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Blue Star` }).select('id').single()).data.id
  v1a = await vendorUser('v1a', co1, 'technician'); v1b = await vendorUser('v1b', co1, 'technician'); v1m = await vendorUser('v1m', co1, 'manager'); v2a = await vendorUser('v2a', co2, 'technician')
  await a.from('services').update({ form_sections: SECTIONS }).eq('id', fx.teamA.serviceId)
  await a.from('app_settings').upsert({ key: PO_APPROVER_SETTING, value: fx.agentA.id }, { onConflict: 'key' })
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('app_settings').delete().eq('key', PO_APPROVER_SETTING)
  if (rules.length) await a.from('business_rules').delete().in('id', rules)
  if (made.length) {
    await a.from('vendor_requests').delete().in('request_id', made)
    await a.from('request_master_snapshots').delete().in('request_id', made)
    await a.from('request_attachments').delete().in('request_id', made)
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('services').update({ form_sections: [] }).eq('id', fx.teamA.serviceId)
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null }).in('id', vendorUsers.map((u) => u.id))
  await a.from('vendor_companies').delete().in('id', [co1, co2].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('what a vendor can read', () => {
  it('a technician reads only his own tickets; his manager reads his company\'s; another company reads nothing; nobody reads an internal comment', async () => {
    const t = await ticket(v1a.id)
    const other = await ticket(fx.agentA.id, 'open', 'not a vendor ticket')
    await db().from('request_comments').insert([{ request_id: t, author_id: fx.agentA.id, body: 'public hello', is_internal: false }, { request_id: t, author_id: fx.agentA.id, body: 'INTERNAL secret', is_internal: true }])
    const seen = async (u: TestUser) => ((await clientForToken(u.accessToken).from('requests').select('id').in('id', [t, other])).data ?? []).map((r) => r.id)
    expect(await seen(v1a)).toEqual([t])
    expect(await seen(v1m)).toEqual([t])
    expect(await seen(v1b)).toEqual([])
    expect(await seen(v2a)).toEqual([])
    for (const u of [v1a, v1m]) {
      const c = ((await clientForToken(u.accessToken).from('request_comments').select('body').eq('request_id', t)).data ?? []).map((x) => x.body)
      expect(c).toContain('public hello')
      expect(c).not.toContain('INTERNAL secret')
    }
    // a vendor sees no ticket history (activity) and no approvals
    expect(((await clientForToken(v1a.accessToken).from('request_activity').select('id').eq('request_id', t)).data ?? []).length).toBe(0)
  })
  it('nobody can make himself a vendor, or move to another company', async () => {
    const c = clientForToken(fx.requesterA.accessToken)
    const r1 = await c.from('profiles').update({ vendor_company_id: co1, vendor_role: 'manager' } as never).eq('id', fx.requesterA.id)
    expect(r1.error).not.toBeNull()
    const r2 = await clientForToken(v1a.accessToken).from('profiles').update({ vendor_company_id: co2 } as never).eq('id', v1a.id)
    expect(r2.error).not.toBeNull()
    expect((await db().from('profiles').select('vendor_company_id').eq('id', v1a.id).single()).data.vendor_company_id).toBe(co1)
  })
  it('a vendor cannot raise a ticket', async () => {
    actAs(v1a)
    const f = new FormData(); f.set('service_id', fx.teamA.serviceId); f.set('form_data', '{}')
    expect((await createRequest(f)).error).toMatch(/vendor/i)
  })
})

describe('only the vendor screens change a vendor ticket', () => {
  it('the ordinary status action refuses a vendor, a vendor manager and a vendor who is not the assignee; a vendor never cancels', async () => {
    const t = await ticket(v1a.id)
    for (const [u, to] of [[v1a, 'in_progress'], [v1a, 'cancelled'], [v1m, 'in_progress'], [v1b, 'in_progress']] as const) {
      actAs(u)
      expect((await updateRequestStatus(t, to as never, 'trying')).error, `${u.email} -> ${to}`).toBeTruthy()
    }
    expect((await row(t)).status).toBe('open')
    actAs(v1m)
    expect((await vendorStartWorking(t, 'X-1')).error).toBeTruthy()
    actAs(v1b)
    expect((await vendorStartWorking(t, 'X-1')).error).toMatch(/not assigned/i)
    expect((await row(t)).status).toBe('open')
  })
})

describe('start working and resolve', () => {
  it('start needs the OEM ticket number; it is saved with today\'s date; then resolve needs the choice, remarks for Other, and the FSR', async () => {
    const t = await ticket(v1a.id)
    actAs(v1a)
    expect((await vendorStartWorking(t, '   ')).error).toMatch(/OEM ticket number/i)
    expect((await row(t)).status).toBe('open')
    expect((await vendorStartWorking(t, 'VT-77')).error).toBeUndefined()
    const r = await row(t)
    expect(r.status).toBe('in_progress')
    expect(r.form_data.oemno).toBe('VT-77')
    expect(r.form_data.oemdt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await comments(t)).some((c) => /VT-77/.test(c.body) && !c.is_internal)).toBe(true)

    expect((await vendorResolve({ requestId: t, choice: '', remarks: '', attachmentIds: [] })).error).toMatch(/resolution/i)
    expect((await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [] })).error).toMatch(/FSR/i)
    expect((await vendorResolve({ requestId: t, choice: 'not-in-list', remarks: '', attachmentIds: [] })).error).toMatch(/list/i)
    const f = await fsr(t, v1a)
    expect((await vendorResolve({ requestId: t, choice: 'Other', remarks: 'short', attachmentIds: [f] })).error).toMatch(/Other/)
    // somebody else's file is not my FSR
    const foreign = await fsr(t, v1b)
    expect((await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [foreign] })).error).toMatch(/FSR/i)

    expect((await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [f] })).error).toBeUndefined()
    const done = await row(t)
    expect(done.status).toBe('resolved')
    expect(done.form_data.acres).toBe('r1')
    expect((await comments(t)).some((c) => c.body === 'Resolution: COMPRESSOR CHANGED')).toBe(true)
  })
  it('"Other" with remarks resolves, and the remarks are the final resolution text', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    const f = await fsr(t, v1a)
    expect((await vendorResolve({ requestId: t, choice: 'Other', remarks: 'Replaced the burnt wiring harness and tested the unit', attachmentIds: [f] })).error).toBeUndefined()
    expect((await comments(t)).some((c) => c.body === 'Replaced the burnt wiring harness and tested the unit')).toBe(true)
    expect((await row(t)).form_data.acres).toBe('Other')
  })
  it('a vendor message is public and reaches the store', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    expect((await vendorAddComment(t, 'Engineer will visit tomorrow')).error).toBeUndefined()
    expect((await comments(t)).some((c) => c.body === 'Engineer will visit tomorrow' && !c.is_internal)).toBe(true)
  })
})

describe('part required (no PO)', () => {
  it('lists the items, puts the ticket on hold, and only "Parts received" with a remark brings it back; a hold cannot be resolved', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    expect((await vendorRequestParts({ requestId: t, lines: [] })).error).toMatch(/item/i)
    expect((await vendorRequestParts({ requestId: t, lines: [{ item_name: 'Capacitor', qty: 0 }] })).error).toMatch(/quantity/i)
    expect((await vendorRequestParts({ requestId: t, lines: [{ item_name: 'Capacitor 45uF', qty: 2 }, { item_name: 'Fan motor', qty: 1 }] })).error).toBeUndefined()
    expect((await row(t)).status).toBe('hold_purchase_ho')
    expect((await row(t)).waiting_since).not.toBeNull()
    expect((await db().from('vendor_requests').select('kind, status').eq('request_id', t).single()).data).toMatchObject({ kind: 'parts', status: 'pending' })
    expect((await comments(t)).some((c) => /Capacitor 45uF - qty 2/.test(c.body))).toBe(true)

    expect((await vendorRequestParts({ requestId: t, lines: [{ item_name: 'Again', qty: 1 }] })).error).toBeTruthy()
    const f = await fsr(t, v1a)
    expect((await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [f] })).error).toMatch(/Start working|in progress/i)
    expect((await vendorPartsReceived(t, '')).error).toMatch(/remark/i)
    expect((await vendorPartsReceived(t, 'parts received, engineer on site')).error).toBeUndefined()
    const r = await row(t)
    expect(r.status).toBe('in_progress')
    expect(r.waiting_since).toBeNull()
    expect((await db().from('vendor_requests').select('status').eq('request_id', t).single()).data.status).toBe('received')
  })
  it('a Citykart technician who ends the hold closes the pending request', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    await vendorRequestParts({ requestId: t, lines: [{ item_name: 'Gas cylinder', qty: 1 }] })
    await db().from('team_members').upsert({ team_id: fx.teamA.id, user_id: fx.agentA.id, org_id: fx.orgId }, { onConflict: 'team_id,user_id' })
    actAs(fx.agentA)
    expect((await updateRequestStatus(t, 'in_progress' as never, 'Taking it back, parts arranged by Citykart')).error).toBeUndefined()
    expect((await db().from('vendor_requests').select('status').eq('request_id', t).single()).data.status).toBe('cancelled')
  })
})

describe('PO required from Citykart', () => {
  const lines = [{ item_name: 'Compressor', qty: 1, price_excl_gst: 12500 }, { item_name: 'Capacitor', qty: 2, price_excl_gst: 450.5 }]

  it('needs a price on every line and an approver; sends ONE approval mail; holds the ticket', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    expect((await vendorRequestPo({ requestId: t, lines: [{ item_name: 'Compressor', qty: 1 }], quoteAttachmentIds: [await fsr(t, v1a)] })).error).toMatch(/price/i)
    expect((await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [] })).error).toMatch(/quote/i)            // the quote is compulsory
    expect((await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, v1b)] })).error).toMatch(/quote/i)   // somebody else's file is not my quote
    const before = mails().length
    expect((await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, v1a)] })).error).toBeUndefined()
    expect((await row(t)).status).toBe('hold_purchase_ho')
    const sent = mails().slice(before).filter((m) => /PO approval needed/.test(m.subject))
    expect(sent.length).toBe(1)
    const vr = (await db().from('vendor_requests').select('id, kind, status, approver_id').eq('request_id', t).single()).data
    expect(vr).toMatchObject({ kind: 'po', status: 'pending', approver_id: fx.agentA.id })
    const items = (await db().from('vendor_request_items').select('item_name, qty, price_excl_gst').eq('vendor_request_id', vr.id).order('line_no')).data
    expect(items.map((i: { price_excl_gst: string }) => Number(i.price_excl_gst))).toEqual([12500, 450.5])
  })

  it('only the approver decides; approving needs the PO number, date and document; it returns the ticket to In Progress and mails the OEM with the document', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, v1a)] })
    const vr = (await db().from('vendor_requests').select('id').eq('request_id', t).single()).data.id as string
    const form = (extra: Record<string, string | File>) => { const f = new FormData(); f.set('vendor_request_id', vr); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f }

    for (const u of [v1a, fx.requesterA, fx.agentB]) { actAs(u); expect((await approveVendorPo(form({ po_number: 'P1', po_date: '2026-10-01', po_document: png('po.png') }))).error, u.email).toBeTruthy() }
    actAs(fx.agentA)
    expect((await approveVendorPo(form({ po_date: '2026-10-01', po_document: png('po.png') }))).error).toMatch(/PO number/i)
    expect((await approveVendorPo(form({ po_number: 'PO-9', po_document: png('po.png') }))).error).toMatch(/PO date/i)
    expect((await approveVendorPo(form({ po_number: 'PO-9', po_date: '2999-01-01', po_document: png('po.png') }))).error).toMatch(/future/i)
    expect((await approveVendorPo(form({ po_number: 'PO-9', po_date: '2026-10-01' }))).error).toMatch(/document/i)
    expect((await row(t)).status).toBe('hold_purchase_ho')

    const before = mails().length
    expect((await approveVendorPo(form({ po_number: 'PO-9', po_date: '2026-10-01', po_document: png('PO-9.png') }))).error).toBeUndefined()
    const r = await row(t)
    expect(r.status).toBe('in_progress')
    expect(r.waiting_since).toBeNull()
    const v = (await db().from('vendor_requests').select('status, po_number, po_date, po_attachment_id').eq('id', vr).single()).data
    expect(v).toMatchObject({ status: 'approved', po_number: 'PO-9', po_date: '2026-10-01' })
    expect(v.po_attachment_id).toBeTruthy()
    const oem = mails().slice(before).find((m) => /PO PO-9 approved/.test(m.subject))
    expect(oem, 'the mail to the OEM').toBeTruthy()
    expect(String(oem!.to)).toContain('po@oem.test')
    expect(oem!.attachments?.map((x) => x.filename)).toEqual(['PO-9.png'])
    // a second decision does nothing
    actAs(fx.agentA)
    expect((await approveVendorPo(form({ po_number: 'PO-10', po_date: '2026-10-01', po_document: png('x.png') }))).error).toBeTruthy()
    // the vendor can now resolve it
    actAs(v1a)
    const f = await fsr(t, v1a)
    expect((await vendorResolve({ requestId: t, choice: 'r2', remarks: '', attachmentIds: [f] })).error).toBeUndefined()
  })

  it('rejecting needs a reason, cancels the ticket like a rejected approval (48 h to reopen) and mails the OEM once; the store can reopen it', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, v1a)] })
    const vr = (await db().from('vendor_requests').select('id').eq('request_id', t).single()).data.id as string
    actAs(fx.agentA)
    expect((await rejectVendorPo({ vendorRequestId: vr, reason: 'no' })).error).toMatch(/reason/i)
    const before = mails().length
    expect((await rejectVendorPo({ vendorRequestId: vr, reason: 'Price is too high, please send a lower quote' })).error).toBeUndefined()
    const r = await row(t)
    expect(r.status).toBe('cancelled')
    expect(r.cancellation_reason).toBe('approval_rejected')
    const hours = (new Date(r.reopen_deadline_at).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(47); expect(hours).toBeLessThan(48.1)
    expect(mails().slice(before).filter((m) => /PO request rejected/.test(m.subject)).length).toBe(1)
    expect((await rejectVendorPo({ vendorRequestId: vr, reason: 'again, a second time' })).error).toBeTruthy()
    // the store reopens it: back to the same vendor technician
    actAs(fx.requesterA)
    expect((await updateRequestStatus(t, 'assigned' as never, 'please look again')).error).toBeUndefined()
    const back = await row(t)
    expect(back.status).toBe('assigned')
    expect(back.assigned_to).toBe(v1a.id)
  })
})

describe('reopen after resolve', () => {
  it('goes back to the same vendor technician, Open, with the OEM number and date emptied, and the OEM mailed again is the status-change\'s job', async () => {
    const t = await ticket(v1a.id)
    actAs(v1a)
    await vendorStartWorking(t, 'VT-100')
    const f = await fsr(t, v1a)
    await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [f] })
    actAs(fx.requesterA)
    expect((await updateRequestStatus(t, 'open' as never, 'still not cooling')).error).toBeUndefined()
    const r = await row(t)
    expect(r.status).toBe('open')
    expect(r.assigned_to).toBe(v1a.id)
    expect(r.form_data.oemno).toBe('')
    expect(r.form_data.oemdt).toBe('')
    // he must type the new number to start again
    actAs(v1a)
    expect((await vendorStartWorking(t, '')).error).toBeTruthy()
    expect((await vendorStartWorking(t, 'VT-101')).error).toBeUndefined()
    expect((await row(t)).form_data.oemno).toBe('VT-101')
  })
})

describe('Business Rules and vendors', () => {
  it('route by the AC\'s vendor; never take a ticket away from a vendor technician', async () => {
    const a = db()
    const mk = async (name: string, trigger: string[], conditions: unknown[], assignee: string, order: number) => {
      const id = (await a.from('business_rules').insert({ org_id: fx.orgId, name: `${tag} ${name}`, trigger, is_active: true, conditions, actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [assignee] } }], execution_order: order }).select('id').single()).data.id as string
      rules.push(id)
    }
    await mk('voltas to v1a', ['created'], [{ field: 'service_id', operator: 'equals', value: fx.teamA.serviceId }, { field: 'ac_amc_vendor', operator: 'contains', value: 'voltas', logic: 'AND' }, { field: 'store_region', operator: 'equals', value: 'R1', logic: 'AND' }], v1a.id, 9001)
    await mk('everything back to the Citykart technician', ['created', 'updated'], [{ field: 'service_id', operator: 'equals', value: fx.teamA.serviceId }], fx.agentA.id, 9002)
    await db().from('team_members').upsert({ team_id: fx.teamA.id, user_id: fx.agentA.id, org_id: fx.orgId }, { onConflict: 'team_id,user_id' })
    const t = await ticket(null)
    await runRulesForTrigger('created', t)
    expect((await row(t)).assigned_to).toBe(v1a.id)       // the second rule did not take it back
    await runRulesForTrigger('updated', t)
    expect((await row(t)).assigned_to).toBe(v1a.id)
    // a ticket whose AC is of another vendor is not routed to v1a
    const t2 = await ticket(null)
    await db().from('request_master_snapshots').update({ snapshot: [{ ...UNIT, amc_vendor: 'BLUESTAR' }] }).eq('request_id', t2)
    await runRulesForTrigger('created', t2)
    expect((await row(t2)).assigned_to).toBe(fx.agentA.id)
  })
})

describe('quote versions, revised price, parts list changes, and files under their messages', () => {
  const lines = [{ item_name: 'Compressor', qty: 1, price_excl_gst: 12500 }, { item_name: 'Capacitor', qty: 2, price_excl_gst: 450.5 }]
  const open = async (t: string) => (await db().from('vendor_requests').select('*').eq('request_id', t).in('status', ['pending', 'revision_requested']).maybeSingle()).data
  const versions = async (t: string) => ((await db().from('vendor_requests').select('version, status').eq('request_id', t).order('version')).data ?? []) as { version: number; status: string }[]
  const commentWithFiles = async (t: string, like: RegExp) => {
    const cs = ((await db().from('request_comments').select('id, body').eq('request_id', t)).data ?? []) as { id: string; body: string }[]
    const c = cs.find((x) => like.test(x.body))
    if (!c) return null
    const files = ((await db().from('request_attachments').select('file_name').eq('comment_id', c.id)).data ?? []) as { file_name: string }[]
    return { body: c.body, files: files.map((f) => f.file_name) }
  }

  it('the quote file is tied to the PO-request message; asking for a revised price moves the ticket to "Revise price required" and back; only the newest version can be approved', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    const quote1 = await fsr(t, v1a)
    expect((await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [quote1] })).error).toBeUndefined()
    expect((await commentWithFiles(t, /PO required from Citykart \(quote version 1\)/))?.files).toEqual(['fsr.png'])
    expect((await holdKindsFor([t])).get(t)).toBe('po')
    const v1 = await open(t)

    // only the approver asks; a note is needed; the vendor cannot ask himself
    actAs(v1a)
    expect((await requestPoRevision({ vendorRequestId: v1.id, note: 'please reduce the compressor price' })).error).toBeTruthy()
    actAs(fx.agentA)
    expect((await requestPoRevision({ vendorRequestId: v1.id, note: 'no' })).error).toMatch(/at least/i)
    expect((await requestPoRevision({ vendorRequestId: v1.id, note: 'Compressor is too costly, send a better quote' })).error).toBeUndefined()
    expect((await row(t)).status).toBe('hold_purchase_ho')                 // still on hold, the clock stays paused
    expect((await row(t)).waiting_since).not.toBeNull()
    expect((await holdKindsFor([t])).get(t)).toBe('revise')                 // the vendor's "Revise price required" box
    expect((await open(t)).status).toBe('revision_requested')
    expect((await comments(t)).some((c) => /Revised price requested by .* Compressor is too costly/.test(c.body) && !c.is_internal)).toBe(true)
    // while the vendor's price is awaited the approver cannot approve; asking twice does nothing
    const form = (id: string) => { const f = new FormData(); f.set('vendor_request_id', id); f.set('po_number', 'PO-1'); f.set('po_date', '2026-10-01'); f.set('po_document', png('po.png')); return f }
    expect((await approveVendorPo(form(v1.id))).error).toMatch(/revised price/i)
    expect((await requestPoRevision({ vendorRequestId: v1.id, note: 'once more please' })).error).toBeTruthy()

    // the vendor sends version 2: a NEW quote file is compulsory
    actAs(v1a)
    const cheaper = [{ item_name: 'Compressor', qty: 1, price_excl_gst: 11000 }, { item_name: 'Capacitor', qty: 2, price_excl_gst: 450.5 }]
    expect((await vendorRevisePo({ requestId: t, lines: cheaper, quoteAttachmentIds: [] })).error).toMatch(/quote/i)
    expect((await vendorRevisePo({ requestId: t, lines: cheaper, quoteAttachmentIds: [quote1] })).error).toMatch(/new file|revised quote/i)   // the old file cannot stand in
    const before = mails().length
    const quote2 = await fsr(t, v1a)
    expect((await vendorRevisePo({ requestId: t, lines: cheaper, quoteAttachmentIds: [quote2] })).error).toBeUndefined()
    expect(await versions(t)).toEqual([{ version: 1, status: 'superseded' }, { version: 2, status: 'pending' }])
    expect((await row(t)).status).toBe('hold_purchase_ho')
    expect((await holdKindsFor([t])).get(t)).toBe('po')                      // back in "PO required"
    const note = await commentWithFiles(t, /Revised quote \(version 2\)/)
    expect(note?.files).toEqual(['fsr.png'])
    expect(note?.body).toMatch(/Total was 13,401\.00, now 11,901\.00/)
    expect(mails().slice(before).filter((m) => /Revised quote \(version 2\)/.test(m.subject)).length).toBe(1)   // ONE new request to the approver

    // the old version cannot be approved or decided any more
    actAs(fx.agentA)
    expect((await approveVendorPo(form(v1.id))).error).toMatch(/replaced by a newer version/i)
    expect((await rejectVendorPo({ vendorRequestId: v1.id, reason: 'old version, should not work' })).error).toMatch(/replaced by a newer version/i)

    // version 2 is approved; the PO document is tied to the approval message; the PO is based on version 2
    const v2 = await open(t)
    expect((await approveVendorPo(form(v2.id))).error).toBeUndefined()
    const approved = await commentWithFiles(t, /PO approved by .* quote version 2/)
    expect(approved?.files).toEqual(['po.png'])
    expect((await versions(t)).map((v) => v.status)).toEqual(['superseded', 'approved'])
  })

  it('a rejected quote while the vendor is asked for a revised price also cancels the ticket', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, v1a)] })
    const v1 = await open(t)
    actAs(fx.agentA)
    await requestPoRevision({ vendorRequestId: v1.id, note: 'lower the price please' })
    expect((await rejectVendorPo({ vendorRequestId: v1.id, reason: 'We will buy from somebody else' })).error).toBeUndefined()
    expect((await row(t)).status).toBe('cancelled')
    expect((await versions(t))[0].status).toBe('rejected')
  })

  it('the vendor changes the parts list while on hold (a new version, the old one kept) and can withdraw a request', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    await vendorRequestParts({ requestId: t, lines: [{ item_name: 'Capacitor 45uF', qty: 2 }] })
    expect((await vendorUpdateParts({ requestId: t, lines: [] })).error).toMatch(/item/i)
    expect((await vendorUpdateParts({ requestId: t, lines: [{ item_name: 'Capacitor 45uF', qty: 2 }, { item_name: 'Fan motor', qty: 1 }, { item_name: 'Gas R32', qty: 1 }] })).error).toBeUndefined()
    expect(await versions(t)).toEqual([{ version: 1, status: 'superseded' }, { version: 2, status: 'pending' }])
    expect((await row(t)).status).toBe('hold_purchase_ho')
    expect((await comments(t)).some((c) => /Parts list updated \(version 2\)[\s\S]*Gas R32/.test(c.body))).toBe(true)
    const items = ((await db().from('vendor_request_items').select('item_name').eq('vendor_request_id', (await open(t)).id).order('line_no')).data ?? []) as { item_name: string }[]
    expect(items.map((i) => i.item_name)).toEqual(['Capacitor 45uF', 'Fan motor', 'Gas R32'])
    // withdraw: a reason is needed; the ticket returns to In Progress
    expect((await vendorWithdrawRequest({ requestId: t, reason: '' })).error).toMatch(/why/i)
    expect((await vendorWithdrawRequest({ requestId: t, reason: 'Raised by mistake' })).error).toBeUndefined()
    expect((await row(t)).status).toBe('in_progress')
    expect((await versions(t)).map((v) => v.status)).toEqual(['superseded', 'withdrawn'])
    // somebody else's ticket / a ticket not on hold cannot be changed
    actAs(v1b)
    expect((await vendorUpdateParts({ requestId: t, lines: [{ item_name: 'x1', qty: 1 }] })).error).toBeTruthy()
  })

  it('a quote can be withdrawn too; the FSR is tied to the resolution message', async () => {
    const t = await ticket(v1a.id, 'in_progress')
    actAs(v1a)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, v1a)] })
    expect((await vendorWithdrawRequest({ requestId: t, reason: 'Customer solved it another way' })).error).toBeUndefined()
    expect((await row(t)).status).toBe('in_progress')
    expect((await versions(t)).map((v) => v.status)).toEqual(['withdrawn'])
    const f = await fsr(t, v1a)
    await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [f] })
    expect((await commentWithFiles(t, /^Resolution: COMPRESSOR CHANGED/))?.files).toEqual(['fsr.png'])
  })
})
