'use client'

import { useEffect } from 'react'
import { FIT_MARGIN, fitVertically, intersect, looksLikePopup, maxWidthFor, shiftX, type Box } from '@/lib/ui/fit-popup'

// Draws nothing. Mounted once (app/layout.tsx). Whenever a pop-up panel appears anywhere in the app (status / category reason boxes, approval pickers, filters, menus ...) it is
// measured against the part of the screen that is really visible - the window cut down by every ancestor that clips (overflow hidden / auto / scroll) - and, if needed, narrowed,
// slid sideways, or opened upwards / given its own scrollbar so that every edge and button can be seen and reached. Geometry rules: lib/ui/fit-popup.ts.
// Only the panel's own `transform`, `max-width`, `max-height` and `overflow-y` are touched, and only when fitting is needed; they are cleared and measured again whenever the window
// or the panel's own size changes. A panel that is not hidden, fits already, or is not a pop-up by its classes is left exactly as it was.

const MARK = 'data-fitted'

const toBox = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

/** The visible part of the screen for `el` on one axis: the window, cut down by each ancestor whose overflow on that axis is not `visible`. */
function visibleArea(el: HTMLElement, axis: 'x' | 'y'): Box {
  let area: Box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p)
    const o = axis === 'x' ? cs.overflowX : cs.overflowY
    if (o && o !== 'visible') area = intersect(area, toBox(p.getBoundingClientRect()))   // (an empty value only happens in test DOMs)
  }
  return area
}

function clearOwn(el: HTMLElement) {
  if (!el.hasAttribute(MARK)) return
  el.style.transform = ''
  el.style.maxWidth = ''
  el.style.maxHeight = ''
  el.style.overflowY = ''
  el.removeAttribute(MARK)
}

/** Fit one panel. Exported for tests. Returns true when it changed anything. */
export function fitPopup(el: HTMLElement): boolean {
  clearOwn(el)
  if (!el.isConnected) return false
  let rect = toBox(el.getBoundingClientRect())
  if (rect.right - rect.left < 1 || rect.bottom - rect.top < 1) return false      // hidden (display none) or empty
  let changed = false

  // across: first narrow it if it is wider than the visible area, then slide it inside
  const visX = visibleArea(el, 'x')
  const mw = maxWidthFor(rect, visX, FIT_MARGIN)
  if (mw !== null) { el.style.maxWidth = `${mw}px`; changed = true; rect = toBox(el.getBoundingClientRect()) }
  const dx = shiftX(rect, visX, FIT_MARGIN)

  // up and down: open on the other side of the button when there is no room, or give the panel a scrollbar
  let dy = 0
  const parent = el.offsetParent as HTMLElement | null
  if (parent && parent !== document.body) {
    const visY = visibleArea(el, 'y')
    const v = fitVertically({ ...rect, left: rect.left + dx, right: rect.right + dx }, toBox(parent.getBoundingClientRect()), visY, FIT_MARGIN)
    if (v.kind === 'flip') dy = v.dy
    else if (v.kind === 'limit') {
      el.style.maxHeight = `${v.maxHeight}px`
      if (getComputedStyle(el).overflowY === 'visible') el.style.overflowY = 'auto'
      changed = true
    }
  }
  if (dx !== 0 || dy !== 0) { el.style.transform = `translate(${dx}px, ${dy}px)`; changed = true }
  if (changed) el.setAttribute(MARK, '1')
  return changed
}

export function PopupFitter() {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const tracked = new Set<HTMLElement>()
    let suppressUntil = 0
    let raf = 0

    const run = (el: HTMLElement) => { suppressUntil = performance.now() + 120; try { fitPopup(el) } catch { /* never disturb the page */ } }

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          if (performance.now() < suppressUntil) return                  // the change was our own
          for (const e of entries) if (tracked.has(e.target as HTMLElement)) run(e.target as HTMLElement)
        })
      : null

    const adopt = (el: HTMLElement) => {
      if (tracked.has(el)) return
      tracked.add(el)
      resizeObserver?.observe(el)
      run(el)                                                            // before the first paint: no flash of a cut-off panel
    }

    const scan = (node: Node) => {
      if (!(node instanceof HTMLElement)) return
      if (looksLikePopup([...node.classList])) adopt(node)
      if (node.childElementCount > 0) node.querySelectorAll<HTMLElement>('.absolute').forEach((e) => { if (looksLikePopup([...e.classList])) adopt(e) })
    }

    const mo = new MutationObserver((mutations) => {
      let budget = 400                                                   // a big table redrawing is not scanned node by node
      for (const m of mutations) {
        for (const n of m.addedNodes) { if (budget-- <= 0) return; scan(n) }
      }
      for (const el of tracked) if (!el.isConnected) { tracked.delete(el); resizeObserver?.unobserve(el) }
    })
    mo.observe(document.body, { childList: true, subtree: true })

    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { for (const el of tracked) if (el.isConnected) run(el) })
    }
    window.addEventListener('resize', onResize)

    return () => { mo.disconnect(); resizeObserver?.disconnect(); window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); tracked.clear() }
  }, [])

  return null
}
