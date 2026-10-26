// The "earlier requests of this store" box that goes with an approval request (mail, approve page, request page).
// This file holds only the pure parts - which answers to show, how to write them, how to put the rows together and how to draw the box in a mail - so they can be tested
// without a database. The part that reads the database is lib/approvals/history.ts.

import { escapeHtml } from '@/lib/email/escape'
import type { FormField, FormFieldOption, FormSection } from '@/types'

export type HistoryOutcome = 'approved' | 'rejected' | 'waiting'

export interface HistoryRow {
  requestNo: string
  /** ISO time: when it was decided (or, for a request still waiting, when it was sent) */
  at: string
  outcome: HistoryOutcome
  /** who decided it ('' while waiting) */
  decidedBy: string
  comment: string
  /** the ticked answers, in the same order as `columns` */
  values: string[]
}

export interface ApprovalHistory {
  storeName: string
  /** "Fixtures > Shelving" */
  category: string
  /** labels of the answers ticked "Show in approval history" in the form (can be empty) */
  columns: string[]
  /** the answers of the request that is being asked now, in the order of `columns` */
  now: string[]
  /** newest first, at most `shown` rows */
  earlier: HistoryRow[]
  /** earlier decided requests that are not listed because of the row limit */
  moreCount: number
  /** for each ticked number answer: the sum over the APPROVED earlier requests of the period */
  totals: { label: string; total: number; count: number }[]
  months: number
}

export const HISTORY_MONTHS = 12
export const HISTORY_ROWS = 5

/** The fields of a form that are ticked "Show in approval history", in the order they appear on the form (one per label). */
export function tickedFields(sections: FormSection[]): FormField[] {
  const out: FormField[] = []
  const seen = new Set<string>()
  const ordered = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const s of ordered) {
    for (const f of [...(s.fields ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      if (f.show_in_approval_history !== true) continue
      const key = f.label.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(f)
    }
  }
  return out
}

function optionLabel(options: FormFieldOption[] | undefined, value: string): string | null {
  for (const o of options ?? []) {
    if (o.value === value) return o.label
    const inner = o.children ? optionLabel(o.children, value) : null
    if (inner) return inner
  }
  return null
}

/** One answer as plain text: the label of a chosen option, Yes / No, a list joined by commas; '-' when nothing was answered. */
export function answerText(field: FormField | undefined, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '-'
  const one = (v: unknown) => {
    const s = String(v)
    return (field ? optionLabel(field.options, s) : null) ?? s
  }
  if (Array.isArray(raw)) return raw.length === 0 ? '-' : raw.map(one).join(', ')
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  if (typeof raw === 'object') return '-'
  const t = one(raw).replace(/\s+/g, ' ').trim()
  return t === '' ? '-' : t.length > 80 ? `${t.slice(0, 80).trimEnd()}...` : t
}

function fieldsOf(sections: FormSection[]): FormField[] {
  return sections.flatMap((s) => s.fields ?? [])
}

/**
 * The answers of one ticket for the ticked fields. A ticket is matched to a ticked field by the field id, or, when its form is another form (another service of the
 * same sub-category), by the same label.
 */
export function answersFor(ticked: FormField[], formData: Record<string, unknown>, sections: FormSection[]): string[] {
  const own = fieldsOf(sections)
  return ticked.map((t) => {
    const f = own.find((x) => x.id === t.id) ?? own.find((x) => x.label.trim().toLowerCase() === t.label.trim().toLowerCase())
    if (!f) return '-'
    return answerText(f, formData[f.id])
  })
}

const asNumber = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ''))
  return s !== '-' && s.trim() !== '' && Number.isFinite(n) ? n : null
}

export interface EarlierInput {
  requestNo: string
  formData: Record<string, unknown>
  sections: FormSection[]
  outcome: HistoryOutcome
  at: string
  decidedBy: string
  comment: string | null
}

/** Puts the box together: newest first, the first `limit` rows listed, the rest counted, and the totals of the ticked number answers over all approved rows. */
export function assembleHistory(p: {
  storeName: string
  category: string
  ticked: FormField[]
  currentFormData: Record<string, unknown>
  currentSections: FormSection[]
  earlier: EarlierInput[]
  limit?: number
  months?: number
}): ApprovalHistory {
  const limit = p.limit ?? HISTORY_ROWS
  const sorted = [...p.earlier].sort((a, b) => b.at.localeCompare(a.at))
  const rows: HistoryRow[] = sorted.map((e) => ({
    requestNo: e.requestNo, at: e.at, outcome: e.outcome, decidedBy: e.decidedBy, comment: (e.comment ?? '').replace(/\s+/g, ' ').trim(),
    values: answersFor(p.ticked, e.formData, e.sections),
  }))
  const totals: ApprovalHistory['totals'] = []
  p.ticked.forEach((t, i) => {
    if (t.type !== 'number') return
    let total = 0, count = 0
    for (const r of rows) {
      if (r.outcome !== 'approved') continue
      const n = asNumber(r.values[i])
      if (n !== null) { total += n; count++ }
    }
    if (count > 0) totals.push({ label: t.label, total: Math.round(total * 1000) / 1000, count })
  })
  const decided = rows.filter((r) => r.outcome !== 'waiting').length
  const shown = rows.slice(0, limit)
  return {
    storeName: p.storeName,
    category: p.category,
    columns: p.ticked.map((t) => t.label),
    now: answersFor(p.ticked, p.currentFormData, p.currentSections),
    earlier: shown,
    moreCount: Math.max(0, decided - shown.filter((r) => r.outcome !== 'waiting').length),
    totals,
    months: p.months ?? HISTORY_MONTHS,
  }
}

const OUTCOME_LABEL: Record<HistoryOutcome, string> = { approved: 'Approved', rejected: 'Rejected', waiting: 'Waiting for a decision' }
const OUTCOME_COLOUR: Record<HistoryOutcome, string> = { approved: '#15803d', rejected: '#b91c1c', waiting: '#b45309' }

/** "12 Sep 2026" in Indian time */
export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d)
}

const totalSentence = (h: ApprovalHistory) => h.totals.map((t) => `${t.label} ${t.total}`).join(', ')

/** The box as HTML for a mail. Every piece of text that came from a person is escaped here. */
export function approvalHistoryHtml(h: ApprovalHistory): string {
  const e = escapeHtml
  const th = (s: string) => `<th style="text-align:left;border-bottom:1px solid #d1d5db;padding:4px 8px;font-weight:600;">${e(s)}</th>`
  const td = (s: string, extra = '') => `<td style="border-bottom:1px solid #f3f4f6;padding:4px 8px;${extra}">${e(s)}</td>`
  const nowLine = `${h.storeName ? `${e(h.storeName)}: ` : ''}${e(h.category)}${h.columns.length > 0 ? ` - ${h.columns.map((c, i) => `${e(c)} <strong>${e(h.now[i] ?? '-')}</strong>`).join(', ')}` : ''}`
  const head = ['Date', 'Request', ...h.columns, 'Decision'].map(th).join('')
  const body = h.earlier.map((r) => {
    const who = r.outcome === 'waiting' ? '' : r.decidedBy ? ` by ${r.decidedBy}` : ''
    const why = r.outcome === 'rejected' && r.comment ? ` (${r.comment.length > 120 ? `${r.comment.slice(0, 120)}...` : r.comment})` : ''
    return `<tr>${td(shortDate(r.at))}${td(r.requestNo)}${r.values.map((v) => td(v)).join('')}${td(`${OUTCOME_LABEL[r.outcome]}${who}${why}`, `color:${OUTCOME_COLOUR[r.outcome]};`)}</tr>`
  }).join('')
  return `<div style="margin:16px 0 8px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;font-size:13px;">
    <p style="margin:0 0 6px;font-weight:600;">Asking now</p>
    <p style="margin:0 0 12px;">${nowLine}</p>
    <p style="margin:0 0 6px;font-weight:600;">Earlier requests of this store, same sub-category (last ${h.months} months)</p>
    ${h.earlier.length === 0
      ? '<p style="margin:0;color:#6b7280;">No earlier request of this store for this sub-category.</p>'
      : `<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:12px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`}
    ${h.totals.length > 0 ? `<p style="margin:8px 0 0;">Approved in these ${h.months} months: <strong>${e(totalSentence(h))}</strong></p>` : ''}
    ${h.moreCount > 0 ? `<p style="margin:6px 0 0;color:#6b7280;">${h.moreCount} more earlier request${h.moreCount === 1 ? '' : 's'} not listed.</p>` : ''}
  </div>`
}

/** The same box as plain text. */
export function approvalHistoryText(h: ApprovalHistory): string {
  const lines = [`Asking now: ${h.storeName ? `${h.storeName}: ` : ''}${h.category}${h.columns.length > 0 ? ` - ${h.columns.map((c, i) => `${c} ${h.now[i] ?? '-'}`).join(', ')}` : ''}`]
  lines.push(`Earlier requests of this store, same sub-category (last ${h.months} months):`)
  if (h.earlier.length === 0) lines.push('  none')
  for (const r of h.earlier) {
    const who = r.outcome === 'waiting' ? '' : r.decidedBy ? ` by ${r.decidedBy}` : ''
    lines.push(`  ${shortDate(r.at)}  ${r.requestNo}${r.values.length > 0 ? `  ${h.columns.map((c, i) => `${c} ${r.values[i]}`).join(', ')}` : ''}  ${OUTCOME_LABEL[r.outcome]}${who}${r.outcome === 'rejected' && r.comment ? ` (${r.comment})` : ''}`)
  }
  if (h.totals.length > 0) lines.push(`Approved in these ${h.months} months: ${totalSentence(h)}`)
  if (h.moreCount > 0) lines.push(`${h.moreCount} more earlier request${h.moreCount === 1 ? '' : 's'} not listed.`)
  return lines.join('\n')
}
