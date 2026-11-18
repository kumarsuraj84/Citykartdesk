import { describe, it, expect } from 'vitest'
import { stickyMaxHeight, spaceBelow, STICKY_MIN_HEIGHT, STICKY_SMALL_BOX, STICKY_TOP_LIMIT, STICKY_LAST_BLOCK } from '@/components/layout/StickyTables'

describe('list pages: the height given to the table box', () => {
  it('fills the screen that is left, minus whatever sits below the table', () => {
    // a 700 px page area, the table starts 180 px down, a 60 px pager below it, a 12 px gap
    expect(stickyMaxHeight({ mainHeight: 700, top: 180, below: 60 })).toBe(448)
    expect(stickyMaxHeight({ mainHeight: 700, top: 180, below: 0 })).toBe(508)
  })
  it('a list at the top of the page is still frozen when the window is short: the box keeps a usable minimum and the page scrolls', () => {
    expect(stickyMaxHeight({ mainHeight: 400, top: 120, below: 80 })).toBe(188)            // 188 of room: the box is as tall as the room
    expect(stickyMaxHeight({ mainHeight: 400, top: 250, below: 70 })).toBe(STICKY_SMALL_BOX) // only 68 left: never smaller than the minimum box
    expect(stickyMaxHeight({ mainHeight: 300, top: 260, below: 60 })).toBe(STICKY_SMALL_BOX) // a phone turned sideways
    expect(stickyMaxHeight({ mainHeight: 200, top: 300, below: 0 })).toBe(STICKY_SMALL_BOX)  // even a tiny window
  })
  it('leaves a table alone only when it is lower down on a page of several blocks and does not fit', () => {
    expect(stickyMaxHeight({ mainHeight: 700, top: 560, below: 300 })).toBeNull()
    expect(stickyMaxHeight({ mainHeight: 600, top: STICKY_TOP_LIMIT + 1, below: STICKY_LAST_BLOCK + 1 })).toBeNull()
    // ...but a table lower down that does fit is still fixed, as before
    expect(stickyMaxHeight({ mainHeight: 900, top: 500, below: 60 })).toBe(328)
  })
  it('a list that is the last block of its page is frozen wherever it starts (a narrow phone pushes it far down)', () => {
    expect(stickyMaxHeight({ mainHeight: 300, top: 520, below: 50 })).toBe(STICKY_SMALL_BOX)
    expect(stickyMaxHeight({ mainHeight: 700, top: 560, below: 0 })).toBe(STICKY_SMALL_BOX)
    expect(stickyMaxHeight({ mainHeight: 700, top: 560, below: STICKY_LAST_BLOCK })).toBe(STICKY_SMALL_BOX)
  })
  it('the smallest room that fills the screen is the documented minimum; under it a top list gets the small box', () => {
    expect(stickyMaxHeight({ mainHeight: STICKY_MIN_HEIGHT + 12, top: 0, below: 0 })).toBe(STICKY_MIN_HEIGHT)
    expect(stickyMaxHeight({ mainHeight: STICKY_MIN_HEIGHT + 11, top: 0, below: 0 })).toBe(STICKY_MIN_HEIGHT - 1)
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
