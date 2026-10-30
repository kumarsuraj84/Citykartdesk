import { describe, it, expect } from 'vitest'
import { checkLines, lineTotal, linePaise, linesAsText, totalOf } from '@/lib/vendor/lines'
import { chooseAssetRow, sameVendor } from '@/lib/vendor/asset'
import { buildPoRejectedMail } from '@/lib/vendor/po-mail'

// H-23 / D-25 / F-40: money in whole paise, line by line; only plain decimals. C-11: which saved row the PO side uses. C-28: a program name is escaped in the mail.

describe('money is worked out in whole paise, a line at a time', () => {
  it('fractional quantities: what is shown on each line adds up to the total that is shown', () => {
    const r = checkLines([
      { item_name: 'Wire', qty: '2.5', price_excl_gst: '10.01' },     // 25.025 -> 25.03
      { item_name: 'Tape', qty: '0.333', price_excl_gst: '3' },        // 0.999 -> 1.00
      { item_name: 'Bolt', qty: 3, price_excl_gst: 1.005 },            // the price 1.005 is read as 1.01 (the way a person rounds it), so 3 x 1.01
    ], { withPrice: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lines.map((l) => l.price_excl_gst)).toEqual([10.01, 3, 1.01])
    expect(r.lines.map(lineTotal)).toEqual([25.03, 1, 3.03])
    expect(r.total).toBe(29.06)
    expect(r.lines.map(lineTotal).reduce((a, b) => Math.round((a + b) * 100) / 100, 0)).toBe(r.total)   // the shown lines add up to the shown total
  })
  it('1.005 as typed text or as a number becomes 1.01 (no binary noise)', () => {
    for (const v of ['1.005', 1.005, '1,005.00']) {
      const r = checkLines([{ item_name: 'Part', qty: 1, price_excl_gst: v }], { withPrice: true })
      expect(r.ok).toBe(true)
      if (r.ok && v !== '1,005.00') expect(r.lines[0].price_excl_gst).toBe(1.01)
      if (r.ok && v === '1,005.00') expect(r.lines[0].price_excl_gst).toBe(1005)
    }
  })
  it('many small lines never drift by a paisa', () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ item_name: `Item ${i}`, qty: 1, price_excl_gst: '0.10' }))
    const r = checkLines(lines, { withPrice: true })
    expect(r.ok && r.total).toBe(3)
    expect(totalOf([{ qty: 3, price_excl_gst: 0.1 }, { qty: 3, price_excl_gst: 0.1 }, { qty: 3, price_excl_gst: 0.1 }])).toBe(0.9)
  })
  it('only plain decimals are accepted: no 1e3, no 0x10, no sign, no words', () => {
    for (const bad of ['1e3', '0x10', '-5', '+5', 'Infinity', 'NaN', '5 ', ' ', '1.2.3', '١٢٣']) {
      expect(checkLines([{ item_name: 'Part', qty: 1, price_excl_gst: bad }], { withPrice: true }).ok, `price ${JSON.stringify(bad)}`).toBe(bad === '5 ')
      expect(checkLines([{ item_name: 'Part', qty: bad }], { withPrice: false }).ok, `qty ${JSON.stringify(bad)}`).toBe(bad === '5 ')
    }
    expect(checkLines([{ item_name: 'Part', qty: '.5' }], { withPrice: false })).toMatchObject({ ok: true })
    expect(checkLines([{ item_name: 'Part', qty: 1, price_excl_gst: Number.NaN }], { withPrice: true }).ok).toBe(false)
  })
  it('limits still hold and huge numbers cannot overflow the arithmetic', () => {
    expect(checkLines([{ item_name: 'Part', qty: 1_000_001 }], { withPrice: false }).ok).toBe(false)
    expect(checkLines([{ item_name: 'Part', qty: 1, price_excl_gst: '1000000001' }], { withPrice: true }).ok).toBe(false)
    expect(checkLines([{ item_name: 'Part', qty: '1000000', price_excl_gst: '1000000000' }], { withPrice: true })).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) })
    expect(linePaise({ qty: 1e6, price_excl_gst: 1e9 })).toBe(Number.POSITIVE_INFINITY)
  })
  it('the text for the conversation shows the same line totals', () => {
    const text = linesAsText([{ item_name: 'Wire', qty: 2.5, price_excl_gst: 10.01 }])
    expect(text).toContain('line total 25.03')
  })
})

describe('which saved row the PO mail and the approvers come from (C-11)', () => {
  const rows = [
    { id: 'a', vendor: 'Aqua Care', emails: ['t@aqua.test'], po_emails: ['po@aqua.test'], approver_emails: ['boss1@citykartstores.com'] },
    { id: 'b', vendor: 'Pure Flow Pvt Ltd', emails: ['t@pure.test'], po_emails: ['po@pure.test'], approver_emails: ['boss2@citykartstores.com'] },
  ]
  it('the row of the assigned technician\'s company', () => {
    expect(chooseAssetRow(rows, 'Pure Flow')?.id).toBe('b')
    expect(chooseAssetRow(rows, 'AQUA CARE')?.po_emails).toEqual(['po@aqua.test'])
  })
  it('one row: that row. Several rows and no company: the union of every row (the ticket mail went to all of them)', () => {
    expect(chooseAssetRow([rows[0]], null)?.id).toBe('a')
    const union = chooseAssetRow(rows, null)!
    expect(union.id).toBeUndefined()
    expect(union.po_emails).toEqual(['po@aqua.test', 'po@pure.test'])
    expect(union.approver_emails).toEqual(['boss1@citykartstores.com', 'boss2@citykartstores.com'])
  })
  it('a company that matches no row also gets the union, never a wrong company\'s row', () => {
    expect(chooseAssetRow(rows, 'Someone Else')?.po_emails).toEqual(['po@aqua.test', 'po@pure.test'])
    expect(chooseAssetRow([], 'x')).toBeNull()
  })
  it('vendor names are compared without spaces, punctuation and case', () => {
    expect(sameVendor('Aqua-Care', 'aqua care')).toBe(true)
    expect(sameVendor('Aqua Care', 'Aqua Care Pvt Ltd')).toBe(true)
    expect(sameVendor('AC', 'Pure Flow')).toBe(false)
    expect(sameVendor('', 'Pure Flow')).toBe(false)
  })
})

describe('the program name in the PO mails is escaped (C-28)', () => {
  it('an admin-typed program name cannot inject markup into the HTML of the mail', () => {
    const m = buildPoRejectedMail({ requestNo: 'CKSD-1', storeLabel: 'Store (S1)', acLabel: 'M1', assetKind: '<img src=x onerror=alert(1)>', vendorName: 'V', lines: [], reason: 'No' })
    expect(m.html).not.toContain('<img')
    expect(m.html).toContain('&lt;img')
  })
})
