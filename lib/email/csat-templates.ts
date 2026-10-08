// The one e-mail a requester gets when a ticket is resolved: what was done, a one-click rating, and a way to reopen it.
// Replaces the plain "request resolved" e-mail (the in-app notification still appears as before).

import { escapeEmailFields } from './escape'
import { layout, btn } from './templates'

type Common = {
  recipientName: string
  requestNo: string
  requestTitle: string
  requestUrl: string
  /** one link per star, 1..5 (each opens the rating page with that star already chosen) */
  starUrls: string[]
  reopenUrl: string
  /** e.g. "11 Oct 2026, 5:30 pm"; empty when the window is already closed */
  reopenUntil: string
}

const STAR_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent']

function stars(urls: string[]): string {
  const cells = urls.map((u, i) =>
    `<td style="padding:0 4px;text-align:center;"><a href="${u}" style="text-decoration:none;display:inline-block;">` +
    `<div style="font-size:30px;line-height:34px;color:#f5a623;">&#9733;</div>` +
    `<div style="font-size:11px;color:#6b7280;">${i + 1} &middot; ${STAR_LABELS[i]}</div></a></td>`
  ).join('')
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 4px;"><tr>${cells}</tr></table>`
}

export function csatResolvedEmail(d: Common & { resolutionNote: string; resolverName: string; resolvedOn: string }): { subject: string; html: string; text: string } {
  const e = escapeEmailFields(d, ['requestUrl', 'reopenUrl'])
  const subject = `Resolved: ${d.requestNo ? `${d.requestNo} — ` : ''}${d.requestTitle}`
  const note = d.resolutionNote
    ? `<p style="margin:12px 0;padding:12px 16px;background:#F8FAFD;border-left:3px solid #16a34a;border-radius:4px;white-space:pre-wrap;">${e.resolutionNote}</p>`
    : ''
  const reopenLine = d.reopenUntil
    ? `<p style="font-size:14px;color:#374151;">Still not fixed? <a href="${d.reopenUrl}" style="color:#2563eb;font-weight:600;">Reopen this request</a> and tell us what is wrong. You can do this until <strong>${e.reopenUntil}</strong>; after that it closes automatically.</p>`
    : ''
  const html = layout(`
    <p>Hi ${e.recipientName},</p>
    <p>Your request <strong>${d.requestNo ? `${e.requestNo} — ` : ''}${e.requestTitle}</strong> has been marked <strong>resolved</strong>${e.resolverName ? ` by ${e.resolverName}` : ''}${e.resolvedOn ? ` on ${e.resolvedOn}` : ''}.</p>
    ${note}
    <p style="margin-top:20px;font-weight:600;">How did we do? Tap a star:</p>
    ${stars(d.starUrls)}
    ${reopenLine}
    ${btn(e.requestUrl, 'View request')}
  `)
  const text = [
    `Hi ${d.recipientName},`, '',
    `Your request "${d.requestNo ? `${d.requestNo} — ` : ''}${d.requestTitle}" has been marked resolved${d.resolverName ? ` by ${d.resolverName}` : ''}.`,
    d.resolutionNote ? `\n${d.resolutionNote}\n` : '',
    'How did we do? Rate us (1 = poor, 5 = excellent):',
    ...d.starUrls.map((u, i) => `  ${i + 1} star: ${u}`),
    '',
    d.reopenUntil ? `Still not fixed? Reopen it until ${d.reopenUntil}: ${d.reopenUrl}` : '',
    `View it here: ${d.requestUrl}`,
  ].filter((l) => l !== '').join('\n')
  return { subject, html, text }
}

export function csatReminderEmail(d: Common): { subject: string; html: string; text: string } {
  const e = escapeEmailFields(d, ['requestUrl', 'reopenUrl'])
  const subject = `Quick question: ${d.requestNo ? `${d.requestNo} — ` : ''}${d.requestTitle}`
  const html = layout(`
    <p>Hi ${e.recipientName},</p>
    <p>A couple of days ago we resolved your request <strong>${d.requestNo ? `${e.requestNo} — ` : ''}${e.requestTitle}</strong>. Was it sorted out?</p>
    <p style="font-weight:600;">Tap a star to rate it:</p>
    ${stars(d.starUrls)}
    ${d.reopenUntil ? `<p style="font-size:14px;color:#374151;">If it is not fixed, <a href="${d.reopenUrl}" style="color:#2563eb;font-weight:600;">reopen it</a> before <strong>${e.reopenUntil}</strong>.</p>` : ''}
    ${btn(e.requestUrl, 'View request')}
  `)
  const text = [
    `Hi ${d.recipientName},`, '',
    `We resolved "${d.requestNo ? `${d.requestNo} — ` : ''}${d.requestTitle}" a couple of days ago. Was it sorted out?`,
    ...d.starUrls.map((u, i) => `  ${i + 1} star: ${u}`),
    d.reopenUntil ? `Not fixed? Reopen it before ${d.reopenUntil}: ${d.reopenUrl}` : '',
  ].filter((l) => l !== '').join('\n')
  return { subject, html, text }
}
