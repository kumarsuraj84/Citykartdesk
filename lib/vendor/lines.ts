// The item lines a vendor lists when he asks for parts (item, quantity) or for a PO (item, quantity, price WITHOUT GST).
// Pure functions: the window and the server use the same rules.

export type RequestLineInput = { item_name: string; qty: number | string; price_excl_gst?: number | string | null }
export type RequestLine = { item_name: string; qty: number; price_excl_gst: number | null }

export const MAX_LINES = 30
const MAX_QTY = 1_000_000
const MAX_PRICE = 1_000_000_000

type Result = { ok: true; lines: RequestLine[]; total: number | null } | { ok: false; error: string }

const toNumber = (v: number | string | null | undefined): number => {
  if (typeof v === 'number') return v
  const t = String(v ?? '').trim().replace(/,/g, '')
  return t === '' ? Number.NaN : Number(t)   // an empty box is "nothing entered", not 0
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
    const qty = toNumber(rows[i].qty)
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: `Item ${n}: the quantity must be more than 0.` }
    if (qty > MAX_QTY) return { ok: false, error: `Item ${n}: the quantity is too large.` }
    let price: number | null = null
    if (opts.withPrice) {
      price = toNumber(rows[i].price_excl_gst)
      if (!Number.isFinite(price) || price < 0) return { ok: false, error: `Item ${n}: please enter the price (without GST).` }
      if (price > MAX_PRICE) return { ok: false, error: `Item ${n}: the price is too large.` }
      price = Math.round(price * 100) / 100
    }
    lines.push({ item_name: name, qty: Math.round(qty * 1000) / 1000, price_excl_gst: price })
  }
  return { ok: true, lines, total: opts.withPrice ? totalOf(lines) : null }
}

/** The total of a PO without GST: price x quantity of every line. */
export function totalOf(lines: { qty: number; price_excl_gst: number | null }[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.qty * (l.price_excl_gst ?? 0), 0) * 100) / 100
}

export const formatMoney = (n: number): string => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The lines as text for the conversation. */
export function linesAsText(lines: RequestLine[]): string {
  return lines.map((l, i) => `${i + 1}. ${l.item_name} - qty ${l.qty}${l.price_excl_gst !== null ? `, price ${formatMoney(l.price_excl_gst)} (without GST), line total ${formatMoney(l.qty * l.price_excl_gst)}` : ''}`).join('\n')
}
