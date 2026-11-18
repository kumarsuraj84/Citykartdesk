import { describe, it, expect } from 'vitest'
import { stickyMaxHeight, STICKY_MIN_HEIGHT } from '@/components/layout/StickyTables'

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
