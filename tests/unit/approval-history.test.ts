import { describe, expect, it } from 'vitest'
import { answerText, answersFor, approvalHistoryHtml, approvalHistoryText, assembleHistory, tickedFields, type EarlierInput } from '@/lib/approvals/history-model'
import { approvalRequiredEmail } from '@/lib/email/templates'
import type { FormField, FormSection } from '@/types'

const f = (id: string, label: string, extra: Partial<FormField> = {}): FormField => ({ id, type: 'text', label, required: false, order: 0, ...extra })
const sec = (fields: FormField[], id = 's1', order = 0): FormSection => ({ id, title: 'Details', order, fields })

const qty = f('qty', 'Qty', { type: 'number', show_in_approval_history: true })
const size = f('size', 'Size', { type: 'select', show_in_approval_history: true, options: [{ value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }] })
const note = f('note', 'Note')
const form = [sec([note, qty, size])]

const earlier = (no: string, at: string, outcome: EarlierInput['outcome'], data: Record<string, unknown>, by = 'Rakesh CVM', comment: string | null = null): EarlierInput =>
  ({ requestNo: no, formData: data, sections: form, outcome, at, decidedBy: outcome === 'waiting' ? '' : by, comment })

describe('which answers are shown', () => {
  it('takes only the ticked fields, in form order, once per label', () => {
    expect(tickedFields(form).map((x) => x.label)).toEqual(['Qty', 'Size'])
    expect(tickedFields([sec([note])])).toEqual([])
    expect(tickedFields([sec([qty]), sec([f('q2', 'qty', { show_in_approval_history: true })], 's2', 1)]).map((x) => x.id)).toEqual(['qty'])
  })

  it('writes an answer the way a person reads it', () => {
    expect(answerText(size, 'l')).toBe('Large')
    expect(answerText(qty, 4)).toBe('4')
    expect(answerText(f('t', 'Toggle', { type: 'toggle' }), true)).toBe('Yes')
    expect(answerText(size, ['m', 'l'])).toBe('Medium, Large')
    expect(answerText(qty, '')).toBe('-')
    expect(answerText(qty, undefined)).toBe('-')
  })

  it('finds the answer on another form by the same label', () => {
    const other = [sec([f('zz', ' QTY ', { type: 'number' })])]
    expect(answersFor([qty], { zz: 7 }, other)).toEqual(['7'])
    expect(answersFor([qty], {}, [sec([note])])).toEqual(['-'])
  })
})

describe('the box', () => {
  const rows = [
    earlier('CKSD-1', '2026-05-18T10:00:00Z', 'rejected', { qty: 2 }, 'Rakesh CVM', 'not needed'),
    earlier('CKSD-2', '2026-07-03T10:00:00Z', 'approved', { qty: 10, size: 'l' }),
    earlier('CKSD-3', '2026-09-12T10:00:00Z', 'approved', { qty: 4, size: 'm' }),
    earlier('CKSD-4', '2026-10-20T10:00:00Z', 'waiting', { qty: 99 }),
  ]
  const h = assembleHistory({ storeName: 'Jaipur-12 (J12)', category: 'Fixtures > Shelving', ticked: tickedFields(form), currentFormData: { qty: 6, size: 'm' }, currentSections: form, earlier: rows })

  it('shows what is asked now and the earlier rows newest first', () => {
    expect(h.columns).toEqual(['Qty', 'Size'])
    expect(h.now).toEqual(['6', 'Medium'])
    expect(h.earlier.map((r) => r.requestNo)).toEqual(['CKSD-4', 'CKSD-3', 'CKSD-2', 'CKSD-1'])
    expect(h.earlier[1].values).toEqual(['4', 'Medium'])
    expect(h.earlier[0].outcome).toBe('waiting')
  })

  it('adds up only the approved quantities, not rejected or waiting ones', () => {
    expect(h.totals).toEqual([{ label: 'Qty', total: 14, count: 2 }])
  })

  it('lists at most the limit and says how many decided ones are left out', () => {
    const small = assembleHistory({ storeName: '', category: 'Fixtures', ticked: tickedFields(form), currentFormData: {}, currentSections: form, earlier: rows, limit: 2 })
    expect(small.earlier).toHaveLength(2)
    expect(small.moreCount).toBe(2)
    expect(small.totals[0].total).toBe(14)
  })

  it('works for a form with nothing ticked: only the facts every ticket has', () => {
    const plain = assembleHistory({ storeName: 'Jaipur-12', category: 'Fixtures > Shelving', ticked: [], currentFormData: {}, currentSections: [sec([note])], earlier: rows })
    expect(plain.columns).toEqual([])
    expect(plain.totals).toEqual([])
    const html = approvalHistoryHtml(plain)
    expect(html).toContain('CKSD-3')
    expect(html).toContain('Approved by Rakesh CVM')
    expect(html).not.toContain('<th style="text-align:left;border-bottom:1px solid #d1d5db;padding:4px 8px;font-weight:600;">Qty')
  })

  it('draws the mail box with the totals, the reason of a rejection and no raw HTML from a person', () => {
    const html = approvalHistoryHtml(h)
    expect(html).toContain('Asking now')
    expect(html).toContain('Qty <strong>6</strong>')
    expect(html).toContain('Rejected by Rakesh CVM (not needed)')
    expect(html).toContain('Waiting for a decision')
    expect(html).toContain('Approved in these 12 months: <strong>Qty 14</strong>')
    const evil = assembleHistory({ storeName: '<b>S</b>', category: 'C', ticked: [qty], currentFormData: { qty: '<img src=x>' }, currentSections: form, earlier: [earlier('CKSD-9', '2026-09-01T10:00:00Z', 'rejected', { qty: 1 }, '<i>X</i>', '<script>alert(1)</script>')] })
    const evilHtml = approvalHistoryHtml(evil)
    expect(evilHtml).not.toContain('<script>')
    expect(evilHtml).not.toContain('<img src=x>')
    expect(evilHtml).not.toContain('<b>S</b>')
    expect(evilHtml).toContain('&lt;script&gt;')
  })

  it('also writes the plain-text version', () => {
    const t = approvalHistoryText(h)
    expect(t).toContain('Asking now: Jaipur-12 (J12): Fixtures > Shelving - Qty 6, Size Medium')
    expect(t).toContain('Approved in these 12 months: Qty 14')
  })
})

describe('the approval mail', () => {
  const base = { approverName: 'Rakesh', requestTitle: 'CKSD-5 - Shelves', requestUrl: 'http://app.test/requests/5', requesterName: 'Store Jaipur', senderName: 'The system', kind: 'new' as const }
  it('carries the box when there is one, and is unchanged when there is none', () => {
    const h = assembleHistory({ storeName: 'Jaipur-12', category: 'Fixtures > Shelving', ticked: [qty], currentFormData: { qty: 6 }, currentSections: form, earlier: [earlier('CKSD-3', '2026-09-12T10:00:00Z', 'approved', { qty: 4 })] })
    const withBox = approvalRequiredEmail({ ...base, history: h })
    expect(withBox.html).toContain('Earlier requests of this store')
    expect(withBox.text).toContain('Earlier requests of this store')
    const without = approvalRequiredEmail({ ...base, history: null })
    expect(without.html).not.toContain('Earlier requests')
    expect(approvalRequiredEmail(base).html).toBe(without.html)
  })
})
