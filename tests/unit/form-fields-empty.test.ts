import { describe, it, expect } from 'vitest'
import { isFieldValueEmpty } from '@/lib/validation/formFields'

describe('B-16: isFieldValueEmpty', () => {
  it('spaces only (or tabs / new lines) is not an answer', () => {
    for (const v of ['', ' ', '   ', '\t', ' \n ']) expect(isFieldValueEmpty(v, 'text'), JSON.stringify(v)).toBe(true)
  })
  it('real text is an answer, with or without surrounding spaces', () => {
    expect(isFieldValueEmpty('x', 'text')).toBe(false)
    expect(isFieldValueEmpty('  hello  ', 'textarea')).toBe(false)
  })
  it('the other rules are unchanged', () => {
    expect(isFieldValueEmpty(undefined)).toBe(true)
    expect(isFieldValueEmpty(null)).toBe(true)
    expect(isFieldValueEmpty(false, 'text')).toBe(true)
    expect(isFieldValueEmpty([])).toBe(true)
    expect(isFieldValueEmpty(['a'])).toBe(false)
    expect(isFieldValueEmpty(0, 'number')).toBe(false)
    expect(isFieldValueEmpty(false, 'checkbox')).toBe(false)
    expect(isFieldValueEmpty(undefined, 'toggle')).toBe(true)
  })
})
