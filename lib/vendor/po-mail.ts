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
  const html = `<p>Dear Team,</p><p>Citykart will <strong>not issue a purchase order</strong> for the AC repair on the ticket below, so the ticket is <strong>cancelled</strong>. Please do not do any further work on it.</p>${detailsHtml(m)}<p><strong>Reason:</strong> ${escapeHtml(m.reason)}</p><p>Thanks and Regards,<br>Citykart Team</p>`
  const text = `Dear Team,\n\nCitykart will not issue a purchase order for the AC repair on the ticket below, so the ticket is cancelled. Please do not do any further work on it.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReason: ${m.reason}\n\nThanks and Regards,\nCitykart Team`
  return { subject, html, text }
}

/** To the PO approver: a vendor needs a purchase order approved. */
export function buildPoApprovalRequestMail(m: PoMailBase & { link: string; approverName: string; version?: number; previousTotal?: number | null; anyOneCanDecide?: boolean }): Mail {
  const total = totalOf(m.lines.map((l) => ({ qty: l.qty, price_excl_gst: l.price_excl_gst })))
  const revised = (m.version ?? 1) > 1
  const subject = `${revised ? `Revised quote (version ${m.version}) - PO approval needed` : 'PO approval needed'} - ${m.requestNo} - ${m.vendorName}`
  const html = `<p>Dear ${escapeHtml(m.approverName)},</p><p>${escapeHtml(m.vendorName)} ${revised ? `sent a <strong>revised quote (version ${m.version})</strong>${m.previousTotal != null ? ` - the earlier total was ${formatMoney(m.previousTotal)}` : ''} - for` : 'needs a purchase order to repair'} the AC on the ticket below.</p>${detailsHtml(m)}${itemsTable(m.lines)}<p><strong>Total (without GST):</strong> ${formatMoney(total)}</p><p><a href="${escapeHtml(m.link)}" style="display:inline-block;background:#1e4a8a;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">Open and approve / reject</a></p><p style="color:#6b7280;font-size:12px;">${m.anyOneCanDecide ? 'This mail went to all the approvers of this AC. Any one of you can decide; the first decision is final and the others are told. ' : ''}You will be asked to sign in to Citykart Desk. To approve you enter the PO number, the PO date and attach the PO document.</p>`
  const text = `Dear ${m.approverName},\n\n${m.vendorName} ${revised ? `sent a revised quote (version ${m.version})${m.previousTotal != null ? `, the earlier total was ${formatMoney(m.previousTotal)},` : ''} for` : 'needs a purchase order to repair'} the AC on the ticket below.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${itemsText(m.lines)}\n\nTotal (without GST): ${formatMoney(total)}\n\n${m.anyOneCanDecide ? 'This mail went to all the approvers of this AC. Any one of you can decide; the first decision is final.\n\n' : ''}Open and approve / reject (sign-in needed): ${m.link}`
  return { subject, html, text }
}

/** To the vendor: the approver asked for a revised price. */
export function buildPoRevisionAskedMail(m: PoMailBase & { link: string; note: string; approverName: string; vendorPersonName: string }): Mail {
  const subject = `Revised price needed - ${m.requestNo} - ${m.storeLabel}`
  const html = `<p>Dear ${escapeHtml(m.vendorPersonName)},</p><p>${escapeHtml(m.approverName)} has asked for a <strong>revised price</strong> for the ticket below.</p>${detailsHtml(m)}<p><strong>What was asked:</strong> ${escapeHtml(m.note)}</p><p><a href="${escapeHtml(m.link)}" style="display:inline-block;background:#1e4a8a;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">Open the ticket and send the revised quote</a></p><p style="color:#6b7280;font-size:12px;">Open the ticket, change the prices and attach your revised quote.</p>`
  const text = `Dear ${m.vendorPersonName},\n\n${m.approverName} has asked for a revised price for the ticket below.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nWhat was asked: ${m.note}\n\nOpen the ticket, change the prices and attach your revised quote: ${m.link}`
  return { subject, html, text }
}

/** To the vendor: the quote was not approved, but the ticket goes on - he arranges the parts himself (no PO) and reports "Parts received". */
export function buildQuoteNotApprovedMail(m: PoMailBase & { link: string; reason: string; approverName: string; vendorPersonName: string }): Mail {
  const subject = `Quote not approved - arrange the parts yourself - ${m.requestNo} - ${m.storeLabel}`
  const html = `<p>Dear ${escapeHtml(m.vendorPersonName)},</p><p>${escapeHtml(m.approverName)} has <strong>not approved your quote</strong> for the ticket below. <strong>The ticket is not cancelled.</strong> Please arrange the parts yourself (no PO from Citykart) and press <em>Parts received</em> when they arrive.</p>${detailsHtml(m)}<p><strong>Reason:</strong> ${escapeHtml(m.reason)}</p><p><strong>Parts list kept on the ticket:</strong></p>${itemsTable(m.lines.map((l) => ({ ...l, price_excl_gst: null })))}<p><a href="${escapeHtml(m.link)}" style="display:inline-block;background:#1e4a8a;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">Open the ticket</a></p>`
  const text = `Dear ${m.vendorPersonName},\n\n${m.approverName} has not approved your quote for the ticket below. The ticket is NOT cancelled. Please arrange the parts yourself (no PO from Citykart) and press "Parts received" when they arrive.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReason: ${m.reason}\n\nParts list kept on the ticket:\n${itemsText(m.lines.map((l) => ({ ...l, price_excl_gst: null })))}\n\nOpen the ticket: ${m.link}`
  return { subject, html, text }
}

/** To the vendor: his quote was approved - the PO number, date and items; the ticket is back in progress (the PO document is attached). */
export function buildVendorPoApprovedMail(m: PoMailBase & { link: string; poNumber: string; poDate: string; approverName: string; vendorPersonName: string; hasDocument: boolean }): Mail {
  const total = totalOf(m.lines.map((l) => ({ qty: l.qty, price_excl_gst: l.price_excl_gst })))
  const subject = `PO ${m.poNumber} approved - ${m.requestNo} - ${m.storeLabel}`
  const html = `<p>Dear ${escapeHtml(m.vendorPersonName)},</p><p>${escapeHtml(m.approverName)} has <strong>approved your quote</strong>. The ticket is back In Progress; you can continue and resolve it.</p>${detailsHtml(m)}<p><strong>PO number:</strong> ${escapeHtml(m.poNumber)}<br><strong>PO date:</strong> ${escapeHtml(m.poDate)}</p>${itemsTable(m.lines)}<p><strong>Total (without GST):</strong> ${formatMoney(total)}</p>${m.hasDocument ? '<p>The PO document is attached.</p>' : ''}<p><a href="${escapeHtml(m.link)}" style="display:inline-block;background:#1e4a8a;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">Open the ticket</a></p>`
  const text = `Dear ${m.vendorPersonName},\n\n${m.approverName} has approved your quote. The ticket is back In Progress; you can continue and resolve it.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nPO number: ${m.poNumber}\nPO date: ${m.poDate}\n\n${itemsText(m.lines)}\n\nTotal (without GST): ${formatMoney(total)}\n${m.hasDocument ? '\nThe PO document is attached.\n' : ''}\nOpen the ticket: ${m.link}`
  return { subject, html, text }
}

/** To the vendor: the quote was rejected AND the ticket cancelled. */
export function buildVendorTicketCancelledMail(m: PoMailBase & { link: string; reason: string; approverName: string; vendorPersonName: string }): Mail {
  const subject = `Quote rejected and ticket cancelled - ${m.requestNo} - ${m.storeLabel}`
  const html = `<p>Dear ${escapeHtml(m.vendorPersonName)},</p><p>Your quote for <strong>${escapeHtml(m.requestNo)}</strong> was <strong>rejected by ${escapeHtml(m.approverName)} and the ticket is cancelled</strong>. Please do not do any further work on it.</p>${detailsHtml(m)}<p><strong>Reason:</strong> ${escapeHtml(m.reason)}</p><p><a href="${escapeHtml(m.link)}" style="display:inline-block;background:#1e4a8a;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">Open the ticket</a></p>`
  const text = `Dear ${m.vendorPersonName},\n\nYour quote for ${m.requestNo} was rejected by ${m.approverName} and the ticket is cancelled. Please do not do any further work on it.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReason: ${m.reason}\n\nOpen the ticket: ${m.link}`
  return { subject, html, text }
}

/** To the approver: the vendor withdrew the quote he was asked to decide. */
export function buildQuoteWithdrawnMail(m: PoMailBase & { link: string; reason: string; approverName: string; vendorPersonName: string; version: number }): Mail {
  const subject = `Quote withdrawn by the vendor - ${m.requestNo} - ${m.vendorName}`
  const html = `<p>Dear ${escapeHtml(m.approverName)},</p><p>${escapeHtml(m.vendorPersonName)} (${escapeHtml(m.vendorName)}) has <strong>withdrawn quote version ${m.version}</strong>. Nothing more is needed from you on this ticket for now.</p>${detailsHtml(m)}<p><strong>Reason:</strong> ${escapeHtml(m.reason)}</p><p><a href="${escapeHtml(m.link)}">Open the ticket</a></p>`
  const text = `Dear ${m.approverName},\n\n${m.vendorPersonName} (${m.vendorName}) has withdrawn quote version ${m.version}. Nothing more is needed from you on this ticket for now.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReason: ${m.reason}\n\nOpen the ticket: ${m.link}`
  return { subject, html, text }
}

const button = (href: string, label: string) => `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#1e4a8a;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">${escapeHtml(label)}</a></p>`

/** To the vendor technician: the store (or a Citykart technician) reopened a resolved ticket - it is not fixed. He must enter the NEW OEM ticket number to start again. */
export function buildVendorReopenedMail(m: PoMailBase & { link: string; vendorPersonName: string; byName: string; reason: string; reopenCount: number; needsNewOemNumber: boolean }): Mail {
  const subject = `REOPENED by the store - please attend again - ${m.requestNo} - ${m.storeLabel}`
  const again = m.reopenCount > 1 ? ` (reopened ${m.reopenCount} times)` : ''
  const reminder = m.needsNewOemNumber ? 'The earlier OEM ticket number and date have been cleared. Raise a new ticket with the OEM and enter the NEW OEM ticket number to start working.' : ''
  const html = `<p>Dear ${escapeHtml(m.vendorPersonName)},</p><p>The ticket below was <strong>REOPENED by ${escapeHtml(m.byName)}</strong>${escapeHtml(again)}. The problem is not fixed, so please attend again.</p>${detailsHtml(m)}<p><strong>Reason given:</strong> ${escapeHtml(m.reason || '(none)')}</p>${reminder ? `<p>${escapeHtml(reminder)}</p>` : ''}${button(m.link, 'Open the ticket')}`
  const text = `Dear ${m.vendorPersonName},\n\nThe ticket below was REOPENED by ${m.byName}${again}. The problem is not fixed, so please attend again.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReason given: ${m.reason || '(none)'}\n${reminder ? `\n${reminder}\n` : ''}\nOpen the ticket: ${m.link}`
  return { subject, html, text }
}

/** To the vendor technician: Citykart took the ticket back from hold (for example they buy the part themselves) - his request is closed. */
export function buildVendorHoldEndedMail(m: PoMailBase & { link: string; vendorPersonName: string; byName: string; remark: string; kind: 'parts' | 'po' }): Mail {
  const what = m.kind === 'po' ? 'quote / PO request' : 'parts request'
  const subject = `Hold ended by Citykart - your ${what} is closed - ${m.requestNo} - ${m.storeLabel}`
  const html = `<p>Dear ${escapeHtml(m.vendorPersonName)},</p><p>${escapeHtml(m.byName)} of Citykart has <strong>taken this ticket back and ended the hold</strong>. Your ${what} is closed and nothing more is needed from you for it. The ticket is In Progress again.</p>${detailsHtml(m)}<p><strong>Remark from Citykart:</strong> ${escapeHtml(m.remark || '(none)')}</p>${button(m.link, 'Open the ticket')}`
  const text = `Dear ${m.vendorPersonName},\n\n${m.byName} of Citykart has taken this ticket back and ended the hold. Your ${what} is closed and nothing more is needed from you for it. The ticket is In Progress again.\n\n${details(m).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nRemark from Citykart: ${m.remark || '(none)'}\n\nOpen the ticket: ${m.link}`
  return { subject, html, text }
}

/** To the store: the vendor corrected the parts list of a ticket on hold. */
export function buildStorePartsUpdatedMail(m: PoMailBase & { link: string; storeContactName: string; version: number }): Mail {
  const noPrice = m.lines.map((l) => ({ ...l, price_excl_gst: null }))
  const subject = `Parts list updated (version ${m.version}) - ${m.requestNo}`
  const html = `<p>Dear ${escapeHtml(m.storeContactName)},</p><p>${escapeHtml(m.vendorName)} has updated the list of parts needed for your request <strong>${escapeHtml(m.requestNo)}</strong> (version ${m.version}). The request stays on hold until the parts arrive.</p>${itemsTable(noPrice)}${button(m.link, 'Open your request')}`
  const text = `Dear ${m.storeContactName},\n\n${m.vendorName} has updated the list of parts needed for your request ${m.requestNo} (version ${m.version}). The request stays on hold until the parts arrive.\n\n${itemsText(noPrice)}\n\nOpen your request: ${m.link}`
  return { subject, html, text }
}
