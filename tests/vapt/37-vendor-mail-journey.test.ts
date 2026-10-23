// The e-mail map of the vendor journey, recorded from real runs on the isolated stack (nothing is sent: the mail sender is replaced by a recorder).
// For every step it records WHO is mailed (the To address) and the subject, so the map in docs/VENDOR-EMAIL-MAP.md is checked against behaviour, and a change that mails
// the wrong person (for example the OEM when only the quote is rejected) fails here. Set VENDOR_MAIL_MAP_OUT to a file name to also write the recorded table there.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { writeFileSync } from 'node:fs'
import { setupD03Fixtures, clientForToken, createTestUser, getAdmin, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (_p: { to: string | string[]; cc?: string | string[]; subject: string; html: string; text?: string; attachments?: { filename: string }[] }) => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { addComment, updateRequestStatus } from '@/lib/actions/requests'
import { vendorResolve, vendorStartWorking, vendorAddComment } from '@/lib/actions/vendor'
import { vendorPartsReceived, vendorRequestParts, vendorRequestPo, vendorRevisePo, vendorUpdateParts, vendorWithdrawRequest } from '@/lib/actions/vendor-requests'
import { approveVendorPo, rejectVendorPo, requestPoRevision } from '@/lib/actions/vendor-po'
import { runRulesForTrigger } from '@/lib/rules/run'
import { PO_APPROVER_SETTING } from '@/lib/vendor/po'

vi.setConfig({ testTimeout: 180_000 })
const db = () => getAdmin() as any // eslint-disable-line @typescript-eslint/no-explicit-any
const tag = `t37${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
let co = ''
let vend: TestUser, vendB: TestUser
const made: string[] = []
const rules: string[] = []
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)

const SECTIONS = [{ id: 's1', title: 'AC', order: 1, fields: [
  { id: 'oemno', type: 'text', label: 'AC OEM Ticket Number', required: true, order: 1 },
  { id: 'oemdt', type: 'date', label: 'AC OEM Ticket Creation Date', required: true, order: 2 },
  { id: 'acres', type: 'select', label: 'AC resolution', required: true, order: 3, options: [{ value: 'r1', label: 'COMPRESSOR CHANGED' }] },
] }]
const UNIT = { id: '00000000-0000-0000-0000-0000000000bb', ckdesk_no: '1', brand: 'VOLTAS', tonnage: '1.5', amc_vendor: 'VOLTAS', region: 'R1', state: 'DL', emails: ['oem@oem.test', 'desk@citykartstores.com'], po_emails: ['po@oem.test'] }
const UNIT2_ID = '00000000-0000-0000-0000-0000000000bc'
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const png = (n: string) => new File([PNG], n, { type: 'image/png' })

const email = new Map<string, string>()   // address -> readable name
const who = (to: string) => to.split(',').map((a) => email.get(a.trim().toLowerCase()) ?? a.trim()).join(' + ')

let last = 0
const table: { step: string; to: string; cc: string; subject: string; text: string; files: string[] }[] = []
/** Waits for the fire-and-forget notifications, then records the mails sent since the previous record. */
async function record(step: string) {
  await new Promise((r) => setTimeout(r, 900))
  const calls = vi.mocked(sendEmail).mock.calls.map((c) => c[0]) as unknown as { to: string | string[]; cc?: string | string[]; subject: string; text?: string; attachments?: { filename: string }[] }[]
  const fresh = calls.slice(last)
  last = calls.length
  if (fresh.length === 0) table.push({ step, to: '(nobody)', cc: '', subject: '', text: '', files: [] })
  for (const m of fresh) table.push({ step, to: who(String(m.to)), cc: m.cc ? who(String(m.cc)) : '', subject: String(m.subject), text: String(m.text ?? ''), files: (m.attachments ?? []).map((a) => a.filename) })
  return fresh.map((m) => ({ to: who(String(m.to)), subject: String(m.subject) }))
}
const mailsTo = (m: { to: string; subject: string }[], name: string) => m.filter((x) => x.to.includes(name))

async function ticket(assignee: string | null, status = 'in_progress', unit: Record<string, unknown> = UNIT): Promise<string> {
  const r = (await db().from('requests').insert({
    request_no: '', title: `${tag} journey`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: assignee, status,
    form_sections_snapshot: SECTIONS, form_data: {},
  }).select('id').single()).data.id as string
  made.push(r)
  await db().from('request_master_snapshots').insert({ request_id: r, kind: 'ac', unit_ids: [unit.id], snapshot: [unit] })
  return r
}
const fsr = async (id: string, by: TestUser) => (await db().from('request_attachments').insert({ request_id: id, uploaded_by: by.id, file_name: 'f.png', file_size: 70, mime_type: 'image/png', storage_path: `${id}/f-${Date.now()}-${Math.random()}.png` }).select('id').single()).data.id as string
const lines = [{ item_name: 'Compressor', qty: 1, price_excl_gst: 12500 }]

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  co = (await a.from('vendor_companies').insert({ org_id: fx.orgId, name: `${tag} Voltas` }).select('id').single()).data.id
  const mk = async (label: string) => {
    const u = await createTestUser(`${tag}-${label}`, `Vendor ${label}`)
    await a.from('profiles').update({ org_id: fx.orgId, role: 'user', is_active: true, must_reset_password: false, vendor_company_id: co, vendor_role: 'technician' }).eq('id', u.id)
    return u
  }
  vend = await mk('v'); vendB = await mk('w')
  await a.from('services').update({ form_sections: SECTIONS }).eq('id', fx.teamA.serviceId)
  await a.from('app_settings').upsert({ key: PO_APPROVER_SETTING, value: fx.agentA.id }, { onConflict: 'key' })
  await a.from('team_members').upsert({ team_id: fx.teamA.id, user_id: fx.agentA.id, org_id: fx.orgId }, { onConflict: 'team_id,user_id' })
  for (const [u, n] of [[vend, 'VENDOR'], [fx.agentA, 'KRISHAN (approver)'], [fx.requesterA, 'STORE'], [fx.agentB, 'OTHER TECHNICIAN'], [fx.admin, 'ADMIN']] as const) email.set(u.email.toLowerCase(), n)
  email.set('oem@oem.test', 'OEM'); email.set('po@oem.test', 'OEM (PO address)'); email.set('desk@citykartstores.com', 'Citykart desk (copy)')
}, 300_000)

afterAll(async () => {
  const a = db()
  if (process.env.VENDOR_MAIL_MAP_OUT) writeFileSync(process.env.VENDOR_MAIL_MAP_OUT, JSON.stringify(table, null, 1))
  await a.from('app_settings').delete().eq('key', PO_APPROVER_SETTING)
  if (rules.length) await a.from('business_rules').delete().in('id', rules)
  if (made.length) {
    await a.from('vendor_requests').delete().in('request_id', made)
    await a.from('request_master_snapshots').delete().in('request_id', made)
    await a.from('request_attachments').delete().in('request_id', made)
    await a.from('notifications').delete().in('request_id', made)
    await a.from('request_activity').delete().in('request_id', made); await a.from('request_comments').delete().in('request_id', made); await a.from('requests').delete().in('id', made)
  }
  await a.from('services').update({ form_sections: [] }).eq('id', fx.teamA.serviceId)
  await a.from('profiles').update({ vendor_company_id: null, vendor_role: null }).in('id', [vend.id, vendB.id])
  await a.from('vendor_companies').delete().eq('id', co)
  await fx?.cleanup()
}, 180_000)

describe('who is mailed at each step of the vendor journey', () => {
  it('assignment by the rules: ONLY the vendor and the store hear of it (the vendor rule runs before the Citykart rule)', async () => {
    const a = db()
    const mkRule = async (name: string, conditions: unknown[], assignee: string, order: number) => {
      const id = (await a.from('business_rules').insert({
        org_id: fx.orgId, name: `${tag} ${name}`, trigger: ['created'], is_active: true, conditions, actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [assignee] } }], execution_order: order,
      }).select('id').single()).data.id as string
      rules.push(id)
    }
    // the vendor rule has the LOWER number, so it runs first; the old "everything to a Citykart technician" rule then finds the ticket already with the vendor and leaves it
    await mkRule('vendor first', [{ field: 'service_id', operator: 'equals', value: fx.teamA.serviceId }, { field: 'ac_amc_vendor', operator: 'contains', value: 'voltas', logic: 'AND' }], vend.id, -20)
    await mkRule('citykart technician', [{ field: 'service_id', operator: 'equals', value: fx.teamA.serviceId }], fx.agentA.id, -10)
    const t = await ticket(null, 'open')
    await runRulesForTrigger('created', t)
    const m = await record('1. Ticket assigned to the vendor technician by the rules')
    expect((await db().from('requests').select('assigned_to').eq('id', t).single()).data.assigned_to).toBe(vend.id)
    expect(mailsTo(m, 'VENDOR').length).toBe(1)
    expect(mailsTo(m, 'STORE').length).toBe(1)
    expect(mailsTo(m, 'KRISHAN').length).toBe(0)
  })

  it('PO path: start, quote, revision asked, revised quote, approved, resolved, reopened', async () => {
    const t = await ticket(vend.id, 'open')
    actAs(vend)
    await vendorStartWorking(t, 'VT-1')
    let m = await record('2. Vendor presses Start working')
    expect(mailsTo(m, 'STORE').length).toBe(1); expect(mailsTo(m, 'VENDOR').length).toBe(0); expect(mailsTo(m, 'KRISHAN').length).toBe(0)

    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, vend)] })
    m = await record('3. Vendor sends the quote (PO required)')
    expect(mailsTo(m, 'KRISHAN').map((x) => x.subject)).toEqual([expect.stringMatching(/PO approval needed/)])
    expect(mailsTo(m, 'STORE').length).toBe(1)
    const v1 = (await db().from('vendor_requests').select('id').eq('request_id', t).eq('status', 'pending').single()).data.id as string

    actAs(fx.agentA)
    await requestPoRevision({ vendorRequestId: v1, note: 'Please reduce the price' })
    m = await record('4. Krishan asks for a revised price')
    expect(mailsTo(m, 'VENDOR').map((x) => x.subject)).toEqual([expect.stringMatching(/Revised price needed/)])
    expect(m.length).toBe(1)

    actAs(vend)
    await vendorRevisePo({ requestId: t, lines: [{ item_name: 'Compressor', qty: 1, price_excl_gst: 11000 }], quoteAttachmentIds: [await fsr(t, vend)] })
    m = await record('5. Vendor sends the revised quote')
    expect(mailsTo(m, 'KRISHAN').map((x) => x.subject)).toEqual([expect.stringMatching(/Revised quote \(version 2\)/)])
    const v2 = (await db().from('vendor_requests').select('id').eq('request_id', t).eq('status', 'pending').single()).data.id as string

    actAs(fx.agentA)
    const f = new FormData(); f.set('vendor_request_id', v2); f.set('po_number', 'PO-7'); f.set('po_date', '2026-10-01'); f.set('po_document', png('PO-7.png'))
    await approveVendorPo(f)
    m = await record('6. Krishan approves the PO (PO number, date, document)')
    expect(mailsTo(m, 'OEM').length).toBe(1)
    expect(String(vi.mocked(sendEmail).mock.calls.at(-1)?.[0]?.to ?? '')).toBeTruthy()
    expect(mailsTo(m, 'STORE').length).toBe(1)
    expect(mailsTo(m, 'VENDOR').map((x) => x.subject)).toEqual([expect.stringMatching(/PO PO-7 approved/)])   // his own mail with the PO document, not a blank "status changed" one

    actAs(vend)
    await vendorResolve({ requestId: t, choice: 'r1', remarks: '', attachmentIds: [await fsr(t, vend)] })
    m = await record('7. Vendor resolves the ticket')
    expect(mailsTo(m, 'STORE').length).toBe(1)

    actAs(fx.requesterA)
    await updateRequestStatus(t, 'open' as never, 'still not cooling')
    m = await record('8. The store reopens the resolved ticket')
    expect(mailsTo(m, 'VENDOR').map((x) => x.subject)).toEqual([expect.stringMatching(/^REOPENED by the store - please attend again/)])
    const reopened = table.find((r) => r.step.startsWith('8.') && r.to === 'VENDOR')
    expect(reopened?.text).toContain('enter the NEW OEM ticket number')
    expect(reopened?.text).toContain('still not cooling')
  })

  it('PO path: quote rejected (ticket goes on) / quote rejected and ticket cancelled', async () => {
    const t = await ticket(vend.id)
    actAs(vend)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, vend)] })
    await record('(set-up) quote sent')
    const v1 = (await db().from('vendor_requests').select('id').eq('request_id', t).eq('status', 'pending').single()).data.id as string
    actAs(fx.agentA)
    await rejectVendorPo({ vendorRequestId: v1, reason: 'Quote is irrelevant' })
    let m = await record('9. Krishan rejects ONLY the quote (the ticket goes on, vendor arranges parts)')
    expect(mailsTo(m, 'VENDOR').map((x) => x.subject)).toEqual([expect.stringMatching(/Quote not approved/)])
    expect(mailsTo(m, 'OEM').length).toBe(0)

    actAs(vend)
    await vendorPartsReceived(t, 'Parts arranged, engineer on site')
    m = await record('10. Vendor presses Parts received')
    expect(mailsTo(m, 'STORE').length).toBe(1)

    const t2 = await ticket(vend.id)
    actAs(vend)
    await vendorRequestPo({ requestId: t2, lines, quoteAttachmentIds: [await fsr(t2, vend)] })
    await record('(set-up) quote sent')
    const w1 = (await db().from('vendor_requests').select('id').eq('request_id', t2).eq('status', 'pending').single()).data.id as string
    actAs(fx.agentA)
    await rejectVendorPo({ vendorRequestId: w1, reason: 'Job is stopped', cancelTicket: true })
    m = await record('11. Krishan rejects the quote AND cancels the ticket')
    expect(mailsTo(m, 'OEM').length).toBe(1)
    expect(mailsTo(m, 'STORE').length).toBe(1)
    expect(mailsTo(m, 'VENDOR').map((x) => x.subject)).toEqual([expect.stringMatching(/Quote rejected and ticket cancelled/)])
    const text = (to: string) => table.find((r) => r.step.startsWith('11.') && r.to === to)?.text ?? ''
    expect(text('OEM (PO address)')).toContain('will not issue a purchase order'); expect(text('OEM (PO address)')).toContain('do not do any further work'); expect(text('OEM (PO address)')).toContain('Job is stopped')
    expect(text('VENDOR')).toContain('was rejected by'); expect(text('VENDOR')).toContain('do not do any further work')
    expect(text('STORE')).toContain('cost of the repair was not approved'); expect(text('STORE')).toContain('reopen the request within 48 hours')
    expect(text('STORE')).not.toMatch(/PO request/)
  })

  it('parts path and the smaller events', async () => {
    const t = await ticket(vend.id)
    actAs(vend)
    await vendorRequestParts({ requestId: t, lines: [{ item_name: 'Capacitor', qty: 2 }] })
    let m = await record('12. Vendor asks for parts (Part required, no PO)')
    expect(mailsTo(m, 'STORE').length).toBe(1); expect(mailsTo(m, 'KRISHAN').length).toBe(0)

    await vendorUpdateParts({ requestId: t, lines: [{ item_name: 'Capacitor', qty: 2 }, { item_name: 'Fan motor', qty: 1 }] })
    m = await record('13. Vendor changes the parts list')
    expect(m.map((x) => x.to)).toEqual(['STORE'])
    expect(m[0].subject).toMatch(/Parts list updated \(version 2\)/)
    expect(table.find((r) => r.step.startsWith('13.'))?.text).toContain('Fan motor')

    await vendorWithdrawRequest({ requestId: t, reason: 'Raised by mistake' })
    m = await record('14. Vendor withdraws the request')
    expect(mailsTo(m, 'STORE').length).toBe(1)

    await vendorAddComment(t, 'Engineer will visit tomorrow')
    m = await record('15. Vendor writes a message on the ticket')
    expect(mailsTo(m, 'STORE').length).toBe(1)

    actAs(fx.requesterA)
    await addComment(t, 'Thank you, please come in the morning', false)
    m = await record('16. The store writes a message on the ticket')
    expect(mailsTo(m, 'VENDOR').length).toBe(1)

    actAs(vend)
    await vendorRequestParts({ requestId: t, lines: [{ item_name: 'Gas R32', qty: 1 }] })
    await record('(set-up) parts asked again')
    actAs(fx.agentA)
    await updateRequestStatus(t, 'in_progress' as never, 'Citykart arranged the parts, taking it back')
    m = await record('17. A Citykart technician ends the hold himself')
    expect(mailsTo(m, 'STORE').length).toBe(1)
    expect(mailsTo(m, 'VENDOR').map((x) => x.subject)).toEqual([expect.stringMatching(/Hold ended by Citykart/)])
    expect(table.find((r) => r.step.startsWith('17.') && r.to === 'VENDOR')?.text).toContain('Citykart arranged the parts')
    expect(vendB.id).toBeTruthy()
  })
})

describe('PO approvers named for the AC in the sheet (CK PO Approver Mail To)', () => {
  it('one mail to every approver of that AC; the first decision wins and the other is told; a revised quote and a withdrawal reach all of them', async () => {
    const unit = { ...UNIT, id: UNIT2_ID, approver_emails: [fx.agentA.email, fx.agentB.email] }
    const t = await ticket(vend.id, 'in_progress', unit)
    actAs(vend)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, vend)] })
    let m = await record('19. Vendor sends a quote for an AC with two approvers in the sheet')
    const toApprovers = m.filter((x) => /PO approval needed/.test(x.subject))
    expect(toApprovers.length).toBe(1)   // ONE mail
    expect(toApprovers[0].to).toContain('KRISHAN'); expect(toApprovers[0].to).toContain('OTHER TECHNICIAN')
    const v1 = (await db().from('vendor_requests').select('id, approver_ids').eq('request_id', t).eq('status', 'pending').single()).data
    expect(v1.approver_ids).toEqual(expect.arrayContaining([fx.agentA.id, fx.agentB.id]))

    // the SECOND approver asks for a revised price; the new version goes to both again
    actAs(fx.agentB)
    expect((await requestPoRevision({ vendorRequestId: v1.id, note: 'Too high' })).error).toBeUndefined()
    await record('(set-up) revised price asked')
    actAs(vend)
    await vendorRevisePo({ requestId: t, lines: [{ item_name: 'Compressor', qty: 1, price_excl_gst: 9000 }], quoteAttachmentIds: [await fsr(t, vend)] })
    m = await record('20. Revised quote goes to both approvers again')
    const again = m.filter((x) => /Revised quote \(version 2\)/.test(x.subject))
    expect(again.length).toBe(1); expect(again[0].to).toContain('KRISHAN'); expect(again[0].to).toContain('OTHER TECHNICIAN')
    const v2 = (await db().from('vendor_requests').select('id').eq('request_id', t).eq('status', 'pending').single()).data.id as string

    // the first one to decide wins
    actAs(fx.agentA)
    const f = new FormData(); f.set('vendor_request_id', v2); f.set('po_number', 'PO-9'); f.set('po_date', '2026-10-02'); f.set('po_document', png('PO-9.png'))
    expect((await approveVendorPo(f)).error).toBeUndefined()
    await record('(set-up) approved by the first approver')
    actAs(fx.agentB)
    const late = await rejectVendorPo({ vendorRequestId: v2, reason: 'Too late' })
    expect(late.error).toMatch(/already been decided/)
    // an unrelated technician may not decide at all
    actAs(fx.manager)
    expect((await requestPoRevision({ vendorRequestId: v2, note: 'x' })).error).toBeTruthy()
  })

  it('an address in the sheet that is not an active staff login is skipped: the default approver is used; a withdrawal then reaches him', async () => {
    const unit = { ...UNIT, id: UNIT2_ID, approver_emails: ['nobody.here@citykartstores.com'] }
    const t = await ticket(vend.id, 'in_progress', unit)
    actAs(vend)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, vend)] })
    let m = await record('21. Quote for an AC whose sheet approver is not a CK Desk login')
    expect(mailsTo(m, 'KRISHAN').map((x) => x.subject)).toEqual([expect.stringMatching(/PO approval needed/)])
    expect(mailsTo(m, 'OTHER TECHNICIAN').length).toBe(0)
    await vendorWithdrawRequest({ requestId: t, reason: 'Not needed' })
    m = await record('22. Vendor withdraws it')
    expect(mailsTo(m, 'KRISHAN').map((x) => x.subject)).toEqual([expect.stringMatching(/Quote withdrawn by the vendor/)])
  })
})

describe('a quote the vendor withdraws', () => {
  it('Krishan is told (he was waiting to decide it); the store hears the ticket is back in progress', async () => {
    const t = await ticket(vend.id)
    actAs(vend)
    await vendorRequestPo({ requestId: t, lines, quoteAttachmentIds: [await fsr(t, vend)] })
    await record('(set-up) quote sent')
    await vendorWithdrawRequest({ requestId: t, reason: 'Customer solved it another way' })
    const m = await record('18. Vendor withdraws the quote Krishan was about to decide')
    expect(mailsTo(m, 'KRISHAN').map((x) => x.subject)).toEqual([expect.stringMatching(/Quote withdrawn by the vendor/)])
    expect(mailsTo(m, 'STORE').length).toBe(1)
  })
})
