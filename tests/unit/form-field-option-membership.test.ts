/**
 * Stage 3, Step 11 — validateFieldValue() previously performed zero
 * option-membership validation for select/radio/multiselect: any string (or
 * array of strings) was accepted regardless of the field's configured
 * options, a gap first documented as a known limitation in
 * tests/integration/stage1-1-intake-review-fixes.test.ts. Shared by every
 * channel (web, Email Intake, and now the Stage 3 questionnaire engine), so
 * hardening it here fixes it everywhere at once.
 */
import { describe, it, expect } from 'vitest'
import { validateFieldValue } from '@/lib/validation/formFields'
import type { FormField, FormFieldOption } from '@/types'

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'type' | 'label'>): FormField {
  return { required: false, order: 0, ...overrides }
}

const OPTIONS: FormFieldOption[] = [
  { value: 'hardware', label: 'Hardware' },
  { value: 'software', label: 'Software' },
  { value: 'retired_opt', label: 'Retired Option', is_active: false },
]

const NESTED_OPTIONS: FormFieldOption[] = [
  { value: 'group_a', label: 'Group A', children: [
    { value: 'a1', label: 'A1' },
    { value: 'a2', label: 'A2', is_active: false },
  ] },
  { value: 'group_b', label: 'Group B', children: [
    { value: 'b1', label: 'B1' },
  ] },
]

describe('validateFieldValue() option-membership hardening', () => {
  it('select: rejects a value not in the configured options', () => {
    const f = field({ id: 'issue', type: 'select', label: 'Issue Type', options: OPTIONS })
    expect(validateFieldValue(f, 'not-a-real-option')).toBe('"not-a-real-option" is not a valid option for "Issue Type".')
  })

  it('select: accepts a value that is in the configured options', () => {
    const f = field({ id: 'issue', type: 'select', label: 'Issue Type', options: OPTIONS })
    expect(validateFieldValue(f, 'hardware')).toBeNull()
  })

  it('select: accepts an ARCHIVED option value (a previously-submitted value must keep validating)', () => {
    const f = field({ id: 'issue', type: 'select', label: 'Issue Type', options: OPTIONS })
    expect(validateFieldValue(f, 'retired_opt')).toBeNull()
  })

  it('radio: rejects an out-of-list value', () => {
    const f = field({ id: 'issue', type: 'radio', label: 'Issue Type', options: OPTIONS })
    expect(validateFieldValue(f, 'bogus')).toBe('"bogus" is not a valid option for "Issue Type".')
  })

  it('radio: accepts a configured value', () => {
    const f = field({ id: 'issue', type: 'radio', label: 'Issue Type', options: OPTIONS })
    expect(validateFieldValue(f, 'software')).toBeNull()
  })

  it('multiselect: rejects if any submitted value is out of list', () => {
    const f = field({ id: 'tags', type: 'multiselect', label: 'Tags', options: OPTIONS })
    expect(validateFieldValue(f, ['hardware', 'bogus'])).toBe('"bogus" is not a valid option for "Tags".')
  })

  it('multiselect: accepts an all-valid array, archived values included', () => {
    const f = field({ id: 'tags', type: 'multiselect', label: 'Tags', options: OPTIONS })
    expect(validateFieldValue(f, ['hardware', 'retired_opt'])).toBeNull()
  })

  it('select: nested/grouped options — a leaf value validates, a group-header value does not', () => {
    const f = field({ id: 'cat', type: 'select', label: 'Category', options: NESTED_OPTIONS })
    expect(validateFieldValue(f, 'a1')).toBeNull()
    expect(validateFieldValue(f, 'b1')).toBeNull()
    expect(validateFieldValue(f, 'a2')).toBeNull() // archived leaf, still valid
    expect(validateFieldValue(f, 'group_a')).toBe('"group_a" is not a valid option for "Category".')
  })

  it('select: a field with NO options configured is never option-checked (pre-existing fields without metadata are not newly broken)', () => {
    const f = field({ id: 'issue', type: 'select', label: 'Issue Type' })
    expect(validateFieldValue(f, 'anything')).toBeNull()
  })

  it('checkbox: boolean semantics only — no option-membership check applies', () => {
    const f = field({ id: 'agree', type: 'checkbox', label: 'I Agree', options: OPTIONS })
    expect(validateFieldValue(f, true)).toBeNull()
    expect(validateFieldValue(f, 'anything')).toBeNull()
  })

  it('toggle: boolean semantics only — no option-membership check applies', () => {
    const f = field({ id: 'flag', type: 'toggle', label: 'Flag', options: OPTIONS })
    expect(validateFieldValue(f, true)).toBeNull()
  })

  it('empty value on a select still short-circuits to the required/empty check, never the option check', () => {
    const f = field({ id: 'issue', type: 'select', label: 'Issue Type', options: OPTIONS, required: true })
    expect(validateFieldValue(f, '')).toBe('Issue Type is required.')
  })
})
