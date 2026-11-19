// @vitest-environment jsdom
// components/ui/PopupFitter.tsx: the measuring and applying part, with the page layout stubbed (jsdom has no layout of its own).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { PopupFitter, fitPopup } from '@/components/ui/PopupFitter'

type R = { left: number; top: number; right: number; bottom: number }
const rect = ({ left, top, right, bottom }: R): DOMRect => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** A card (overflow hidden) holding a relative wrapper holding the pop-up; rects are handed out by the test. */
function setup(opts: { card: R; wrapper: R; pop: R | ((el: HTMLElement) => R); win?: [number, number] }) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: opts.win?.[0] ?? 1366 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: opts.win?.[1] ?? 768 })
  const card = document.createElement('div'); card.style.overflowX = 'hidden'; card.style.overflowY = 'hidden'
  const wrapper = document.createElement('div')
  const pop = document.createElement('div'); pop.className = 'absolute right-0 top-full z-50 w-72 border shadow-xl'
  wrapper.appendChild(pop); card.appendChild(wrapper); document.body.appendChild(card)
  card.getBoundingClientRect = () => rect(opts.card)
  wrapper.getBoundingClientRect = () => rect(opts.wrapper)
  Object.defineProperty(pop, 'offsetParent', { configurable: true, get: () => wrapper })
  // the pop-up's own rect follows its max-width / transform like a real layout would (right edge fixed, as with `right-0`)
  const base = typeof opts.pop === 'function' ? opts.pop : () => opts.pop as R
  pop.getBoundingClientRect = () => {
    const b = base(pop)
    const mw = parseFloat(pop.style.maxWidth)
    const w = Number.isFinite(mw) ? Math.min(b.right - b.left, mw) : b.right - b.left
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(pop.style.transform)
    const dx = m ? Number(m[1]) : 0, dy = m ? Number(m[2]) : 0
    return rect({ left: b.right - w + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy })
  }
  return { card, wrapper, pop }
}
afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('fitPopup', () => {
  it('the reported case: a 288 px box in a 272 px card is narrowed and kept inside the card', () => {
    const { pop } = setup({ card: { left: 1055, top: 346, right: 1327, bottom: 1016 }, wrapper: { left: 1200, top: 400, right: 1320, bottom: 430 }, pop: { left: 1022, top: 434, right: 1310, bottom: 640 } })
    expect(fitPopup(pop)).toBe(true)
    const r = pop.getBoundingClientRect()
    expect(r.left).toBeGreaterThanOrEqual(1055 + 8 - 1)
    expect(r.right).toBeLessThanOrEqual(1327 - 8 + 1)
    expect(pop.style.maxWidth).toBe('256px')
    expect(pop.hasAttribute('data-fitted')).toBe(true)
  })

  it('a panel that already fits is not touched at all', () => {
    const { pop } = setup({ card: { left: 0, top: 0, right: 1366, bottom: 768 }, wrapper: { left: 600, top: 100, right: 700, bottom: 130 }, pop: { left: 500, top: 134, right: 700, bottom: 300 } })
    expect(fitPopup(pop)).toBe(false)
    expect(pop.getAttribute('style')).toBeNull()
    expect(pop.hasAttribute('data-fitted')).toBe(false)
  })

  it('opens upwards when it would run off the bottom of the window', () => {
    const { pop } = setup({ card: { left: 0, top: 0, right: 1366, bottom: 768 }, wrapper: { left: 900, top: 600, right: 1000, bottom: 630 }, pop: { left: 760, top: 634, right: 1000, bottom: 900 } })
    expect(fitPopup(pop)).toBe(true)
    const r = pop.getBoundingClientRect()
    expect(r.bottom).toBeLessThanOrEqual(600)
  })

  it('a hidden panel (no size) is left alone', () => {
    const { pop } = setup({ card: { left: 0, top: 0, right: 100, bottom: 100 }, wrapper: { left: 0, top: 0, right: 10, bottom: 10 }, pop: { left: 0, top: 0, right: 0, bottom: 0 } })
    expect(fitPopup(pop)).toBe(false)
  })

  it('fitting again starts from the natural place: its own earlier adjustment is cleared first', () => {
    const { pop } = setup({ card: { left: 1055, top: 346, right: 1327, bottom: 1016 }, wrapper: { left: 1200, top: 400, right: 1320, bottom: 430 }, pop: { left: 1022, top: 434, right: 1310, bottom: 640 } })
    fitPopup(pop)
    const first = pop.getAttribute('style')
    fitPopup(pop)
    expect(pop.getAttribute('style')).toBe(first)
  })

  it('never removes styles it did not set', () => {
    const { pop } = setup({ card: { left: 0, top: 0, right: 1366, bottom: 768 }, wrapper: { left: 600, top: 100, right: 700, bottom: 130 }, pop: { left: 500, top: 134, right: 700, bottom: 300 } })
    pop.style.maxHeight = '300px'
    fitPopup(pop)
    expect(pop.style.maxHeight).toBe('300px')
  })
})

describe('<PopupFitter /> watches the page', () => {
  it('fits a pop-up the moment it appears, and ignores other new elements', async () => {
    render(<PopupFitter />)
    const { card, pop } = setup({ card: { left: 1055, top: 346, right: 1327, bottom: 1016 }, wrapper: { left: 1200, top: 400, right: 1320, bottom: 430 }, pop: { left: 1022, top: 434, right: 1310, bottom: 640 } })
    // setup() already appended the card (with the pop-up inside) to the body: wait for the observer
    await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 20)) })
    expect(pop.hasAttribute('data-fitted')).toBe(true)
    const plain = document.createElement('div'); plain.className = 'absolute z-50'; card.appendChild(plain)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(plain.hasAttribute('data-fitted')).toBe(false)
  })

  it('a failure while measuring never reaches the page', async () => {
    render(<PopupFitter />)
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw new Error('boom') })
    const el = document.createElement('div'); el.className = 'absolute right-0 z-50 border shadow-lg'
    expect(() => document.body.appendChild(el)).not.toThrow()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    spy.mockRestore()
  })
})
