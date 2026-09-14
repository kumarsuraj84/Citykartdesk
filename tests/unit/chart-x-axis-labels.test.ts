/**
 * DESK-UI-005 — Analytics "Volume Trend" chart X-axis label collision.
 *
 * Root cause: selectXAxisLabelIndices (formerly inlined in LineAreaChart)
 * always force-included the final data index in addition to every `step`th
 * index — whenever data.length wasn't a clean multiple of step, the last
 * step-selected index and the forced final index landed within a fraction
 * of a step of each other, rendering two overlapping labels at the right
 * edge (confirmed live at 768px as "09-0"/"09-08" merging into
 * "09-009-08"). Fix: only force the final index in when it isn't already
 * near the last step-selected one.
 */
import { describe, it, expect } from 'vitest'
import { selectXAxisLabelIndices } from '@/components/analytics/Charts'

function minGap(indices: number[]): number {
  if (indices.length < 2) return Infinity
  let min = Infinity
  for (let i = 1; i < indices.length; i++) min = Math.min(min, indices[i] - indices[i - 1])
  return min
}

describe('selectXAxisLabelIndices()', () => {
  it('an empty dataset renders no labels (and does not throw)', () => {
    expect(selectXAxisLabelIndices(0)).toEqual([])
  })

  it('a single data point renders exactly one label', () => {
    expect(selectXAxisLabelIndices(1)).toEqual([0])
  })

  it('a small dataset (fewer than the ~7-label target) shows every point, no duplicate-at-the-end collision', () => {
    // length=5, step=max(1, floor(5/7))=1 → every index is a "step" index,
    // so index 4 is already included — must not appear twice.
    const indices = selectXAxisLabelIndices(5)
    expect(indices).toEqual([0, 1, 2, 3, 4])
    expect(new Set(indices).size).toBe(indices.length) // no duplicates
  })

  it('the reported collision shape: a length that is NOT a clean multiple of step no longer crams two labels together at the end', () => {
    // length=9 → step = floor(9/7) = 1, every index already included,
    // last index (8) is already the final step index — not force-duplicated.
    // Use a length that actually produces step > 1 with a close-but-not-equal
    // last index: length=30 → step=4 → step indices 0,4,8,...,28; last=29,
    // 29-28=1 < step/2(=2) → must NOT add 29 as a second, near-duplicate label.
    const indices = selectXAxisLabelIndices(30)
    expect(indices).toEqual([0, 4, 8, 12, 16, 20, 24, 28])
    expect(indices).not.toContain(29)
    expect(minGap(indices)).toBeGreaterThanOrEqual(4)
  })

  it('a length whose last index is genuinely far from the last step index still anchors the right edge with a label', () => {
    // length=25 → step=3 → step indices 0,3,...,24 (24 IS the last index
    // already, since 24%3===0) — nothing to force-add, no duplicate.
    // length=26 → step=3 → step indices 0,3,...,24; last=25, 25-24=1 < 1.5 → not added.
    // length=32 → step=4 → step indices 0,4,...,28; last=31, 31-28=3 >= 2 → added.
    const indices = selectXAxisLabelIndices(32)
    expect(indices[indices.length - 1]).toBe(31)
    expect(minGap(indices)).toBeGreaterThanOrEqual(2) // the forced-in last point may sit closer than `step`, but never collides (gap 0)
  })

  it('every returned index set is strictly increasing with no duplicate indices, for a range of realistic trend lengths (7/30/90-day windows)', () => {
    for (const length of [7, 14, 30, 60, 90, 91, 89, 13, 8]) {
      const indices = selectXAxisLabelIndices(length)
      const unique = new Set(indices)
      expect(unique.size).toBe(indices.length)
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1])
      }
    }
  })

  it('never places two labels at the exact same index (the literal rendering-on-top-of-each-other defect)', () => {
    for (let length = 1; length <= 120; length++) {
      const indices = selectXAxisLabelIndices(length)
      expect(new Set(indices).size).toBe(indices.length)
    }
  })
})
