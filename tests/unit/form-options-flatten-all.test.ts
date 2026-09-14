import { describe, it, expect } from 'vitest'
import { flattenAllLeafOptions } from '@/lib/forms/options'
import type { FormFieldOption } from '@/types'

describe('flattenAllLeafOptions()', () => {
  it('returns an empty array for undefined options', () => {
    expect(flattenAllLeafOptions(undefined)).toEqual([])
  })

  it('flattens a flat list, keeping archived leaves', () => {
    const options: FormFieldOption[] = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', is_active: false },
    ]
    expect(flattenAllLeafOptions(options)).toEqual([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }])
  })

  it('flattens a nested tree, dropping only group headers (not leaves) regardless of is_active', () => {
    const options: FormFieldOption[] = [
      {
        value: 'group', label: 'Group', is_active: false,
        children: [
          { value: 'c1', label: 'C1' },
          { value: 'c2', label: 'C2', is_active: false },
        ],
      },
    ]
    expect(flattenAllLeafOptions(options)).toEqual([{ value: 'c1', label: 'C1' }, { value: 'c2', label: 'C2' }])
  })
})
