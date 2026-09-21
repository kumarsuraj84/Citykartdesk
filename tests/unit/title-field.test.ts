import { describe, it, expect } from 'vitest'
import { pickTitleField, subjectToTitle } from '@/lib/requests/title-field'

const it_template = [
  { id: 'phone', type: 'phone', label: 'Contact Number' },
  { id: 'serial', type: 'text', label: 'Serial Number' },
  { id: 'subject', type: 'text', label: 'Subject' },
  { id: 'desc', type: 'textarea', label: 'Description' },
]

describe('ticket title = the Subject field', () => {
  it('picks Subject even when other text fields (Serial Number) come first — the reported bug', () => {
    const r = pickTitleField(it_template, { serial: 'N/A', subject: 'Email password issue', desc: 'x' })
    expect(r.field?.id).toBe('subject')
    expect(r.isSubject).toBe(true)
  })

  it.each([
    ['Finance', [{ id: 'inv', type: 'text', label: 'Invoice Number' }, { id: 'holder', type: 'text', label: 'A/C Holder Name' }, { id: 's', type: 'text', label: 'Subject' }]],
    ['AC', [{ id: 'oem', type: 'text', label: 'AC OEM Ticket Number' }, { id: 's', type: 'text', label: 'Subject' }]],
    ['HR', [{ id: 'emp', type: 'text', label: 'Employee Code' }, { id: 's', type: 'text', label: 'Subject' }]],
    ['VM', [{ id: 'who', type: 'text', label: 'Contact Person Name' }, { id: 'emp', type: 'text', label: 'Employee Code' }, { id: 's', type: 'text', label: 'Subject' }]],
  ])('%s template: Subject wins over earlier text fields', (_n, fields) => {
    const data = Object.fromEntries(fields.map((f) => [f.id, `value of ${f.label}`]))
    expect(pickTitleField(fields, data).field?.label).toBe('Subject')
  })

  it('accepts common spellings of the label', () => {
    for (const label of ['subject', 'SUBJECT', ' Subject: ', 'Ticket Subject', 'Title', 'Summary']) {
      const f = [{ id: 'a', type: 'text', label: 'Serial No' }, { id: 'b', type: 'text', label }]
      expect(pickTitleField(f, { a: '1', b: 'hello' }).field?.id).toBe('b')
    }
  })

  it('does not treat unrelated labels as a subject', () => {
    const f = [{ id: 'a', type: 'text', label: 'Subject Matter Expert' }, { id: 'b', type: 'text', label: 'Serial No' }]
    const r = pickTitleField(f, { a: 'Ravi', b: '123' })
    expect(r.isSubject).toBe(false)
    expect(r.field?.id).toBe('a') // old behaviour: first text field
  })

  it('falls back to the old order when the Subject is empty or missing', () => {
    expect(pickTitleField(it_template, { serial: '123', subject: '   ' })).toMatchObject({ isSubject: false, field: { id: 'serial' } })
    expect(pickTitleField([{ id: 'x', type: 'select', label: 'Kind' }], { x: 'a' }).field?.id).toBe('x')
    expect(pickTitleField([{ id: 'x', type: 'phone', label: 'Phone' }], { x: '1' }).field).toBeUndefined()
  })

  it('keeps a subject on one line and caps its length', () => {
    expect(subjectToTitle('  Email\n  password   issue ')).toBe('Email password issue')
    expect(subjectToTitle('a'.repeat(500))).toHaveLength(200)
  })
})
