// The parts / quote lines a vendor sends are written into the conversation as text (see linesAsText in lines.ts):
//   1. Membrane - qty 2
//   2. Pump - qty 1, price 900.00 (without GST), line total 900.00
// This file reads such a message back so the screens can show the lines as a TABLE (item, quantity, and price and line total when the vendor gave prices) with the words
// before and after it as ordinary text. Pure; it also reads the messages written before this was built, because the text format is the same.

export type LinesCommentRow = { no: number; item: string; qty: string; price: string | null; total: string | null }
export type LinesCommentView = {
  /** the words before the lines (who sent them, what for) */
  before: string
  rows: LinesCommentRow[]
  /** true when every line has a price (a quote / PO); false for a plain parts list */
  hasPrice: boolean
  /** the words after the lines (the total, "the quote file is attached ...") */
  after: string
  /** "Total (without GST): 1,234.00" when the message has it, shown under the table */
  total: string | null
}

const LINE = /^(\d{1,3})\. (.+) - qty (\S+?)(?:, price (\S+) \(without GST\), line total (\S+))?$/
const TOTAL = /^Total \(without GST\): (\S+)$/

export function parseLinesComment(body: string | null | undefined): LinesCommentView | null {
  const text = (body ?? '').replace(/\r\n/g, '\n')
  if (!text.includes(' - qty ')) return null
  const all = text.split('\n')
  let start = -1
  let end = -1
  const rows: LinesCommentRow[] = []
  for (let i = 0; i < all.length; i++) {
    const m = LINE.exec(all[i].trim())
    const expected = rows.length + 1
    if (m && Number(m[1]) === expected && (start === -1 || i === end + 1)) {
      if (start === -1) start = i
      end = i
      rows.push({ no: expected, item: m[2], qty: m[3], price: m[4] ?? null, total: m[5] ?? null })
    } else if (start !== -1) break
  }
  if (rows.length === 0) return null
  const rest = [...all.slice(end + 1)]
  let total: string | null = null
  const kept: string[] = []
  for (const l of rest) {
    const t = TOTAL.exec(l.trim())
    if (t && total === null) total = t[1]
    else kept.push(l)
  }
  return {
    before: all.slice(0, start).join('\n').trim(),
    rows,
    hasPrice: rows.every((r) => r.price !== null),
    after: kept.join('\n').trim(),
    total,
  }
}
