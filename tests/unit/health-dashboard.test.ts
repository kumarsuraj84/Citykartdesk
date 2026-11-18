// The helpers behind the Health dashboard's figures and line charts.
import { describe, it, expect } from 'vitest'
import { average, deltaPct, describeDelta, niceMax, axisTicks, formatAxis, splitOnGaps, medianGap, linePath, timeTicks, formatTick } from '@/lib/health/dashboard'

describe('figures against the average', () => {
  it('average ignores nothing but non-numbers; empty is null', () => {
    expect(average([2, 4, 6])).toBe(4)
    expect(average([])).toBeNull()
  })
  it('delta is the distance from the average in percent, null when there is nothing to compare', () => {
    expect(deltaPct(150, 100)).toBe(50)
    expect(deltaPct(50, 100)).toBe(-50)
    expect(deltaPct(5, 0)).toBeNull()
    expect(deltaPct(null, 100)).toBeNull()
    expect(deltaPct(5, null)).toBeNull()
  })
  it('says it in words: up, down, flat (within 1%), or no comparison', () => {
    expect(describeDelta(106)).toEqual({ text: '106%', dir: 'up' })
    expect(describeDelta(-8)).toEqual({ text: '8%', dir: 'down' })
    expect(describeDelta(0.4)).toEqual({ text: '0%', dir: 'flat' })
    expect(describeDelta(null).dir).toBe('none')
    expect(describeDelta(2500).text).toBe('2.5k%')
  })
})

describe('chart axes', () => {
  it('tidy tops: 1, 2, 2.5, 5 or 10 times a power of ten', () => {
    expect([0.7, 3, 12, 33, 480, 900, 1100].map(niceMax)).toEqual([1, 5, 20, 50, 500, 1000, 2000])
    expect(niceMax(0)).toBe(1)
    expect(niceMax(NaN)).toBe(1)
  })
  it('ticks from zero to the top, short labels', () => {
    expect(axisTicks(100, 4)).toEqual([0, 25, 50, 75, 100])
    expect([950, 1500, 12000, 2.5, 0].map(formatAxis)).toEqual(['950', '1.5k', '12k', '2.5', '0'])
  })
  it('time labels in India time: clock for a day or less, date for longer', () => {
    const t = new Date('2026-11-18T12:30:00Z').getTime()
    expect(formatTick(t, 24)).toBe('18:00')
    expect(formatTick(t, 24 * 7)).toBe('18 Nov')
    expect(timeTicks(0, 100, 5)).toEqual([0, 25, 50, 75, 100])
  })
})

describe('a line stops where the readings stop', () => {
  const p = (t: number, v: number | null) => ({ t, v })
  it('splits at a hole bigger than the allowed gap and drops points with no value', () => {
    const runs = splitOnGaps([p(0, 1), p(60, 2), p(120, 3), p(600, 4), p(660, null), p(720, 5)], 150)
    expect(runs.map((r) => r.map((x) => x.v))).toEqual([[1, 2, 3], [4, 5]])
  })
  it('sorts the readings first and keeps one run when nothing is missing', () => {
    expect(splitOnGaps([p(120, 3), p(0, 1), p(60, 2)], 100)).toHaveLength(1)
    expect(splitOnGaps([], 100)).toEqual([])
  })
  it('the usual spacing is the median gap', () => {
    expect(medianGap([p(0, 1), p(60, 1), p(120, 1), p(1000, 1)])).toBe(60)
    expect(medianGap([p(0, 1)])).toBe(0)
  })
  it('draws a straight line, a staircase, and a single reading as a dot', () => {
    const x = (t: number) => t, y = (v: number) => v
    expect(linePath([{ t: 0, v: 1 }, { t: 10, v: 5 }], x, y)).toBe('M0.0,1.0 L10.0,5.0')
    expect(linePath([{ t: 0, v: 1 }, { t: 10, v: 5 }], x, y, true)).toBe('M0.0,1.0 H10.0 V5.0')
    expect(linePath([{ t: 4, v: 2 }], x, y)).toContain('h0.1')
    expect(linePath([], x, y)).toBe('')
  })
})
