// The rules for deciding a PO. Pure, so the window and the server use the same ones.

export type PoApprovalCheck = { ok: true; poNumber: string; poDate: string } | { ok: false; error: string }

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Approving needs the PO number, the PO date (not in the future, not absurdly old) and the PO document. */
export function checkPoApproval(i: { poNumber: string; poDate: string; hasFile: boolean }, now: Date = new Date()): PoApprovalCheck {
  const poNumber = (i.poNumber ?? '').trim()
  if (!poNumber) return { ok: false, error: 'Please enter the PO number.' }
  if (poNumber.length > 60) return { ok: false, error: 'The PO number is too long.' }
  if (/[<>\u0000-\u001f]/.test(poNumber)) return { ok: false, error: 'The PO number has characters that are not allowed.' }
  const poDate = (i.poDate ?? '').trim()
  const m = DATE.exec(poDate)
  if (!m) return { ok: false, error: 'Please enter the PO date.' }
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return { ok: false, error: 'The PO date is not a real date.' }
  const istToday = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
  if (poDate > istToday) return { ok: false, error: 'The PO date cannot be in the future.' }
  if (poDate < '2020-01-01') return { ok: false, error: 'The PO date is too old.' }
  if (!i.hasFile) return { ok: false, error: 'Please attach the PO document.' }
  return { ok: true, poNumber, poDate }
}

export type PoRejectionCheck = { ok: true; reason: string } | { ok: false; error: string }

/** Rejecting needs a reason the vendor and the OEM can read. */
export function checkPoRejection(reasonRaw: string): PoRejectionCheck {
  const reason = (reasonRaw ?? '').replace(/\s+/g, ' ').trim()
  if (reason.length < 5) return { ok: false, error: 'Please give the reason for rejecting (at least 5 characters).' }
  if (reason.length > 1000) return { ok: false, error: 'The reason is too long.' }
  return { ok: true, reason }
}
