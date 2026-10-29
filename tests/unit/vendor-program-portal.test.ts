import { describe, it, expect } from 'vitest'
import { programResolutionChoices } from '@/lib/vendor/fields'
import { pickReplyAttachments } from '@/lib/email/inbound-files'
import { programReadiness } from '@/lib/programs/readiness'
import { buildPoApprovalRequestMail, buildPoApprovedMail } from '@/lib/vendor/po-mail'
import { assetLabelOf } from '@/lib/vendor/asset'
import { findProgramOemBoxes } from '@/lib/vendor/fields'

describe('the resolution list of a program', () => {
  it('is the program\'s own list with Other at the end (once)', () => {
    expect(programResolutionChoices(['Cartridge replaced', 'Pump replaced']).map((c) => c.value)).toEqual(['Cartridge replaced', 'Pump replaced', 'Other'])
    expect(programResolutionChoices(['Other', 'X']).map((c) => c.value)).toEqual(['Other', 'X'])
    expect(programResolutionChoices([]).map((c) => c.value)).toEqual(['Other'])
  })
})

describe('the check list of a program that works in the portal', () => {
  const base = { categories: 1, hasSheet: true, lastStatus: 'ok' as const, lastError: null, activeRows: 5, rowsWithoutMail: 0, unknownStores: 0, unknownFields: [] }
  it('needs a resolution list; a mail-level program has no such item', () => {
    expect(programReadiness({ ...base, portal: { resolutions: 0 } }).ready).toBe(false)
    const ok = programReadiness({ ...base, portal: { resolutions: 3 } })
    expect(ok.ready).toBe(true)
    expect(ok.items.find((i) => i.key === 'resolutions')).toMatchObject({ ok: true, blocking: true })
    expect(programReadiness(base).items.some((i) => i.key === 'resolutions')).toBe(false)
  })
})

describe('the OEM ticket number boxes of a program ticket\'s form', () => {
  const sec = (labels: string[]) => [{ id: 's', title: 'x', order: 1, fields: labels.map((l, i) => ({ id: `f${i}`, type: 'text', label: l, required: false, order: i })) }] as never
  it('finds a box whose label ends with the usual words (any line\'s name in front), and nothing else', () => {
    const b = findProgramOemBoxes(sec(['Subject', 'RO OEM Ticket Number', 'Sensomatic OEM Ticket Creation Date']))
    expect(b.number?.id).toBe('f1')
    expect(b.date?.id).toBe('f2')
    expect(findProgramOemBoxes(sec(['OEM Ticket Number'])).number?.id).toBe('f0')
    expect(findProgramOemBoxes(sec(['Ticket number of the OEM', 'Number'])).number).toBeNull()
    expect(findProgramOemBoxes(null)).toEqual({ number: null, date: null })
  })
})

describe('the files of an e-mail reply', () => {
  const buf = (n = 10) => Buffer.alloc(n, 1)
  it('keeps real files, skips the pictures of the mail\'s own layout, types an octet-stream file by its extension and lists what is left out', () => {
    const r = pickReplyAttachments([
      { filename: 'fsr.pdf', contentType: 'application/octet-stream', content: buf() },
      { filename: 'logo.png', contentType: 'image/png', content: buf(), related: true },
      { filename: 'sig.png', contentType: 'image/png', content: buf(), contentDisposition: 'inline' },
      { filename: 'empty.txt', contentType: 'text/plain', content: Buffer.alloc(0) },
      { filename: 'big.zip', contentType: 'application/zip', content: buf(1), size: 26 * 1024 * 1024 },
      { contentType: 'image/jpeg', content: buf() },
    ])
    expect(r.keep.map((f) => [f.name, f.type])).toEqual([['fsr.pdf', 'application/pdf'], ['attachment-6', 'image/jpeg']])
    expect(r.dropped).toEqual(['empty.txt (empty)', 'big.zip (over 25 MB)'])
  })
  it('keeps at most ten files', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ filename: `f${i}.pdf`, contentType: 'application/pdf', content: buf() }))
    const r = pickReplyAttachments(many)
    expect(r.keep).toHaveLength(10)
    expect(r.dropped).toHaveLength(2)
    expect(pickReplyAttachments(null)).toEqual({ keep: [], dropped: [] })
  })
})

describe('the PO mails say AC for an AC and the program name for a program', () => {
  const base = { requestNo: 'CKSD-1', storeLabel: 'Store (S1)', acLabel: '1 - VOLTAS', vendorName: 'Voltas', lines: [{ item_name: 'Fan', qty: 1, price_excl_gst: 10 }] }
  it('an AC mail is unchanged', () => {
    const m = buildPoApprovalRequestMail({ ...base, link: 'https://x/y', approverName: 'A', anyOneCanDecide: true })
    expect(m.html).toContain('needs a purchase order to repair the AC on the ticket below.')
    expect(m.html).toContain('all the approvers of this AC.')
    expect(m.html).toContain('>AC<')
  })
  it('a program mail names the program and its machine', () => {
    const m = buildPoApprovalRequestMail({ ...base, assetKind: 'RO Purifier', acLabel: 'RO Purifier - M1', link: 'https://x/y', approverName: 'A', anyOneCanDecide: true })
    expect(m.html).toContain('repair the RO Purifier on the ticket below.')
    expect(m.html).toContain('all the approvers of this RO Purifier.')
    expect(m.html).not.toContain('>AC<')
    expect(buildPoApprovedMail({ ...base, assetKind: 'RO Purifier', poNumber: 'P1', poDate: '2026-10-01', hasDocument: false }).html).toContain('RO Purifier')
    expect(assetLabelOf('RO Purifier', { machine_no: 'M1', serial: 'S9', emails: [], po_emails: [], approver_emails: [] })).toBe('RO Purifier - M1 / S9')
    expect(assetLabelOf('RO Purifier', null)).toBe('RO Purifier')
  })
})

describe('the Business Rule conditions for vendor programs and vendor technicians', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = (o: Record<string, unknown>) => o as any
  const cond = (field: string, value: string) => [{ field, operator: 'equals', value }] as never
  it('match on the program, the vendor company, the store and "with a vendor"', async () => {
    const { matchesConditions } = await import('@/lib/rules/evaluate')
    const r = req({ vendor_line: 'prog-1', vendor_company_id: 'co-1', is_with_vendor: true, requester_store_id: 'st-1' })
    expect(matchesConditions(r, cond('vendor_line', 'prog-1'))).toBe(true)
    expect(matchesConditions(r, cond('vendor_line', 'ac'))).toBe(false)
    expect(matchesConditions(r, cond('vendor_company_id', 'co-1'))).toBe(true)
    expect(matchesConditions(r, cond('requester_store_id', 'st-2'))).toBe(false)
    expect(matchesConditions(r, cond('is_with_vendor', 'true'))).toBe(true)
    expect(matchesConditions(req({ vendor_line: '', is_with_vendor: false }), cond('is_with_vendor', 'true'))).toBe(false)
    expect(matchesConditions(req({ vendor_line: 'ac' }), cond('vendor_line', 'ac'))).toBe(true)
  })
})
