// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { formatMoney, linesAsText, totalOf } from '@/lib/vendor/lines'
import { parseLinesComment } from '@/lib/vendor/lines-comment'
import { LinesComment } from '@/components/requests/LinesComment'

afterEach(() => cleanup())

const priced = [{ item_name: 'Membrane - 75 GPD', qty: 2, price_excl_gst: 1250.5 }, { item_name: 'Pump', qty: 1, price_excl_gst: 900 }]
const unpriced = [{ item_name: 'Membrane', qty: 2, price_excl_gst: null }, { item_name: 'Pump motor', qty: 1, price_excl_gst: null }]

// the messages exactly as lib/actions/vendor-requests.ts and vendor-po.ts write them
const poRequired = `PO required from Citykart (quote version 1). Ravi (vendor) needs a purchase order for:\n${linesAsText(priced)}\nTotal (without GST): ${formatMoney(totalOf(priced))}\nThe quote file is attached to this message.`
const partsRequired = `Part required (no PO). Ravi (vendor) needs these parts:\n${linesAsText(unpriced)}`

describe('reading a vendor\'s parts / quote message back', () => {
  it('a quote: the words before and after, the lines with price and line total, and the total', () => {
    const v = parseLinesComment(poRequired)!
    expect(v.before).toBe('PO required from Citykart (quote version 1). Ravi (vendor) needs a purchase order for:')
    expect(v.hasPrice).toBe(true)
    expect(v.rows).toEqual([
      { no: 1, item: 'Membrane - 75 GPD', qty: '2', price: '1,250.50', total: '2,501.00' },     // an item name with a dash in it is kept whole
      { no: 2, item: 'Pump', qty: '1', price: '900.00', total: '900.00' },
    ])
    expect(v.total).toBe('3,401.00')
    expect(v.after).toBe('The quote file is attached to this message.')
  })

  it('a parts list without prices: item and quantity only', () => {
    const v = parseLinesComment(partsRequired)!
    expect(v.hasPrice).toBe(false)
    expect(v.rows.map((r) => [r.item, r.qty, r.price])).toEqual([['Membrane', '2', null], ['Pump motor', '1', null]])
    expect(v.total).toBeNull()
    expect(v.after).toBe('')
  })

  it('every other message the vendor flow writes with lines (revised quote, PO approved, quote not approved, parts updated)', () => {
    const revised = `Revised quote (version 2) sent by Ravi. Total was 4,000.00, now 3,401.00.\n${linesAsText(priced)}\nThe revised quote file is attached to this message.`
    const approved = `PO approved by Asha on quote version 2. PO number: P-9. PO date: 2026-10-30.\n${linesAsText(priced)}\nTotal (without GST): ${formatMoney(totalOf(priced))}\nThe PO document is attached to this message.`
    const notApproved = `Quote (version 1) not approved by Asha. Reason: too costly\nThe ticket is not cancelled. The vendor will arrange the parts himself (no PO). Parts needed:\n${linesAsText(unpriced)}`
    const updated = `Parts list updated (version 2) by Ravi:\n${linesAsText(unpriced)}`
    for (const m of [revised, approved]) expect(parseLinesComment(m)!.hasPrice).toBe(true)
    for (const m of [notApproved, updated]) { const v = parseLinesComment(m)!; expect(v.hasPrice).toBe(false); expect(v.rows).toHaveLength(2) }
    expect(parseLinesComment(approved)!.before).toContain('PO number: P-9')
  })

  it('an ordinary message, an empty one, or a numbered list that is not item lines stays plain text', () => {
    expect(parseLinesComment('The technician will come tomorrow.')).toBeNull()
    expect(parseLinesComment('')).toBeNull()
    expect(parseLinesComment(null)).toBeNull()
    expect(parseLinesComment('1. Open the door\n2. Press the button')).toBeNull()
    expect(parseLinesComment('1. Item - qty abc')).not.toBeNull()   // the shape is what counts; a real list always comes from the vendor form
  })
})

describe('the table in the conversation', () => {
  it('a quote shows Item, Qty, Price (without GST) and Line total with the total at the bottom', () => {
    render(<LinesComment view={parseLinesComment(poRequired)!} />)
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Price (without GST)' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Line total' })).toBeTruthy()
    expect(screen.getByText('Membrane - 75 GPD')).toBeTruthy()
    expect(screen.getByText('2,501.00')).toBeTruthy()
    expect(screen.getByText('Total (without GST)')).toBeTruthy()
    expect(screen.getByText('3,401.00')).toBeTruthy()
    expect(screen.getByText('The quote file is attached to this message.')).toBeTruthy()
  })

  it('a parts list without prices has no price columns', () => {
    render(<LinesComment view={parseLinesComment(partsRequired)!} />)
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Price (without GST)' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Line total' })).toBeNull()
    expect(screen.getByText('Pump motor')).toBeTruthy()
  })

  it('item text is shown as text, never as markup', () => {
    const v = parseLinesComment('Parts:\n1. <img src=x onerror=alert(1)> - qty 1')!
    const { container } = render(<LinesComment view={v} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
