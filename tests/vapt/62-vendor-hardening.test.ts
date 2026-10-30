// The vendor module, audit hardening (C-12 / C-13 / C-14 / C-15 / C-16 / C-29 / C-31), on the isolated audit stack (mail goes nowhere). Modelled on 36-vendor-module.test.ts.
// NOT run by the author of the change.
//  - a vendor person with open tickets cannot be moved to another company or made a manager; once they are given to somebody else he can;
//  - a vendor company that is switched off has no access: its technician cannot act on a ticket;
//  - a long list of ticket ids (more than the production proxy accepts in one request) is read in batches and does not fail;
//  - a PO decision is taken with one conditional update: of two approvers only one wins;
//  - a mail about a quote that fails leaves an internal note on the ticket instead of vanishing;
//  - there is no built-in PO approver: with no setting, nobody is the approver.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, createTestUser, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
let failMail = false
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => (failMail ? { error: 'smtp down' } : {})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { vendorStartWorking } from '@/lib/actions/vendor'
import { approveVendorPo } from '@/lib/actions/vendor-po'
import { updateVendorPerson } from '@/lib/actions/admin/vendors'
import { holdKindsFor, createVendorRequest } from '@/lib/vendor/requests'
import { PO_APPROVER_SETTING, resolvePoApprover, sendMailOrNote } from '@/lib/vendor/po'
import { loadPoRegister } from '@/lib/vendor/register'

vi.setConfig({ testTimeout: 120_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t62${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
let co1 = '', co2 = ''
let tech: TestUser
const made: string[] = []
const vendorUsers: TestUser[] = []
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

async function ticket(assignee: string | null, status = 'open', title = 'vendor hardening'): Promise<string> {
  const r = (await db().from('requests').insert({ request_no: '', title: `${tag} ${title}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: assignee, status, form_sections_snapshot: [], form_data: {} }).select('id').single()).data.id as string
  made.push(r)
  return r
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  co1 = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} One` }).select('id').single()).data.id
  co2 = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Two` }).select('id').single()).data.id
  tech = await createTestUser(`${tag}-tech`, 'Vendor tech')
  await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: co1, vendor_role: 'technician' }).eq('id', tech.id)
  vendorUsers.push(tech)
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('app_settings').delete().eq('key', PO_APPROVER_SETTING)
  if (made.length) {
    await a.from('vendor_request_items').delete().in('vendor_request_id', ((await a.from('vendor_requests').select('id').in('request_id', made)).data ?? []).map((r: { id: string }) => r.id))
    await a.from('vendor_requests').delete().in('request_id', made)
    await a.from('request_attachments').delete().in('request_id', made)
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null }).in('id', vendorUsers.map((u) => u.id))
  await a.from('vendor_companies').delete().in('id', [co1, co2].filter(Boolean))
  await fx?.cleanup()
}, 180_000)

describe('moving a vendor person (C-12)', () => {
  it('is refused while he holds open tickets, naming them, and allowed once they are with somebody else', async () => {
    const t = await ticket(tech.id, 'in_progress')
    actAs(fx.admin)
    const refused = await updateVendorPerson(tech.id, { company_id: co2 })
    expect(refused.error).toMatch(/still holds 1 open ticket/)
    const asManager = await updateVendorPerson(tech.id, { vendor_role: 'manager' })
    expect(asManager.error).toMatch(/still holds 1 open ticket/)
    expect((await db().from('profiles').select('vendor_company_id, vendor_role').eq('id', tech.id).single()).data).toMatchObject({ vendor_company_id: co1, vendor_role: 'technician' })
    await db().from('requests').update({ assigned_to: fx.agentA.id }).eq('id', t)
    expect((await updateVendorPerson(tech.id, { company_id: co2 })).error).toBeUndefined()
    expect((await db().from('profiles').select('vendor_company_id').eq('id', tech.id).single()).data.vendor_company_id).toBe(co2)
    await db().from('profiles').update({ vendor_company_id: co1 }).eq('id', tech.id)
  })
})

describe('a vendor company that is switched off (C-13)', () => {
  it('its technician cannot act on a ticket until it is switched on again', async () => {
    const t = await ticket(tech.id, 'open', 'switched off')
    actAs(tech)
    await db().from('vendor_companies').update({ is_active: false }).eq('id', co1)
    expect((await vendorStartWorking(t, 'REF-1')).error).toMatch(/switched off/i)
    expect((await db().from('requests').select('status').eq('id', t).single()).data.status).toBe('open')
    await db().from('vendor_companies').update({ is_active: true }).eq('id', co1)
    expect(((await vendorStartWorking(t, 'REF-1')).error ?? '')).not.toMatch(/switched off/i)
  })
})

describe('long lists of ticket ids (C-14)', () => {
  it('holdKindsFor reads 1,000 ids without a request line the proxy would refuse, and the PO register of a vendor loads', async () => {
    const t = await ticket(tech.id, 'hold_purchase_ho', 'long list')
    const made1 = await createVendorRequest({ orgId: fx.orgId, requestId: t, kind: 'parts', createdBy: tech.id, lines: [{ item_name: 'Fan motor', qty: 1, price_excl_gst: null }] })
    expect(made1.error).toBeUndefined()
    const fakeIds = Array.from({ length: 999 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const kinds = await holdKindsFor([...fakeIds, t])
    expect(kinds.get(t)).toBe('parts')
    await expect(loadPoRegister({ kind: 'staff', orgId: fx.orgId })).resolves.toBeInstanceOf(Array)
  })
})

describe('a decision on a quote is taken once (C-15)', () => {
  it('of two approvers pressing Approve at the same moment only one wins, and the ticket moves once', async () => {
    const a = db()
    await a.from('app_settings').upsert({ key: PO_APPROVER_SETTING, value: fx.agentA.id }, { onConflict: 'key' })
    const t = await ticket(tech.id, 'hold_purchase_ho', 'two approvers')
    const vr = await createVendorRequest({ orgId: fx.orgId, requestId: t, kind: 'po', createdBy: tech.id, lines: [{ item_name: 'Compressor', qty: 1, price_excl_gst: 1000 }], extra: { approver_id: fx.agentA.id, approver_ids: [fx.agentA.id, fx.manager.id] } })
    expect(vr.error).toBeUndefined()
    const form = () => { const f = new FormData(); f.set('vendor_request_id', vr.id!); f.set('po_number', 'PO-1'); f.set('po_date', new Date().toISOString().slice(0, 10)); f.set('po_document', new File([PNG], 'po.png', { type: 'image/png' })); return f }
    actAs(fx.admin)
    const [r1, r2] = await Promise.all([approveVendorPo(form()), approveVendorPo(form())])
    expect([r1, r2].filter((r) => !r.error)).toHaveLength(1)
    expect((await a.from('vendor_requests').select('status').eq('id', vr.id!).single()).data.status).toBe('approved')
    expect((await a.from('requests').select('status').eq('id', t).single()).data.status).toBe('in_progress')
  })
})

describe('a mail about a quote that fails is not lost silently (C-16)', () => {
  it('leaves an internal note on the ticket', async () => {
    const t = await ticket(tech.id, 'hold_purchase_ho', 'mail fails')
    failMail = true
    const ok = await sendMailOrNote({ to: 'approver@citykartstores.com', mail: { subject: 'PO approval needed', html: '<p>x</p>', text: 'x' }, request: { id: t, request_no: 'CKSD-X' }, noteAuthorId: tech.id, whom: 'the PO approver(s)' })
    failMail = false
    expect(ok).toBe(false)
    const notes = ((await db().from('request_comments').select('body, is_internal').eq('request_id', t)).data ?? []) as { body: string; is_internal: boolean }[]
    expect(notes.some((n) => n.is_internal && /could not be sent/.test(n.body))).toBe(true)
  })
})

describe('no built-in PO approver (C-31)', () => {
  it('with no setting nobody is the approver; with a valid setting that person is', async () => {
    const a = db()
    await a.from('app_settings').delete().eq('key', PO_APPROVER_SETTING)
    expect(await resolvePoApprover(fx.orgId)).toBeNull()
    await a.from('app_settings').upsert({ key: PO_APPROVER_SETTING, value: fx.agentA.id }, { onConflict: 'key' })
    expect((await resolvePoApprover(fx.orgId))?.id).toBe(fx.agentA.id)
  })
})
