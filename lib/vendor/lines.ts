// The item lines a vendor lists when he asks for parts (item, quantity) or for a PO (item, quantity, price WITHOUT GST).
// Pure functions: the window and the server use the same rules.
//
// Money is worked out in whole paise (1/100 of a rupee), a line at a time, and the total is the sum of the line totals. Adding floating-point numbers and rounding once at the end
// made the shown line totals differ from the shown total by 0.01 (1.005 x 3, three lines of 0.333 ...). Now what is shown on every line adds up to the total that is shown.

export type RequestLineInput = { item_name: string; qty: number | string; price_excl_gst?: number | string | null }
export type RequestLine = { item_name: string; qty: number; price_excl_gst: number | null }

export const MAX_LINES = 30
const MAX_QTY = 1_000_000
const MAX_PRICE = 1_000_000_000
/** The most a PO total can be (without GST); far above any real PO, it only keeps the arithmetic exact. */
const MAX_TOTAL = 1_000_000_000_000

type Result = { ok: true; lines: RequestLine[]; total: number | null } | { ok: false; error: string }

/** A plain decimal as text ("12500", "450.50", ".5"), or null. Only digits and one dot: no "1e3", no "0x10", no sign, no "Infinity". A thousands comma is removed first. */
function plainDecimal(v: number | string | null | undefined): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || v > 1e15) return null
    // 1.005 is stored as 1.00499999999999989...: the 15 digits a person can mean are kept, the binary noise is not
    return String(Number(v.toPrecision(15)).toFixed(6)).replace(/0+$/, '').replace(/\.$/, '')
  }
  const t = String(v ?? '').trim().replace(/,/g, '')
  return /^(\d+(\.\d*)?|\.\d+)$/.test(t) ? t : null
}

/**
 * The value of a plain decimal in units of 10^-decimals, rounded half up on the next digit (1.005 to 2 places is 1.01, the way a person rounds it). Infinity when it is too big to
 * be exact (more than 12 whole digits): the limits below reject it.
 */
function scaled(plain: string, decimals: number): number {
  const [whole, frac = ''] = plain.split('.')
  if (whole.replace(/^0+/, '').length > 12) return Number.POSITIVE_INFINITY
  const digits = (frac + '0'.repeat(decimals + 1)).slice(0, decimals + 1)
  const base = Number((whole || '0') + digits.slice(0, decimals))
  return digits[decimals] >= '5' ? base + 1 : base
}

/** Checks and cleans the lines. A PO needs a price on every line; parts need none. Empty rows at the end are ignored. */
export function checkLines(input: RequestLineInput[], opts: { withPrice: boolean }): Result {
  const rows = (input ?? []).filter((r) => (r.item_name ?? '').trim() !== '' || String(r.qty ?? '').trim() !== '' || String(r.price_excl_gst ?? '').trim() !== '')
  if (rows.length === 0) return { ok: false, error: 'Please add at least one item.' }
  if (rows.length > MAX_LINES) return { ok: false, error: `At most ${MAX_LINES} items can be listed.` }
  const lines: RequestLine[] = []
  for (let i = 0; i < rows.length; i++) {
    const n = i + 1
    const name = (rows[i].item_name ?? '').replace(/\s+/g, ' ').trim()
    if (name.length < 2) return { ok: false, error: `Item ${n}: please enter the item name.` }
    if (name.length > 200) return { ok: false, error: `Item ${n}: the item name is too long.` }
    const qtyText = plainDecimal(rows[i].qty)
    const qtyMilli = qtyText === null ? null : scaled(qtyText, 3)
    if (qtyMilli === null || qtyMilli <= 0) return { ok: false, error: `Item ${n}: the quantity must be more than 0.` }
    if (qtyMilli > MAX_QTY * 1000) return { ok: false, error: `Item ${n}: the quantity is too large.` }
    let price: number | null = null
    if (opts.withPrice) {
      const priceText = plainDecimal(rows[i].price_excl_gst)
      if (priceText === null) return { ok: false, error: `Item ${n}: please enter the price (without GST).` }
      const paise = scaled(priceText, 2)
      if (paise > MAX_PRICE * 100) return { ok: false, error: `Item ${n}: the price is too large.` }
      price = paise / 100
    }
    lines.push({ item_name: name, qty: qtyMilli / 1000, price_excl_gst: price })
  }
  if (opts.withPrice && paiseTotal(lines) > MAX_TOTAL * 100) return { ok: false, error: 'The total is too large.' }
  return { ok: true, lines, total: opts.withPrice ? totalOf(lines) : null }
}

/**
 * One line's total in whole paise: price x quantity, rounded half up to the paisa. A line without a price is 0. Worked out in two exact steps (whole quantity, then the
 * thousandths) so no step goes beyond what a number holds exactly; a line above the limit counts as Infinity (checkLines refuses it).
 */
export function linePaise(l: { qty: number; price_excl_gst: number | null }): number {
  const price = plainDecimal(l.price_excl_gst ?? 0)
  const qty = plainDecimal(l.qty)
  if (price === null || qty === null) return 0
  const paise = scaled(price, 2)
  const milli = scaled(qty, 3)
  if (!Number.isFinite(paise) || !Number.isFinite(milli) || (paise * milli) / 1000 > MAX_TOTAL * 100) return Number.POSITIVE_INFINITY
  const whole = Math.floor(milli / 1000)
  const rest = milli % 1000
  return paise * whole + Math.floor((paise * rest + 500) / 1000)
}

const paiseTotal = (lines: { qty: number; price_excl_gst: number | null }[]): number => lines.reduce((sum, l) => sum + linePaise(l), 0)

/** The total of one line in rupees (the same figure that goes into the total). */
export function lineTotal(l: { qty: number; price_excl_gst: number | null }): number {
  return linePaise(l) / 100
}

/** The total of a PO without GST: the sum of the line totals, each worked out in whole paise. */
export function totalOf(lines: { qty: number; price_excl_gst: number | null }[]): number {
  return paiseTotal(lines) / 100
}

export const formatMoney = (n: number): string => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The lines as text for the conversation. */
export function linesAsText(lines: RequestLine[]): string {
  return lines.map((l, i) => `${i + 1}. ${l.item_name} - qty ${l.qty}${l.price_excl_gst !== null ? `, price ${formatMoney(l.price_excl_gst)} (without GST), line total ${formatMoney(lineTotal(l))}` : ''}`).join('\n')
}
