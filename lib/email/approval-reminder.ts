// The daily reminder to an approver: everything still waiting for their decision, in one e-mail. One waiting approval reads as a plain reminder; several read as a
// list with a row for each (ticket number, title, who raised it, who sent it, how long it has waited) and each row has its own Approve / Reject buttons.

import { escapeHtml } from './escape'
import { layout, btn } from './templates'

export interface ReminderItem {
  requestNo: string
  requestTitle: string
  requesterName: string
  sentByName: string
  /** whole days the approval has been waiting (0 = sent today) */
  waitingDays: number
  requestUrl: string
  /** this approver's own links (missing when no signing secret is configured: the row then links to the ticket) */
  approveUrl?: string
  rejectUrl?: string
}

const waited = (days: number): string => (days <= 0 ? 'sent today' : days === 1 ? 'waiting 1 day' : `waiting ${days} days`)
const label = (i: ReminderItem): string => (i.requestNo ? `${i.requestNo} - ${i.requestTitle}` : i.requestTitle)

export function approvalReminderEmail(d: { approverName: string; items: ReminderItem[]; /** the page listing everything waiting for this person */ approvalsUrl: string }): { subject: string; html: string; text: string } {
  const items = d.items
  const one = items.length === 1
  const subject = one ? `Reminder: approval waiting for you - ${label(items[0])}` : `Reminder: ${items.length} approvals are waiting for you`
  const name = escapeHtml(d.approverName)
  const intro = one ? 'This approval is still waiting for your decision.' : `These ${items.length} approvals are still waiting for your decision.`

  const row = (i: ReminderItem): string => {
    const who = [i.requesterName ? `raised by ${escapeHtml(i.requesterName)}` : '', i.sentByName && i.sentByName !== i.requesterName ? `sent by ${escapeHtml(i.sentByName)}` : ''].filter(Boolean).join(' · ')
    const buttons = i.approveUrl && i.rejectUrl
      ? `<a href="${i.approveUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:8px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:6px 8px 0 0;">Approve</a>` +
        `<a href="${i.rejectUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;padding:8px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:6px 8px 0 0;">Reject</a>`
      : ''
    return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px;">
      <div style="font-weight:600;color:#111827;"><a href="${i.requestUrl}" style="color:#111827;text-decoration:none;">${escapeHtml(label(i))}</a></div>
      <div style="font-size:13px;color:#6B7280;margin-top:2px;">${who ? `${who} · ` : ''}${waited(i.waitingDays)}</div>
      ${buttons}
      <a href="${i.requestUrl}" style="display:inline-block;font-size:14px;color:#2563eb;text-decoration:none;margin-top:6px;">Open the request</a>
    </div>`
  }

  const decideNote = items.some((i) => i.approveUrl && i.rejectUrl)
    ? `<p style="font-size:13px;color:#6B7280;margin:4px 0 0;">A comment is required. Only <strong>${name}</strong> can decide from this e-mail: you will be asked to confirm it is you.</p>`
    : ''
  const html = layout(`
    <p>Hi ${name},</p>
    <p>${intro}</p>
    ${items.map(row).join('')}
    ${decideNote}
    ${one ? '' : btn(d.approvalsUrl, 'See all my approvals')}
  `)
  const text = [
    `Hi ${d.approverName},`, '', intro, '',
    ...items.map((i) => `- ${label(i)} (${i.requesterName ? `raised by ${i.requesterName}, ` : ''}${waited(i.waitingDays)})\n  Open: ${i.requestUrl}${i.approveUrl && i.rejectUrl ? `\n  Approve: ${i.approveUrl}\n  Reject: ${i.rejectUrl}` : ''}`),
    '', 'A comment is required to approve or reject.',
  ].join('\n')
  return { subject, html, text }
}
