// An administrator sets, while designing a form, which numbers a number field accepts (smallest, largest, whole numbers only).
// The limits are checked in the browser box and again by the server; a broken limit (above/below each other, not a number) is refused when the form is saved.
import { describe, it, expect } from 'vitest'
import { validateFieldValue, numberLimitProblem } from '@/lib/validation/formFields'
import type { FormField } from '@/types'

const qty = (validation?: FormField['validation'], extra: Partial<FormField> = {}): FormField => ({
  id: 'qty', type: 'number', label: 'Qty', required: true, order: 1, validation, ...extra,
})

describe('a number field with limits', () => {
  const f = qty({ min: 1, max: 10000 })
  it('accepts numbers from the smallest to the largest, ends included', () => {
    for (const v of ['1', '2', 500, '10000']) expect(validateFieldValue(f, v, 'requester'), String(v)).toBeNull()
  })
  it('refuses a number below the smallest or above the largest, saying which limit', () => {
    expect(validateFieldValue(f, '0', 'requester')).toMatch(/at least 1/)
    expect(validateFieldValue(f, '-5', 'requester')).toMatch(/at least 1/)
    expect(validateFieldValue(f, '10001', 'requester')).toMatch(/at most 10000/)
    expect(validateFieldValue(f, '250000', 'requester')).toMatch(/at most 10000/)
  })
  it('a different limit set by the administrator applies instead (1 to 100)', () => {
    const g = qty({ min: 1, max: 100 })
    expect(validateFieldValue(g, '100', 'requester')).toBeNull()
    expect(validateFieldValue(g, '101', 'requester')).toMatch(/at most 100/)
  })
  it('no limit means any number; only a number is accepted', () => {
    expect(validateFieldValue(qty(), '99999999', 'requester')).toBeNull()
    expect(validateFieldValue(qty(), 'abc', 'requester')).toMatch(/must be a number/)
  })
  it('only the smallest, or only the largest, can be set', () => {
    expect(validateFieldValue(qty({ min: 5 }), '4', 'requester')).toMatch(/at least 5/)
    expect(validateFieldValue(qty({ min: 5 }), '5000000', 'requester')).toBeNull()
    expect(validateFieldValue(qty({ max: 5 }), '6', 'requester')).toMatch(/at most 5/)
  })
  it('"whole numbers only" refuses decimals but accepts whole numbers', () => {
    const w = qty({ min: 1, max: 100, integer: true })
    expect(validateFieldValue(w, '2.5', 'requester')).toMatch(/whole number/)
    expect(validateFieldValue(w, '3', 'requester')).toBeNull()
    expect(validateFieldValue(qty({ min: 1, max: 100 }), '2.5', 'requester')).toBeNull()   // decimals stay allowed unless the box is ticked
  })
})

describe('numberLimitProblem (checked before a form is saved)', () => {
  it('is fine when the limits make sense, or when there are none', () => {
    expect(numberLimitProblem(qty())).toBeNull()
    expect(numberLimitProblem(qty({ min: 1, max: 10000 }))).toBeNull()
    expect(numberLimitProblem(qty({ min: 5, max: 5 }))).toBeNull()
    expect(numberLimitProblem(qty({ integer: true }))).toBeNull()
  })
  it('refuses a smallest number above the largest, in plain words', () => {
    expect(numberLimitProblem(qty({ min: 100, max: 10 }))).toMatch(/smallest number \(100\) is above the largest number \(10\)/)
  })
  it('refuses limits that are not real numbers', () => {
    expect(numberLimitProblem(qty({ min: Number.NaN }))).toMatch(/must be numbers/)
    expect(numberLimitProblem(qty({ max: Number.POSITIVE_INFINITY }))).toMatch(/must be numbers/)
    expect(numberLimitProblem(qty({ min: '1' as unknown as number }))).toMatch(/must be numbers/)
  })
  it('only concerns number fields', () => {
    expect(numberLimitProblem({ type: 'text', label: 'Subject', validation: { min: 9, max: 1 } })).toBeNull()
  })
})

// ── text and long-text fields: shortest / longest length ────────────────────────────────────────────────────────────────────────────
import { textLimitProblem, fieldLimitProblem } from '@/lib/validation/formFields'

const text = (validation?: FormField['validation'], type: 'text' | 'textarea' = 'text'): FormField => ({ id: 't', type, label: 'Subject', required: true, order: 1, validation })

describe('a text field with a shortest and a longest length', () => {
  const f = text({ min_length: 5, max_length: 20 })
  it('accepts a length from the shortest to the longest, ends included', () => {
    expect(validateFieldValue(f, 'abcde', 'requester')).toBeNull()
    expect(validateFieldValue(f, 'a'.repeat(20), 'requester')).toBeNull()
  })
  it('refuses a text that is too short or too long, saying which limit', () => {
    expect(validateFieldValue(f, 'abcd', 'requester')).toMatch(/at least 5 characters/)
    expect(validateFieldValue(f, 'a'.repeat(21), 'requester')).toMatch(/at most 20 characters/)
  })
  it('works the same for a long-text field, and with no limit anything is accepted', () => {
    expect(validateFieldValue(text({ max_length: 3 }, 'textarea'), 'abcd', 'requester')).toMatch(/at most 3/)
    expect(validateFieldValue(text(), 'a'.repeat(5000), 'requester')).toBeNull()
  })
})

describe('textLimitProblem / fieldLimitProblem (checked before a form is saved)', () => {
  it('is fine when the lengths make sense, or when there are none', () => {
    expect(textLimitProblem(text())).toBeNull()
    expect(textLimitProblem(text({ min_length: 0, max_length: 500 }))).toBeNull()
    expect(textLimitProblem(text({ min_length: 10, max_length: 10 }))).toBeNull()
  })
  it('refuses a shortest length above the longest, in plain words', () => {
    expect(textLimitProblem(text({ min_length: 50, max_length: 10 }))).toMatch(/shortest length \(50\) is above the longest length \(10\)/)
  })
  it('refuses lengths that are not whole numbers or are below 0', () => {
    expect(textLimitProblem(text({ min_length: -1 }))).toMatch(/whole numbers/)
    expect(textLimitProblem(text({ max_length: 2.5 }))).toMatch(/whole numbers/)
    expect(textLimitProblem(text({ max_length: Number.NaN }))).toMatch(/whole numbers/)
  })
  it('fieldLimitProblem covers number and text fields, and ignores other types', () => {
    expect(fieldLimitProblem(qty({ min: 9, max: 1 }))).toMatch(/smallest number/)
    expect(fieldLimitProblem(text({ min_length: 9, max_length: 1 }))).toMatch(/shortest length/)
    expect(fieldLimitProblem({ type: 'select', label: 'X', validation: { min: 9, max: 1, min_length: 9, max_length: 1 } })).toBeNull()
  })
})
