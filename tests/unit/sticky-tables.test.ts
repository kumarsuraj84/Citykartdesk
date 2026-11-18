import { describe, it, expect } from 'vitest'
import { stickyMaxHeight, spaceBelow, STICKY_MIN_HEIGHT } from '@/components/layout/StickyTables'

describe('list pages: the height given to the table box', () => {
  it('fills the screen that is left, minus whatever sits below the table', () => {
    // a 700 px page area, the table starts 180 px down, a 60 px pager below it, a 12 px gap
    expect(stickyMaxHeight({ mainHeight: 700, top: 180, below: 60 })).toBe(448)
    expect(stickyMaxHeight({ mainHeight: 700, top: 180, below: 0 })).toBe(508)
  })
  it('leaves a table alone when there is not enough room (a table low on a page of several blocks, or a tiny window)', () => {
    expect(stickyMaxHeight({ mainHeight: 700, top: 560, below: 0 })).toBeNull()
    expect(stickyMaxHeight({ mainHeight: 400, top: 120, below: 80 })).toBeNull()
    expect(stickyMaxHeight({ mainHeight: 400, top: 120, below: 70 })).toBeNull() // 198 is still under the minimum of 200: the page scrolls as before
  })
  it('the smallest box is the documented minimum', () => {
    expect(stickyMaxHeight({ mainHeight: STICKY_MIN_HEIGHT + 12, top: 0, below: 0 })).toBe(STICKY_MIN_HEIGHT)
    expect(stickyMaxHeight({ mainHeight: STICKY_MIN_HEIGHT + 11, top: 0, below: 0 })).toBeNull()
  })
})

// A small model of the page: the scroll area is mainH tall, the table box starts top px down and its content is contentH tall, and B px (a pager, the bottom padding) follow it.
// It runs the helper's measurement again and again, the way the real page does whenever anything on it changes (a clock, a refresh, a click), and returns the box heights it gives.
function runs(measureBelow: (m: { mainH: number; top: number; boxH: number; B: number }) => number, times: number) {
  const mainH = 600, top = 200, B = 80, contentH = 1800
  let maxHeight: number | null = null
  const out: (number | null)[] = []
  for (let i = 0; i < times; i++) {
    const boxH = Math.min(contentH, maxHeight ?? Infinity)
    const below = measureBelow({ mainH, top, boxH, B })
    const room = stickyMaxHeight({ mainHeight: mainH, top, below })
    maxHeight = room !== null && contentH > room ? room : null
    out.push(maxHeight)
  }
  return out
}

describe('working the height out again and again gives the same answer (the flicker seen on a laptop, 18 Nov 2026)', () => {
  it('measured to the end of the page content: the same height every time', () => {
    const answers = runs(({ top, boxH, B }) => spaceBelow({ contentBottom: top + boxH + B, boxBottom: top + boxH }), 30)
    expect(new Set(answers).size).toBe(1)
    expect(answers[0]).toBe(600 - 200 - 80 - 12)
  })
  it('the old way (measured to the end of the scroll area) shrank the box by 12 px at every run and then jumped back: this is what flickered', () => {
    const answers = runs(({ mainH, top, boxH, B }) => Math.max(mainH, top + boxH + B) - (top + boxH), 30)
    expect(new Set(answers).size).toBeGreaterThan(1)
  })
  it('space below is never negative', () => {
    expect(spaceBelow({ contentBottom: 500, boxBottom: 520 })).toBe(0)
    expect(spaceBelow({ contentBottom: 580, boxBottom: 500 })).toBe(80)
  })
})
