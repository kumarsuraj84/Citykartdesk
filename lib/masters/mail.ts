import { htmlToCommentText, isHtmlTemplate, plainToHtml, renderHtmlEmail } from '@/lib/email/oem-template'
import { OEM_COMMENT_MARKER } from './comment-view'
import { sanitizeTemplateHtml } from '@/lib/email/sanitize-template'
import { DEFAULT_MASTER_BODY, DEFAULT_MASTER_SUBJECT, type MailKind } from './mail-constants'
import type { AcUnitRecord, GensetRecord } from './resolve'

// The two mail templates (AC and Genset) that go to the OEM. Pure: the caller loads the template and sends the mail. Server side (it cleans the template with sanitize-html);
// the constants the admin screen needs are in mail-constants.ts.
export { MASTER_PLACEHOLDERS, MASTER_SAMPLE_VALUES, DEFAULT_MASTER_SUBJECT, DEFAULT_MASTER_BODY, type MailKind } from './mail-constants'

export function resolveTemplate(saved: { subject: string; body_html: string } | null | undefined, kind: MailKind): { subject: string; body: string } {
  const body = saved?.body_html?.trim() ? saved.body_html : DEFAULT_MASTER_BODY[kind]
  return { subject: saved?.subject?.trim() || DEFAULT_MASTER_SUBJECT[kind], body: isHtmlTemplate(body) ? body : plainToHtml(body) }
}

const part = (...v: (string | null | undefined)[]) => v.filter((x) => x && x.trim()).join(' ')

export function acVars(u: AcUnitRecord | null): Record<string, string> {
  if (!u) return { ac_number: '(not chosen)', ac_serial: '', ac_brand: '', ac_floor: '', ac_type: '', ac_tonnage: '', ac_amc_vendor: '', ac_amc_brand: '', ac_details: '(no AC chosen)' }
  const details = [u.ckdesk_no, [u.floor, part(u.ac_type, u.tonnage)].filter(Boolean).join(', '), u.brand, u.serial ? `serial ${u.serial}` : ''].filter(Boolean).join(' - ')
  return {
    ac_number: u.ckdesk_no, ac_serial: u.serial ?? '', ac_brand: u.brand ?? '', ac_floor: u.floor ?? '', ac_type: u.ac_type ?? '', ac_tonnage: u.tonnage ?? '',
    ac_amc_vendor: u.amc_vendor ?? '', ac_amc_brand: u.amc_brand ?? '', ac_details: details,
  }
}

export function gensetVars(list: GensetRecord[]): Record<string, string> {
  const one = (g: GensetRecord) => [part(g.brand, g.kva ? `${g.kva} KVA` : ''), g.serial ? `serial ${g.serial}` : '', g.cpcb_group ?? ''].filter(Boolean).join(', ')
  const join = (pick: (g: GensetRecord) => string | null) => list.map((g) => pick(g) ?? '').filter(Boolean).join(' / ')
  return {
    genset_brand: join((g) => g.brand), genset_kva: join((g) => g.kva), genset_serial: join((g) => g.serial), genset_cpcb_group: join((g) => g.cpcb_group),
    genset_details: list.map(one).join('\n'),
  }
}

export function renderMasterMail(tpl: { subject: string; body: string }, vars: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = tpl.subject.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? '')
  const { html, text } = renderHtmlEmail(sanitizeTemplateHtml(tpl.body), vars)
  return { subject, html, text }
}

/**
 * What the ticket's conversation keeps when the ticket was e-mailed to the OEM: who it went to and the mail's text. It is stored as plain text; the table rows of the
 * mail are written as "Label | value" lines so the ticket page can show them as a table again (lib/masters/comment-view.ts reads this shape back).
 */
export function masterSentComment(p: { label: string; to: string[]; cc: string[]; subject: string; html: string }): string {
  return [
    `Ticket sent to the ${p.label} OEM for servicing.`,
    '',
    `Subject: ${p.subject}`,
    `To: ${p.to.join(', ')}`,
    ...(p.cc.length ? [`CC: ${p.cc.join(', ')}`] : []),
    '',
    OEM_COMMENT_MARKER,
    htmlToCommentText(p.html),
  ].join('\n')
}

