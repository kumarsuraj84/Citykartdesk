import { escapeHtml } from './escape'

// Pure helpers (no Node-only imports) shared by the OEM template editor in the browser and
// the email sender on the server.

export const OEM_PLACEHOLDERS = [
  'ticket_no', 'subject', 'description', 'requester_name', 'requester_email', 'requester_phone', 'store_address',
] as const

export const OEM_SAMPLE_VALUES: Record<string, string> = {
  ticket_no: 'CKSD-000123',
  subject: 'AC not cooling',
  description: 'The AC in the sales area stopped cooling since morning.\nPlease send a technician.',
  requester_name: 'Store Manager',
  requester_email: 'store.manager@citykartstores.com',
  requester_phone: '98XXXXXX10',
  store_address: 'Main Road, Civil Lines, Allahabad - 211001',
}

/** Templates saved from the rich editor are HTML; older ones are plain text. */
export function isHtmlTemplate(template: string | null | undefined): boolean {
  return !!template && /^\s*<(p|table|h[1-6]|ul|ol|div|blockquote)[\s>]/i.test(template)
}

/** Plain-text template → HTML paragraphs, so the editor can open it. */
export function plainToHtml(text: string): string {
  if (!text.trim()) return ''
  return text.split('\n').map((line) => `<p>${line ? escapeHtml(line) : ''}</p>`).join('')
}

export const STARTER_TEMPLATE_HTML =
  '<p>Dear Team,</p>' +
  '<p>Please find the ticket below and help align a technician to resolve the issue at the address shared.</p>' +
  '<table><tbody>' +
  '<tr><th>Ticket No</th><td>{{ticket_no}}</td></tr>' +
  '<tr><th>Contact Person</th><td>{{requester_name}}</td></tr>' +
  '<tr><th>Email</th><td>{{requester_email}}</td></tr>' +
  '<tr><th>Phone</th><td>{{requester_phone}}</td></tr>' +
  '<tr><th>Location Address</th><td>{{store_address}}</td></tr>' +
  '<tr><th>Issue</th><td>{{subject}}</td></tr>' +
  '<tr><th>Issue Description</th><td>{{description}}</td></tr>' +
  '</tbody></table>' +
  '<p></p>' +
  '<p>Thanks and Regards,<br>Citykart Team</p>'

/** Fills {{placeholders}} in an HTML template. Every value is HTML-escaped (ticket text is
 *  typed by requesters); line breaks inside a value become <br>. */
export function fillHtmlTemplate(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => escapeHtml(vars[key] ?? '').replace(/\r?\n/g, '<br>'))
}

function addStyle(html: string, tag: string, style: string): string {
  const re = new RegExp(`<${tag}((?:\\s[^>]*)?)>`, 'gi')
  return html.replace(re, (_m, attrs: string) => {
    if (/\sstyle="/i.test(attrs)) return `<${tag}${attrs.replace(/(\sstyle=")/i, `$1${style};`)}>`
    return `<${tag}${attrs} style="${style}">`
  })
}

/** Mail clients ignore most stylesheets, so tables and text get their look as inline styles. */
export function inlineEmailStyles(html: string): string {
  let out = html
  out = addStyle(out, 'table', 'border-collapse:collapse;width:100%;margin:8px 0')
  out = addStyle(out, 'th', 'border:1px solid #cbd5e1;padding:8px 10px;background-color:#f1f5f9;text-align:left;font-weight:bold;vertical-align:top;width:30%')
  out = addStyle(out, 'td', 'border:1px solid #cbd5e1;padding:8px 10px;vertical-align:top')
  out = addStyle(out, 'p', 'margin:0 0 10px')
  out = addStyle(out, 'h1', 'margin:0 0 10px;font-size:22px')
  out = addStyle(out, 'h2', 'margin:0 0 10px;font-size:18px')
  out = addStyle(out, 'h3', 'margin:0 0 10px;font-size:16px')
  out = addStyle(out, 'ul', 'margin:0 0 10px;padding-left:22px')
  out = addStyle(out, 'ol', 'margin:0 0 10px;padding-left:22px')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222">${out}</div>`
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

/** Plain-text twin of the HTML body (the `text` part of the email). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|tr|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>\s*<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .split('\n').map((l) => l.trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The editor wraps every table cell's text in a <p>; in an email that only adds stray spacing,
 *  so cell paragraphs become plain text separated by line breaks. */
export function flattenCellParagraphs(html: string): string {
  return html.replace(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag: string, attrs: string, inner: string) => {
    const flat = inner.replace(/<\/p>\s*<p[^>]*>/gi, '<br>').replace(/<\/?p[^>]*>/gi, '')
    return `<${tag}${attrs}>${flat}</${tag}>`
  })
}

/** Full render of an (already sanitized) HTML template → what the OEM's mail client receives. */
export function renderHtmlEmail(templateHtml: string, vars: Record<string, string>): { html: string; text: string } {
  const filled = flattenCellParagraphs(fillHtmlTemplate(templateHtml, vars))
  return { html: inlineEmailStyles(filled), text: htmlToText(filled) }
}
