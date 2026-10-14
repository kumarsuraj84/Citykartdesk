import { describe, it, expect } from 'vitest'
import { isValidOpenDate } from '@/lib/stores/open-date'

describe('a store\'s open date', () => {
  it('accepts a real calendar day, as the date box writes it', () => {
    for (const d of ['2026-10-07', '2024-02-29', '2000-01-01', '2026-12-31']) expect(isValidOpenDate(d), d).toBe(true)
  })
  it('refuses days that do not exist and anything not written YYYY-MM-DD', () => {
    for (const d of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '07-10-2026', '2026/10/07', '2026-1-7', 'dddd-dd-dd', 'today', '', ' 2026-10-07', '2026-10-07 ', '2026-10-07T00:00:00'])
      expect(isValidOpenDate(d), JSON.stringify(d)).toBe(false)
  })
})
