/** Stage 3, Step 3 — deterministic keyword scoring for issue search over
 *  Sub-categories. No AI/embeddings; pure and independently testable. */
import { describe, it, expect } from 'vitest'
import { scoreSubCategoryMatch } from '@/lib/requests/questionnaire/catalog'

describe('scoreSubCategoryMatch()', () => {
  it('exact match (case-insensitive) scores highest', () => {
    expect(scoreSubCategoryMatch('AC Not Cooling', 'ac not cooling')).toBe(100)
  })

  it('prefix match scores high', () => {
    expect(scoreSubCategoryMatch('ac not', 'AC Not Cooling')).toBe(80)
  })

  it('substring match scores medium', () => {
    expect(scoreSubCategoryMatch('cooling', 'AC Not Cooling')).toBe(60)
  })

  it('partial word overlap scores lower, proportional to overlap', () => {
    const score = scoreSubCategoryMatch('cooling issue', 'AC Not Cooling')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(60)
  })

  it('no overlap scores 0', () => {
    expect(scoreSubCategoryMatch('printer jam', 'AC Not Cooling')).toBe(0)
  })

  it('empty query scores 0', () => {
    expect(scoreSubCategoryMatch('', 'AC Not Cooling')).toBe(0)
  })

  it('empty name scores 0', () => {
    expect(scoreSubCategoryMatch('ac', '')).toBe(0)
  })
})
