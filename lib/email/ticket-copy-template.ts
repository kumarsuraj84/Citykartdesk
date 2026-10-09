// The e-mail a person gets when a technician copies them on a ticket comment: the ticket's details, the complete public
// conversation with the new comment marked, and the attachment names. It is a read-only copy - no login is needed to read it.

import { layout, btn } from './templates'
import { escapeHtml } from './escape'
import type { TicketPdfModel } from '@/lib/requests/ticket-pdf-model'

const MAX_MESSAGES = 60
const MAX_BODY = 4000

export interface TicketCopyEmailInput {
  recipientName: string
  copiedBy: string
  model: TicketPdfModel
  /** the comment the technician has just posted */
  newCommentId: string
  requestUrl: string
  pdfAttached: boolean
}

const clip = (s: string) => (s.length > MAX_BODY ? `${s.slice(0, MAX_BODY)} ...` : s)
const multiline = (s: string) => escapeHtml(s).replace(/\n/g, '<br>')
const pick = (m: TicketPdfModel, label: string) => m.details.find((d) => d.label === label)?.value ?? '-'

export function ticketCopyEmail(d: TicketCopyEmailInput): { subject: string; html: string; text: string } {
  const m = d.model
  const subject = `${m.requestNo}: ${m.title} (copied by ${d.copiedBy})`

  // the newest messages if the conversation is very long, always including the new comment
  const all = m.conversation
  const shown = all.length > MAX_MESSAGES ? all.slice(all.length - MAX_MESSAGES) : all
  const skipped = all.length - shown.length
  const newest = all.find((c) => c.id === d.newCommentId)

  const rows = [
    ['Status', m.status], ['Priority', m.priority], ['Requester', pick(m, 'Requester')], ['Technician', pick(m, 'Technician')],
    ['Technician group', pick(m, 'Technician group')], ['Service', pick(m, 'Service')], ['Category', pick(m, 'Category')],
    ['Created', pick(m, 'Created')], ['Resolution due', pick(m, 'Resolution due')], ['Resolved', pick(m, 'Resolved')],
  ]
  const detailsHtml = rows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6B7280;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:4px 0;font-size:13px;color:#111827;">${escapeHtml(v)}</td></tr>`)
    .join('')

  const messageHtml = (c: TicketPdfModel['conversation'][number]) => {
    const isNew = c.id === d.newCommentId
    return `<div style="margin:0 0 10px;padding:10px 14px;border-left:3px solid ${isNew ? '#2563eb' : '#e5e7eb'};background:${isNew ? '#eff6ff' : '#f9fafb'};border-radius:4px;">
      <div style="font-size:12px;color:#6B7280;margin-bottom:4px;"><strong style="color:#111827;">${escapeHtml(c.author)}</strong>${c.via ? ` (${escapeHtml(c.via)})` : ''} &middot; ${escapeHtml(c.at)}${isNew ? ' &middot; <strong style="color:#2563eb;">NEW</strong>' : ''}</div>
      <div style="font-size:14px;color:#111827;">${multiline(clip(c.body || '-'))}</div>
    </div>`
  }

  const attachmentsHtml = m.attachments.length > 0
    ? `<p style="margin:18px 0 6px;font-weight:600;">Attachments (names only)</p><ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;">${m.attachments.map((a) => `<li>${escapeHtml(a.name)} (${escapeHtml(a.size)})</li>`).join('')}</ul>`
    : ''

  const html = layout(`
    <p>Hi ${escapeHtml(d.recipientName)},</p>
    <p><strong>${escapeHtml(d.copiedBy)}</strong> has copied you on this request so you can see what is happening.${d.pdfAttached ? ' The full ticket is attached as a PDF.' : ''}</p>
    <div style="margin:14px 0;padding:12px 16px;border:1px solid #e5e7eb;border-radius:8px;">
      <div style="font-size:12px;color:#6B7280;font-family:monospace;">${escapeHtml(m.requestNo)}</div>
      <div style="font-size:17px;font-weight:700;color:#111827;margin:2px 0 8px;">${escapeHtml(m.title)}</div>
      <table style="border-collapse:collapse;">${detailsHtml}</table>
    </div>
    ${newest ? `<p style="margin:18px 0 6px;font-weight:600;">Latest comment</p>${messageHtml(newest)}` : ''}
    <p style="margin:18px 0 6px;font-weight:600;">Complete conversation (${all.length})</p>
    ${skipped > 0 ? `<p style="font-size:12px;color:#6B7280;">Showing the latest ${shown.length} of ${all.length} messages. The attached PDF has the whole conversation.</p>` : ''}
    ${shown.length > 0 ? shown.map(messageHtml).join('') : '<p style="font-size:13px;color:#6B7280;">No messages yet.</p>'}
    ${attachmentsHtml}
    ${btn(d.requestUrl, 'Open in Citykart Desk')}
    <p style="font-size:12px;color:#6B7280;margin-top:18px;">This is a read-only copy. Internal notes are never included. You can reply to this e-mail from your CK Desk address and the reply is added to the ticket.</p>
  `)

  const text = [
    `Hi ${d.recipientName},`, '',
    `${d.copiedBy} has copied you on ${m.requestNo}: ${m.title}`,
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    newest ? `LATEST COMMENT\n${newest.author} (${newest.at}):\n${clip(newest.body)}\n` : '',
    `COMPLETE CONVERSATION (${all.length})`,
    ...shown.map((c) => `\n${c.author}${c.via ? ` (${c.via})` : ''} - ${c.at}${c.id === d.newCommentId ? ' [NEW]' : ''}\n${clip(c.body)}`),
    m.attachments.length ? `\nATTACHMENTS: ${m.attachments.map((a) => a.name).join(', ')}` : '',
    `\nOpen it here: ${d.requestUrl}`,
  ].join('\n')

  return { subject, html, text }
}
