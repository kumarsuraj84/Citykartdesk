import { escapeHtml } from '@/lib/email/escape'
import { formatMoney, totalOf, type RequestLine } from './lines'

// The e-mails about a PO. Pure functions (no sending here), so the wording is tested on its own.

export type PoMailBase = {
  requestNo: string
  storeLabel: string
  acLabel: string
  vendorName: string
  lines: RequestLine[]
}

type Mail = { subject: string; html: string; text: string }

const itemsTable = (lines: RequestLine[]) =>
  `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 14px;"><thead><tr>${['#', 'Item', 'Qty', 'Price (without GST)', 'Line total'].map((h) => `<th style="text-align:left;border-bottom:1px solid #d1d5db;padding:4px 8px;">${h}</th>`).join('')}</tr></thead><tbody>${
    lines.map((l, i) => `<tr><td style="padding:4px 8px;">${i + 1}</td><td style="padding:4px 8px;">${escapeHtml(l.item_name)}</td><td style="padding:4px 8px;">${l.qty}</td><td style="padding:4px 8px;">${l.price_excl_gst === null ? '-' : formatMoney(l.price_excl_gst)}</td><td style="padding:4px 8px;">${l.price_excl_gst === null ? '-' : formatMoney(l.qty * l.price_excl_gst)}</td></tr>`).join('')
  }</tbody></table>`

const itemsText = (lines: RequestLine[]) =>
  lines.map((l, i) => `${i + 1}. ${l.item_name} | qty ${l.qty}${l.price_excl_gst === null ? '' : ` | ${formatMoney(l.price_excl_gst)} (without GST) | ${formatMoney(l.qty * l.price_excl_gst)}`}`).join('\n')

const details = (m: PoMailBase) => [['Ticket', m.requestNo], ['Store', m.storeLabel], ['AC', m.acLabel], ['Vendor', m.vendorName]]
const detailsHtml = (m: PoMailBase) => `<table style="font-size:13px;margin:8px 0;">${details(m).map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;">${k}</td><td style="padding:2px 0;">${escapeHtml(v)}</td></tr>`).join('')}</table>`

/** To the OEM: the PO has been approved, with its number, date, items and (attached) document. */
export function buildPoApprovedMail(m: PoMailBase & { poNumber: string; poDate: string; hasDocument: boolean }): Mail {
  const total = totalOf(m.lines.map((l) => ({ qty: l.qty, price_excl_gst: l.price_excl_gst })))
  const subject = `PO ${m.poNumber} approved - ${m.requestNo} - ${m.storeLabel}`
  const html = `<p>Dear Team,</p><p>Citykart has approved the purchase order for the ticket below.</p>${detailsHtml(m)}<p><strong>PO number:</strong> ${escapeHtml(m.poNumber)}<br><strong>PO date:</strong> ${escapeHtml(m.poDate)}</p>${itemsTable(m.lines)}<p><strong>Total (without GST):</strong> ${formatMoney(total)}</p>${m.hasDocument ? '<p>The PO document is attached.</p>' : ''}<p>Thanks and Regards,<br>Citykart Team</p>`
  const text = `Dear Team,\n\nCitykart has approved the purchase order for the ticket below.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nPO number: ${m.poNumber}\nPO date: ${m.poDate}\n\n${itemsText(m.lines)}\n\nTotal (without GST): ${formatMoney(total)}\n${m.hasDocument ? '\nThe PO document is attached.\n' : ''}\nThanks and Regards,\nCitykart Team`
  return { subject, html, text }
}

/** To the OEM: the PO request was rejected and the ticket is cancelled (short note). */
export function buildPoRejectedMail(m: PoMailBase & { reason: string }): Mail {
  const subject = `PO request rejected - ${m.requestNo} - ${m.storeLabel}`
  const html = `<p>Dear Team,</p><p>Citykart has <strong>not approved</strong> the purchase order requested for the ticket below, and the ticket has been cancelled.</p>${detailsHtml(m)}<p><strong>Reason:</strong> ${escapeHtml(m.reason)}</p><p>Thanks and Regards,<br>Citykart Team</p>`
  const text = `Dear Team,\n\nCitykart has not approved the purchase order requested for the ticket below, and the ticket has been cancelled.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReason: ${m.reason}\n\nThanks and Regards,\nCitykart Team`
  return { subject, html, text }
}

/** To the PO approver: a vendor needs a purchase order approved. */
export function buildPoApprovalRequestMail(m: PoMailBase & { link: string; approverName: string }): Mail {
  const total = totalOf(m.lines.map((l) => ({ qty: l.qty, price_excl_gst: l.price_excl_gst })))
  const subject = `PO approval needed - ${m.requestNo} - ${m.vendorName}`
  const html = `<p>Dear ${escapeHtml(m.approverName)},</p><p>${escapeHtml(m.vendorName)} needs a purchase order to repair the AC on the ticket below.</p>${detailsHtml(m)}${itemsTable(m.lines)}<p><strong>Total (without GST):</strong> ${formatMoney(total)}</p><p><a href="${escapeHtml(m.link)}" style="display:inline-block;background:#1e4a8a;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">Open and approve / reject</a></p><p style="color:#6b7280;font-size:12px;">You will be asked to sign in to Citykart Desk. To approve you enter the PO number, the PO date and attach the PO document.</p>`
  const text = `Dear ${m.approverName},\n\n${m.vendorName} needs a purchase order to repair the AC on the ticket below.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${itemsText(m.lines)}\n\nTotal (without GST): ${formatMoney(total)}\n\nOpen and approve / reject (sign-in needed): ${m.link}`
  return { subject, html, text }
}
