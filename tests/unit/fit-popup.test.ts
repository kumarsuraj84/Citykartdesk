// Geometry rules that keep pop-up panels inside the visible part of the screen (lib/ui/fit-popup.ts).
import { describe, it, expect } from 'vitest'
import { fitVertically, intersect, looksLikePopup, maxWidthFor, shiftX, type Box } from '@/lib/ui/fit-popup'

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

describe('across: the 19 Nov 2026 report (a 288 px reason box under a button in a 272 px card)', () => {
  const card = box(1055, 346, 1327, 1016)          // the ticket properties card: 272 px wide, overflow hidden
  const pop = box(1022, 438, 1310, 640)            // the reason box: 288 px wide, 33 px outside the card on the left

  it('is narrowed to fit the card with a margin on each side', () => {
    expect(maxWidthFor(pop, card)).toBe(256)
  })
  it('then slid inside', () => {
    const narrowed = box(1054, 438, 1310, 640)     // right edge stays (right-0), 256 wide
    expect(shiftX(narrowed, card)).toBe(9)         // 1063 is the first allowed left edge
  })
  it('a panel that already fits is left alone', () => {
    expect(maxWidthFor(box(1100, 400, 1300, 500), card)).toBeNull()
    expect(shiftX(box(1100, 400, 1300, 500), card)).toBe(0)
  })
  it('slides left when it runs off the right edge, right when it runs off the left edge', () => {
    const win = box(0, 0, 1000, 700)
    expect(shiftX(box(800, 100, 1040, 200), win)).toBe(-48)    // 1040 -> 992
    expect(shiftX(box(-30, 100, 200, 200), win)).toBe(38)      // -30 -> 8
  })
  it('never moves a panel that is wider than any visible area it could fit: its left edge wins', () => {
    const win = box(0, 0, 400, 700)
    expect(shiftX(box(-50, 0, 450, 100), win)).toBe(58)
  })
  it('ignores a visible area that is not real (a collapsed or hidden container)', () => {
    const tiny = box(100, 100, 150, 120)
    expect(maxWidthFor(box(90, 100, 400, 200), tiny)).toBeNull()
    expect(shiftX(box(90, 100, 400, 200), tiny)).toBe(0)
  })
})

describe('up and down', () => {
  const win = box(0, 0, 1000, 700)
  const anchor = box(800, 500, 900, 530)           // the button the panel hangs from (lower on the screen, so there is room above it)

  it('a panel that fits is left alone', () => {
    expect(fitVertically(box(700, 534, 900, 680), anchor, win)).toEqual({ kind: 'ok' })
  })
  it('opens upwards when it runs off the bottom and there is room above', () => {
    const pop = box(700, 534, 900, 800)            // 266 tall, would end at 800 > 692; 488 px are free above the button
    const v = fitVertically(pop, anchor, win)
    expect(v.kind).toBe('flip')
    if (v.kind === 'flip') expect(pop.bottom + v.dy).toBe(anchor.top - 4)      // sits just above the button, same 4 px gap
  })
  it('gets its own scrollbar when there is no room on either side', () => {
    const tallWin = box(0, 0, 1000, 500)
    const a = box(800, 200, 900, 230)
    const pop = box(700, 234, 900, 700)            // 466 tall: neither 234-8 above nor 500-8-234 below is enough
    const v = fitVertically(pop, a, tallWin)
    expect(v.kind).toBe('limit')
    if (v.kind === 'limit') { expect(v.maxHeight).toBeGreaterThanOrEqual(120); expect(v.maxHeight).toBeLessThanOrEqual(266) }
  })
  it('a panel that opens upwards and runs off the top opens downwards instead', () => {
    const a = box(800, 60, 900, 90)
    const pop = box(700, -150, 900, 56)            // 206 tall, above the button, off the top
    const v = fitVertically(pop, a, win)
    expect(v.kind).toBe('flip')
    if (v.kind === 'flip') expect(pop.top + v.dy).toBe(a.bottom + 4)
  })
})

describe('the visible area', () => {
  it('is the overlap of the window and every clipping ancestor', () => {
    expect(intersect(box(0, 0, 1366, 768), box(1055, 346, 1327, 1016))).toEqual(box(1055, 346, 1327, 768))
  })
})

describe('which elements count as pop-up panels', () => {
  it('menus, pickers and reason boxes do', () => {
    expect(looksLikePopup('absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-card shadow-xl'.split(' '))).toBe(true)
    expect(looksLikePopup('absolute left-0 top-full z-20 mt-1.5 w-64 border bg-card shadow-lg'.split(' '))).toBe(true)
    expect(looksLikePopup('absolute left-0 top-full z-[60] w-56 border border-border shadow-md'.split(' '))).toBe(true)
  })
  it('badges, icons, overlays and plain boxes do not', () => {
    expect(looksLikePopup('absolute -top-1 -right-1 flex h-3 w-3 rounded-full bg-destructive'.split(' '))).toBe(false)   // a counter bubble
    expect(looksLikePopup('absolute left-2.5 top-1/2 h-3.5 w-3.5 text-muted-foreground'.split(' '))).toBe(false)           // an icon inside an input
    expect(looksLikePopup('relative z-50 border shadow-lg'.split(' '))).toBe(false)                                        // not absolutely placed
    expect(looksLikePopup('absolute z-10 border shadow-sm'.split(' '))).toBe(false)                                        // below the pop-up layer
    expect(looksLikePopup('absolute z-50 bg-card'.split(' '))).toBe(false)                                                 // no border and no shadow
  })
})
