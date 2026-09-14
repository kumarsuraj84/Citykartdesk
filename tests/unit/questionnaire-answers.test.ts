/** Stage 3, Step 12 — applyQuestionAnswer(): type-specific normalization +
 *  validation via the shared validateFieldValue(), including Step 11's new
 *  option-membership check. Pure, no DB. */
import { describe, it, expect } from 'vitest'
import type { FormField } from '@/types'
import { applyQuestionAnswer } from '@/lib/requests/questionnaire/answers'

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'type' | 'label'>): FormField {
  return { required: false, order: 0, ...overrides }
}

describe('applyQuestionAnswer()', () => {
  it('text: trims whitespace and applies the answer', () => {
    const f = field({ id: 'subject', type: 'text', label: 'Subject' })
    const result = applyQuestionAnswer({ field: f, rawValue: '  AC not cooling  ', answers: {} })
    expect(result).toEqual({ ok: true, answers: { subject: 'AC not cooling' } })
  })

  it('does not mutate the input answers object', () => {
    const f = field({ id: 'subject', type: 'text', label: 'Subject' })
    const answers = { other: 'x' }
    applyQuestionAnswer({ field: f, rawValue: 'y', answers })
    expect(answers).toEqual({ other: 'x' })
  })

  it('number: coerces a numeric string', () => {
    const f = field({ id: 'count', type: 'number', label: 'Count' })
    const result = applyQuestionAnswer({ field: f, rawValue: '42', answers: {} })
    expect(result).toEqual({ ok: true, answers: { count: 42 } })
  })

  it('number: rejects a non-numeric string via the shared validator', () => {
    const f = field({ id: 'count', type: 'number', label: 'Count' })
    const result = applyQuestionAnswer({ field: f, rawValue: 'abc', answers: {} })
    expect(result.ok).toBe(false)
  })

  it('checkbox: normalizes "yes"/"no" strings to booleans', () => {
    const f = field({ id: 'agree', type: 'checkbox', label: 'Agree' })
    expect(applyQuestionAnswer({ field: f, rawValue: 'yes', answers: {} })).toEqual({ ok: true, answers: { agree: true } })
    expect(applyQuestionAnswer({ field: f, rawValue: 'no', answers: {} })).toEqual({ ok: true, answers: { agree: false } })
  })

  it('toggle: same boolean normalization as checkbox', () => {
    const f = field({ id: 'flag', type: 'toggle', label: 'Flag' })
    expect(applyQuestionAnswer({ field: f, rawValue: 'true', answers: {} })).toEqual({ ok: true, answers: { flag: true } })
  })

  it('multiselect: wraps a lone value into an array', () => {
    const f = field({ id: 'tags', type: 'multiselect', label: 'Tags', options: [{ value: 'a', label: 'A' }] })
    const result = applyQuestionAnswer({ field: f, rawValue: 'a', answers: {} })
    expect(result).toEqual({ ok: true, answers: { tags: ['a'] } })
  })

  it('select: rejects a value outside the configured options (Step 11 hardening applies here too)', () => {
    const f = field({ id: 'issue', type: 'select', label: 'Issue Type', options: [{ value: 'hardware', label: 'Hardware' }] })
    const result = applyQuestionAnswer({ field: f, rawValue: 'bogus', answers: {} })
    expect(result).toEqual({ ok: false, error: '"bogus" is not a valid option for "Issue Type".' })
  })

  it('file: always rejected — this engine has no attachment-collection mechanism', () => {
    const f = field({ id: 'photo', type: 'file', label: 'Photo' })
    const result = applyQuestionAnswer({ field: f, rawValue: 'whatever', answers: {} })
    expect(result.ok).toBe(false)
  })

  it('store_address: always rejected — system-populated, never answerable directly', () => {
    const f = field({ id: 'addr', type: 'store_address', label: 'Store Address' })
    const result = applyQuestionAnswer({ field: f, rawValue: '123 Main St', answers: {} })
    expect(result.ok).toBe(false)
  })

  it('phone: does not read from any external identity source — purely the raw answer, trimmed', () => {
    const f = field({ id: 'phone', type: 'phone', label: 'Phone' })
    const result = applyQuestionAnswer({ field: f, rawValue: '9876543210', answers: {} })
    expect(result).toEqual({ ok: true, answers: { phone: '9876543210' } })
  })
})
