// QA: vendor / PO flows under simultaneous actions, on the isolated audit stack. Nothing may be done twice and no ticket may end up in an inconsistent state:
//  - two PO approvers approve the same quote at the same moment -> exactly one decision, one mail to the OEM, one PO number;
//  - one approver approves while another rejects -> exactly one outcome and the ticket status matches it;
//  - the vendor sends two quotes at once -> only one quote is open;
//  - the vendor presses Start twice -> one start, one "started" message;
//  - the store reopens a resolved vendor ticket twice at once -> one reopen.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, createTestUser, getAdmin, type D03Fixtures, type TestUser } from '../../tests/setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string; attachments?: { filename: string }[] }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { updateRequestStatus } from '@/lib/actions/requests'
import { vendorResolve, vendorStartWorking } from '@/lib/actions/vendor'
import { vendorRequestPo } from '@/lib/actions/vendor-requests'
import { approveVendorPo, rejectVendorPo } from '@/lib/actions/vendor-po'
import { PO_APPROVER_SETTING } from '@/lib/vendor/po'

import { AsyncLocalStorage } from 'node:async_hooks'
// who a call acts as: the default signed-in user, or (inside as()) the user of that one call, so two calls running at the same moment can act as two different people
const als = new AsyncLocalStorage<string>()
let defaultToken = ''
vi.mocked(createClient).mockImplementation((async () => clientForToken(als.getStore() ?? defaultToken)) as never)

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `qv${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
let vendor: TestUser
let company = ''
const made: string[] = []
const actAs = (u: { accessToken: string }) => { defaultToken = u.accessToken }
const as = <T,>(u: { accessToken: string }, fn: () => Promise<T>) => als.run(u.accessToken, fn)
const mails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string | string[]; subject: string; attachments?: { filename: string }[] }[]
const SECTIONS = [{ id: 's1', title: 'AC', order: 1, fields: [
  { id: 'oemno', type: 'text', label: 'AC OEM Ticket Number', required: false, order: 1 },
  { id: 'oemdt', type: 'date', label: 'AC OEM Ticket Creation Date', required: false, order: 2 },
  { id: 'acres', type: 'select', label: 'AC resolution', required: false, order: 3, options: [{ value: 'r1', label: 'GAS FILLED' }] },
] }]
const UNIT = { id: '00000000-0000-0000-0000-0000000000bb', ckdesk_no: '1', brand: 'VOLTAS', tonnage: '1.5', amc_vendor: 'VOLTAS', emails: ['oem@oem.test'], po_emails: ['po@oem.test'] }
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const png = (name: string) => new File([PNG], name, { type: 'image/png' })
const lines = [{ item_name: 'Compressor', qty: 1, price_excl_gst: 12500 }]
const fsr = async (id: string, by: TestUser) => (await db().from('request_attachments').insert({ request_id: id, uploaded_by: by.id, file_name: 'q.png', file_size: 70, mime_type: 'image/png', storage_path: `${id}/q-${Math.random()}.png` }).select('id').single()).data.id as string

async function ticket(status = 'in_progress'): Promise<string> {
  const r = (await db().from('requests').insert({ request_no: '', title: `${tag} t`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: vendor.id, status, form_sections_snapshot: SECTIONS, form_data: {} }).select('id').single()).data.id as string
  made.push(r)
  await db().from('request_master_snapshots').insert({ request_id: r, kind: 'ac', unit_ids: [UNIT.id], snapshot: [UNIT] })
  return r
}
const poForm = (vr: string, no: string) => { const f = new FormData(); f.set('vendor_request_id', vr); f.set('po_number', no); f.set('po_date', '2026-10-01'); f.set('po_document', png(`${no}.png`)); return f }
async function quote(t: string) { actAs(vendor); expect((await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, vendor)] })).error).toBeUndefined(); return (await db().from('vendor_requests').select('id').eq('request_id', t).eq('status', 'pending').single()).data.id as string }

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  company = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Co` }).select('id').single()).data.id
  vendor = await createTestUser(`${tag}-v`, 'QA Concurrency Vendor')
  await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: company, vendor_role: 'technician' }).eq('id', vendor.id)
  await a.from('services').update({ form_sections: SECTIONS }).eq('id', fx.teamA.serviceId)
  await a.from('app_settings').upsert({ key: PO_APPROVER_SETTING, value: fx.agentA.id }, { onConflict: 'key' })
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('app_settings').delete().eq('key', PO_APPROVER_SETTING)
  if (made.length) {
    await a.from('vendor_requests').delete().in('request_id', made); await a.from('request_master_snapshots').delete().in('request_id', made); await a.from('request_attachments').delete().in('request_id', made)
    await a.from('notifications').delete().in('request_id', made)
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('services').update({ form_sections: [] }).eq('id', fx.teamA.serviceId)
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null }).eq('id', vendor.id)
  await a.from('vendor_companies').delete().eq('id', company)
  await fx?.cleanup()
}, 180_000)

describe('simultaneous decisions on one quote', () => {
  it('two approvers approving at the same moment: exactly one wins, one OEM mail, ticket back in progress', async () => {
    const t = await ticket(); const vr = await quote(t)
    await db().from('vendor_requests').update({ approver_ids: [fx.agentA.id, fx.manager.id], approver_id: fx.agentA.id }).eq('id', vr)
    const before = mails().length
    const [x, y] = await Promise.all([as(fx.agentA, () => approveVendorPo(poForm(vr, 'PO-A'))), as(fx.manager, () => approveVendorPo(poForm(vr, 'PO-B')))])
    const ok = [x, y].filter((r) => !r.error).length
    expect(ok, `results: ${JSON.stringify([x, y])}`).toBe(1)
    const v = (await db().from('vendor_requests').select('status, po_number').eq('id', vr).single()).data
    expect(v.status).toBe('approved'); expect(['PO-A', 'PO-B']).toContain(v.po_number)
    expect((await db().from('requests').select('status').eq('id', t).single()).data.status).toBe('in_progress')
    const oemMails = mails().slice(before).filter((m) => /PO .* approved/.test(m.subject) && String(m.to).includes('po@oem.test'))
    expect(oemMails.length, 'the OEM must get one PO mail, not two').toBe(1)
  })

  it('one approves while another rejects: exactly one outcome and the ticket status matches it', async () => {
    const t = await ticket(); const vr = await quote(t)
    await db().from('vendor_requests').update({ approver_ids: [fx.agentA.id, fx.manager.id], approver_id: fx.agentA.id }).eq('id', vr)
    const [a, r] = await Promise.all([as(fx.agentA, () => approveVendorPo(poForm(vr, 'PO-C'))), as(fx.manager, () => rejectVendorPo({ vendorRequestId: vr, reason: 'Too expensive, send a lower quote please', cancelTicket: true }))])
    expect([a, r].filter((x) => !x.error).length, `results: ${JSON.stringify([a, r])}`).toBe(1)
    const v = (await db().from('vendor_requests').select('status').eq('id', vr).single()).data.status
    const st = (await db().from('requests').select('status').eq('id', t).single()).data.status
    if (v === 'approved') expect(st).toBe('in_progress')
    else { expect(v).toBe('rejected'); expect(st).toBe('cancelled') }
  })
})

describe('simultaneous vendor actions', () => {
  it('Start pressed twice at once: one start', async () => {
    const t = await ticket('open'); actAs(vendor)
    const before = (await db().from('request_comments').select('id').eq('request_id', t)).data.length
    const results = await Promise.all([vendorStartWorking(t, 'VT-1'), vendorStartWorking(t, 'VT-1')])
    expect(results.filter((r) => !r.error).length, JSON.stringify(results)).toBe(1)
    const started = ((await db().from('request_comments').select('body').eq('request_id', t)).data as { body: string }[]).filter((c) => /started work/.test(c.body))
    expect(started.length).toBe(1)
    expect((await db().from('request_comments').select('id').eq('request_id', t)).data.length - before).toBeGreaterThanOrEqual(1)
  })

  it('two quotes sent at once: only one quote is open and the ticket is on hold once', async () => {
    const t = await ticket(); actAs(vendor)
    const files = [await fsr(t, vendor), await fsr(t, vendor)]
    const results = await Promise.all(files.map((f) => vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [f] })))
    expect(results.filter((r) => !r.error).length, JSON.stringify(results)).toBe(1)
    const open = (await db().from('vendor_requests').select('id').eq('request_id', t).in('status', ['pending', 'revision_requested'])).data
    expect(open.length).toBe(1)
    expect((await db().from('requests').select('status').eq('id', t).single()).data.status).toBe('hold_purchase_ho')
  })

  it('the store reopens a resolved ticket twice at once: one reopen, the same vendor keeps it', async () => {
    const t = await ticket('in_progress'); actAs(vendor)
    const f = await fsr(t, vendor)
    expect((await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [f] })).error).toBeUndefined()
    actAs(fx.requesterA)
    const results = await Promise.all([updateRequestStatus(t, 'open', 'It is still not cooling'), updateRequestStatus(t, 'open', 'It is still not cooling')])
    expect(results.filter((r) => !r.error).length, JSON.stringify(results)).toBe(1)
    const row = (await db().from('requests').select('status, assigned_to, reopen_count').eq('id', t).single()).data
    expect(row.reopen_count).toBe(1); expect(row.assigned_to).toBe(vendor.id)
  })
})
