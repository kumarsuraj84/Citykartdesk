/**
 * Stage 2 — normalizeMobileNumber(). India-only, canonical bare 10-digit
 * output. Pure function, no DB.
 */
import { describe, it, expect } from 'vitest'
import { normalizeMobileNumber } from '@/lib/users/mobile'

describe('normalizeMobileNumber()', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['+91-98765-43210', '9876543210'],
    ['  9876543210  ', '9876543210'], // surrounding whitespace
    ['91-98765-43210', '9876543210'], // bare 91 prefix with separators
    ['(987) 654-3210', '9876543210'], // parens/dashes only, no country code
  ])('%s → %s', (input, expected) => {
    const result = normalizeMobileNumber(input)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.normalized).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['123'],
    ['98765'],
    ['abcdefghij'],
    ['++++919876543210'],
    ['+14155552671'],      // non-Indian E.164 — explicitly out of scope now
    ['+442079460958'],     // non-Indian E.164
    ['5876543210'],        // 10 digits but first digit 5 — not a mobile series
    ['0876543210'],        // 10 digits, first digit 0
    ['98765432100'],       // 11 digits, not a valid 0-prefix shape (doesn't start with 0)
    ['919876543211234'],   // way too long
    ['0123456789'],        // 10 digits, first digit 0 — not the 11-digit 0-prefix shape, and not a valid mobile series bare
  ])('rejects %s', (input) => {
    const result = normalizeMobileNumber(input)
    expect(result.ok).toBe(false)
  })

  it('never returns ok:true for an empty or whitespace-only input', () => {
    expect(normalizeMobileNumber('').ok).toBe(false)
    expect(normalizeMobileNumber('   ').ok).toBe(false)
  })

  it('a bare 10-digit number starting with "91" is disambiguated by LENGTH, not by its leading digits — treated as a plain 10-digit mobile number, not a 91-country-code-prefixed one', () => {
    // "9187654321" is exactly 10 digits — the 91-prefix-stripping branch
    // only applies to a 12-digit total input, so this is correctly read as
    // a bare number in its own right (and happens to be valid: starts with
    // 9, which is in the 6-9 mobile range).
    const result = normalizeMobileNumber('9187654321')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.normalized).toBe('9187654321')
  })
})
