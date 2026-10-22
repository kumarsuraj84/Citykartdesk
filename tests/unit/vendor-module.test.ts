// The pure rules of the vendor module: who is a vendor, the dashboard boxes, the Start / Resolve rules, the item lines, the PO rules and wording,
// the AC sheet's "Email for PO detail" column, and the PO register's search.
import { describe, it, expect } from 'vitest'
import { isVendor, vendorBoxOf, vendorLandingFor, vendorMayOpen, vendorRoleOf, VENDOR_BOX_ORDER } from '@/lib/vendor/access'
import { buildResolutionText, checkVendorResolve, checkVendorStart, findVendorFields, resolutionChoices, todayIstDate } from '@/lib/vendor/fields'
import { checkLines, linesAsText, totalOf } from '@/lib/vendor/lines'
import { checkPoApproval, checkPoRejection } from '@/lib/vendor/po-rules'
import { buildPoApprovalRequestMail, buildPoApprovedMail, buildPoRejectedMail } from '@/lib/vendor/po-mail'
import { filterPoRows, type PoRegisterRow } from '@/lib/vendor/register'
import { parseAcSheet } from '@/lib/masters/parse'
import type { FormSection } from '@/types'

describe('who is a vendor', () => {
  it('needs a company and a kind, and is never an agent, manager or administrator', () => {
    expect(vendorRoleOf({ role: 'user', vendor_company_id: 'c', vendor_role: 'technician' })).toBe('technician')
    expect(vendorRoleOf({ role: 'user', vendor_company_id: 'c', vendor_role: 'manager' })).toBe('manager')
    expect(vendorRoleOf({ role: 'user', vendor_company_id: null, vendor_role: 'technician' })).toBeNull()
    expect(vendorRoleOf({ role: 'user', vendor_company_id: 'c', vendor_role: 'boss' })).toBeNull()
    expect(vendorRoleOf({ role: 'admin', vendor_company_id: 'c', vendor_role: 'technician' })).toBeNull()
    expect(isVendor(null)).toBe(false)
  })
  it('a vendor may open only his own pages; a ticket link lands on his ticket page', () => {
    for (const p of ['/vendor', '/vendor/tickets/x', '/vendor/pos', '/profile', '/notifications']) expect(vendorMayOpen(p), p).toBe(true)
    for (const p of ['/home', '/requests', '/admin/users', '/vendor-po/1', '/purchase-orders', '/vendorx']) expect(vendorMayOpen(p), p).toBe(false)
    expect(vendorLandingFor('/requests/0b0e0f2a-1111-4222-8333-444455556666')).toBe('/vendor/tickets/0b0e0f2a-1111-4222-8333-444455556666')
    expect(vendorLandingFor('/home')).toBe('/vendor')
  })
})

describe('the six boxes (no status was added)', () => {
  it('groups the existing statuses; a hold is "PO required" or "Part required" by what was asked', () => {
    expect(vendorBoxOf('open')).toBe('open'); expect(vendorBoxOf('assigned')).toBe('open')
    expect(vendorBoxOf('in_progress')).toBe('in_process')
    expect(vendorBoxOf('hold_purchase_ho', 'po')).toBe('po_required')
    expect(vendorBoxOf('hold_purchase_ho', 'parts')).toBe('part_required')
    expect(vendorBoxOf('hold_purchase_ho', null)).toBe('in_process')
    expect(vendorBoxOf('resolved')).toBe('resolved'); expect(vendorBoxOf('closed')).toBe('resolved')
    expect(vendorBoxOf('cancelled')).toBe('cancelled')
    expect(VENDOR_BOX_ORDER).toHaveLength(6)
  })
})

describe('start and resolve rules', () => {
  const sections = [{ id: 's', title: 'x', order: 1, fields: [
    { id: 'a', type: 'text', label: 'AC OEM Ticket Number', required: true, order: 1 },
    { id: 'b', type: 'date', label: ' ac oem ticket creation date ', required: true, order: 2 },
    { id: 'c', type: 'select', label: 'AC Resolution', required: true, order: 3, options: [{ value: 'v1', label: 'GAS FILLED' }] },
  ] }] as unknown as FormSection[]
  it('finds the three boxes by label, whatever the case or spacing', () => {
    const f = findVendorFields(sections)
    expect([f.oemNumber?.id, f.oemDate?.id, f.resolution?.id]).toEqual(['a', 'b', 'c'])
    expect(findVendorFields([]).oemNumber).toBeNull()
  })
  it('always offers Other, once', () => {
    const c = resolutionChoices(findVendorFields(sections).resolution)
    expect(c.map((x) => x.label)).toEqual(['GAS FILLED', 'Other'])
    expect(resolutionChoices({ options: [{ value: 'o', label: 'other' }] } as never).filter((x) => /other/i.test(x.label))).toHaveLength(1)
  })
  it('start needs the OEM ticket number', () => {
    expect(checkVendorStart('  ').ok).toBe(false)
    expect(checkVendorStart('x'.repeat(61)).ok).toBe(false)
    expect(checkVendorStart('<b>').ok).toBe(false)
    expect(checkVendorStart(' VT-1 ')).toEqual({ ok: true, oemNumber: 'VT-1' })
  })
  it('resolve needs a choice, remarks for Other, and at least one FSR', () => {
    expect(checkVendorResolve({ choice: '', remarks: '', fsrCount: 1 }).ok).toBe(false)
    expect(checkVendorResolve({ choice: 'GAS FILLED', remarks: '', fsrCount: 0 }).ok).toBe(false)
    expect(checkVendorResolve({ choice: 'Other', remarks: 'too short', fsrCount: 1 }).ok).toBe(false)
    expect(checkVendorResolve({ choice: 'Other', remarks: 'Replaced the harness', fsrCount: 1 }).ok).toBe(true)
    expect(checkVendorResolve({ choice: 'GAS FILLED', remarks: '', fsrCount: 1 }).ok).toBe(true)
  })
  it('the resolution text is the choice, or the vendor\'s own words for Other', () => {
    expect(buildResolutionText('GAS FILLED', '')).toBe('Resolution: GAS FILLED')
    expect(buildResolutionText('GAS FILLED', 'pressure 120')).toBe('Resolution: GAS FILLED. pressure 120')
    expect(buildResolutionText('Other', ' replaced the harness ')).toBe('replaced the harness')
  })
  it('today is the Indian date', () => {
    expect(todayIstDate(new Date('2026-10-21T20:00:00Z'))).toBe('2026-10-22')
    expect(todayIstDate(new Date('2026-10-21T10:00:00Z'))).toBe('2026-10-21')
  })
})

describe('item lines', () => {
  it('parts need a name and a quantity above 0; a PO also needs a price on every line; empty rows are ignored', () => {
    expect(checkLines([], { withPrice: false }).ok).toBe(false)
    expect(checkLines([{ item_name: '', qty: 1 }, { item_name: '', qty: '' }], { withPrice: false }).ok).toBe(false)
    expect(checkLines([{ item_name: 'Fan', qty: 0 }], { withPrice: false }).ok).toBe(false)
    expect(checkLines([{ item_name: 'Fan', qty: 'x' }], { withPrice: false }).ok).toBe(false)
    expect(checkLines([{ item_name: 'Fan motor', qty: 2 }, { item_name: '', qty: '' }], { withPrice: false })).toMatchObject({ ok: true, total: null })
    expect(checkLines([{ item_name: 'Fan', qty: 1 }], { withPrice: true }).ok).toBe(false)               // no price
    expect(checkLines([{ item_name: 'Fan', qty: 1, price_excl_gst: '' }], { withPrice: true }).ok).toBe(false)
    expect(checkLines([{ item_name: 'Fan', qty: 1, price_excl_gst: -5 }], { withPrice: true }).ok).toBe(false)
    expect(checkLines(Array.from({ length: 31 }, () => ({ item_name: 'Fan', qty: 1 })), { withPrice: false }).ok).toBe(false)
  })
  it('the total is price x quantity, without GST', () => {
    const r = checkLines([{ item_name: 'Compressor', qty: '1', price_excl_gst: '12,500' }, { item_name: 'Capacitor', qty: 2, price_excl_gst: '450.50' }], { withPrice: true })
    expect(r).toMatchObject({ ok: true, total: 13401 })
    expect(totalOf([{ qty: 3, price_excl_gst: 10.1 }])).toBe(30.3)
    if (r.ok) expect(linesAsText(r.lines)).toContain('1. Compressor - qty 1, price 12,500.00 (without GST)')
  })
})

describe('deciding a PO', () => {
  const now = new Date('2026-10-22T08:00:00Z')
  it('approving needs the number, a real date that is not in the future, and the document', () => {
    expect(checkPoApproval({ poNumber: '', poDate: '2026-10-01', hasFile: true }, now).ok).toBe(false)
    expect(checkPoApproval({ poNumber: 'P1', poDate: '', hasFile: true }, now).ok).toBe(false)
    expect(checkPoApproval({ poNumber: 'P1', poDate: '2026-02-30', hasFile: true }, now).ok).toBe(false)
    expect(checkPoApproval({ poNumber: 'P1', poDate: '2026-10-23', hasFile: true }, now).ok).toBe(false)
    expect(checkPoApproval({ poNumber: 'P1', poDate: '2019-12-31', hasFile: true }, now).ok).toBe(false)
    expect(checkPoApproval({ poNumber: 'P1', poDate: '2026-10-01', hasFile: false }, now).ok).toBe(false)
    expect(checkPoApproval({ poNumber: ' PO-9 ', poDate: '2026-10-22', hasFile: true }, now)).toEqual({ ok: true, poNumber: 'PO-9', poDate: '2026-10-22' })
  })
  it('rejecting needs a reason', () => {
    expect(checkPoRejection('no').ok).toBe(false)
    expect(checkPoRejection('  Price too high  ')).toEqual({ ok: true, reason: 'Price too high' })
  })
})

describe('the PO e-mails', () => {
  const base = { requestNo: 'CKSD-1', storeLabel: 'ALC <Allahabad>', acLabel: '1 - VOLTAS 1.5', vendorName: 'Voltas', lines: [{ item_name: 'Compressor <b>', qty: 1, price_excl_gst: 100 }] }
  it('approved: number, date, items, total and the document note; user text is escaped', () => {
    const m = buildPoApprovedMail({ ...base, poNumber: 'PO-9', poDate: '2026-10-22', hasDocument: true })
    expect(m.subject).toBe('PO PO-9 approved - CKSD-1 - ALC <Allahabad>')
    expect(m.html).toContain('PO-9'); expect(m.html).toContain('The PO document is attached.')
    expect(m.html).not.toContain('<b>'); expect(m.html).toContain('&lt;b&gt;')
    expect(m.text).toContain('Total (without GST): 100.00')
  })
  it('rejected: a short note with the reason; the approval request carries the link', () => {
    expect(buildPoRejectedMail({ ...base, reason: 'Too costly' }).text).toContain('Reason: Too costly')
    expect(buildPoRejectedMail({ ...base, reason: 'x' }).subject).toMatch(/rejected/)
    const m = buildPoApprovalRequestMail({ ...base, link: 'https://desk.test/vendor-po/1', approverName: 'Krishan' })
    expect(m.text).toContain('https://desk.test/vendor-po/1'); expect(m.text).toContain('Dear Krishan')
  })
})

describe('the AC sheet column "Email for PO detail"', () => {
  const head = ['Store Code', 'AC CKDESK SERIAL NO', 'Status', 'Mail ID', 'Email for PO detail']
  it('is read per AC; bad addresses are skipped with a note; an empty cell is fine', () => {
    const r = parseAcSheet([head, ['ALC', 1, 'Active', 'oem@oem.test', 'po@oem.test, bad-address;second@oem.test'], ['ALC', 2, 'Active', 'oem@oem.test', '']])
    expect(r.rows[0].poEmails).toEqual(['po@oem.test', 'second@oem.test'])
    expect(r.rows[1].poEmails).toEqual([])
    expect(r.issues.some((i) => i.code === 'bad_po_email')).toBe(true)
  })
  it('a sheet without the column still works', () => {
    const r = parseAcSheet([head.slice(0, 4), ['ALC', 1, 'Active', 'oem@oem.test']])
    expect(r.rows[0].poEmails).toEqual([])
  })
})

describe('the PO register search', () => {
  const row = (o: Partial<PoRegisterRow>): PoRegisterRow => ({ id: 'i', po_number: 'PO-1', po_date: '2026-10-10', status: 'approved', request_id: 'r', request_no: 'CKSD-1', store_code: 'ALC', store_name: 'Allahabad', vendor_name: 'Voltas', technician: 'Ramesh', items: 'Compressor x 1', total: 100, requested_at: '2026-10-09T10:00:00Z', decided_at: null, decision_reason: null, ...o })
  const rows = [row({}), row({ id: 'j', po_number: 'PO-2', po_date: '2026-09-01', status: 'rejected', store_code: 'MAR', store_name: 'Margao', items: 'Fan x 2' }), row({ id: 'k', po_number: null, po_date: null, status: 'pending', requested_at: '2026-10-20T10:00:00Z' })]
  it('searches text, status and dates (a request without a PO date uses the request date)', () => {
    expect(filterPoRows(rows, { q: 'margao' }).map((r) => r.id)).toEqual(['j'])
    expect(filterPoRows(rows, { status: 'pending' }).map((r) => r.id)).toEqual(['k'])
    expect(filterPoRows(rows, { from: '2026-10-01' }).map((r) => r.id)).toEqual(['i', 'k'])
    expect(filterPoRows(rows, { to: '2026-09-30' }).map((r) => r.id)).toEqual(['j'])
    expect(filterPoRows(rows, { status: 'all' })).toHaveLength(3)
  })
})
