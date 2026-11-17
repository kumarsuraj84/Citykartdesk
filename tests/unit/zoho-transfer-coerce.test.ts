import { describe, expect, it } from 'vitest'
import { coerceFieldValue, formDataEntry } from '@/lib/zoho/transfer/coerce'

const select = { id: 'f', type: 'select', label: 'AC type', options: [{ value: 'split', label: 'Split AC' }, { value: 'window', label: 'Window AC' }, { value: 'old', label: 'Old', is_active: false }] }

describe('Zoho value into a CK Desk form field', () => {
  it('fills a dropdown only with a choice that really exists, by value or by label', () => {
    expect(coerceFieldValue(select, 'Split AC')).toEqual({ ok: true, value: 'split' })
    expect(coerceFieldValue(select, ' window ac ')).toEqual({ ok: true, value: 'window' })
    expect(coerceFieldValue(select, 'split')).toEqual({ ok: true, value: 'split' })
  })
  it('does not guess: an unknown or retired choice is refused with a reason', () => {
    expect(coerceFieldValue(select, 'Cassette AC').ok).toBe(false)
    expect(coerceFieldValue(select, 'Old').ok).toBe(false)
  })
  it('handles numbers, dates, yes/no and e-mail', () => {
    expect(coerceFieldValue({ id: 'n', type: 'number' }, '1,250')).toEqual({ ok: true, value: 1250 })
    expect(coerceFieldValue({ id: 'n', type: 'number' }, 'abc').ok).toBe(false)
    expect(coerceFieldValue({ id: 'd', type: 'date' }, '2026-03-04T10:00:00Z')).toEqual({ ok: true, value: '2026-03-04' })
    expect(coerceFieldValue({ id: 'd', type: 'date' }, 'not a date').ok).toBe(false)
    expect(coerceFieldValue({ id: 'c', type: 'toggle' }, 'Yes')).toEqual({ ok: true, value: true })
    expect(coerceFieldValue({ id: 'c', type: 'checkbox' }, 'no')).toEqual({ ok: true, value: false })
    expect(coerceFieldValue({ id: 'c', type: 'checkbox' }, 'maybe').ok).toBe(false)
    expect(coerceFieldValue({ id: 'e', type: 'email' }, 'a@b.co')).toEqual({ ok: true, value: 'a@b.co' })
    expect(coerceFieldValue({ id: 'e', type: 'email' }, 'nope').ok).toBe(false)
  })
  it('keeps plain text as it is, refuses an empty value and a field Zoho cannot fill', () => {
    expect(coerceFieldValue({ id: 't', type: 'text' }, '  hello ')).toEqual({ ok: true, value: 'hello' })
    expect(coerceFieldValue({ id: 't', type: 'text' }, '   ').ok).toBe(false)
    expect(coerceFieldValue({ id: 'x', type: 'file' }, 'a.pdf').ok).toBe(false)
  })
  it('a multi-select stores a list', () => {
    expect(formDataEntry({ id: 'm', type: 'multiselect' }, 'a')).toEqual(['a'])
    expect(formDataEntry({ id: 't', type: 'text' }, 'a')).toBe('a')
  })
})
