// Keeps hand-made pop-up panels (status reason, category reason, approval picker, filters, menus ...) fully inside the part of the screen the person can actually see.
// Pure geometry only (no document, no React) so it is easy to test; components/ui/PopupFitter.tsx does the measuring and applies the result.
//
// Why: most pop-ups are `position: absolute` panels placed under a small button, and many of them sit inside a card with `overflow: hidden` (the ticket properties card, tables, panels).
// A 288 px panel under a button in a 272 px card was cut off at the card's edge (reported 19 Nov 2026). The panel is now narrowed to fit the visible area when it is wider than it,
// slid sideways until its edges are inside, and - when it would run off the bottom - opened upwards or given a scrollbar of its own.

export interface Box { left: number; top: number; right: number; bottom: number }

export const FIT_MARGIN = 8

export const width = (b: Box) => b.right - b.left
export const height = (b: Box) => b.bottom - b.top

/** The overlap of two boxes (may be empty: right < left). */
export function intersect(a: Box, b: Box): Box {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
}

/** The widest the panel may be so that it fits the visible area with a margin on each side, or null when it already fits. */
export function maxWidthFor(pop: Box, visible: Box, margin = FIT_MARGIN): number | null {
  const available = Math.floor(width(visible) - 2 * margin)
  if (available < 120) return null            // a visible area this small is not a real one (hidden / collapsed container): leave the panel alone
  return width(pop) > available ? available : null
}

/** How far to slide the panel sideways (negative = left) so that both edges are inside the visible area. If it is still wider than the area, its left edge wins. */
export function shiftX(pop: Box, visible: Box, margin = FIT_MARGIN): number {
  if (width(visible) - 2 * margin < 120) return 0
  const minLeft = visible.left + margin
  const maxRight = visible.right - margin
  if (pop.left < minLeft) return Math.round(minLeft - pop.left)
  if (pop.right > maxRight) return Math.round(Math.max(maxRight - pop.right, minLeft - pop.left))
  return 0
}

export type Vertical =
  | { kind: 'ok' }
  | { kind: 'flip'; dy: number }               // move by dy (negative = up) so that it opens on the other side of its button
  | { kind: 'limit'; maxHeight: number }       // keep the place, but give the panel a scrollbar so that all of it can be reached

/**
 * `anchor` is the box the panel is attached to (its positioned parent). A panel that opens downwards (its top is at or below the anchor's bottom) and runs off the bottom
 * opens upwards instead when there is room there; a panel that opens upwards and runs off the top opens downwards. If neither side has room it is limited in height.
 */
export function fitVertically(pop: Box, anchor: Box, visible: Box, margin = FIT_MARGIN): Vertical {
  if (height(visible) - 2 * margin < 120) return { kind: 'ok' }
  const minTop = visible.top + margin
  const maxBottom = visible.bottom - margin
  const h = height(pop)
  const opensDown = pop.top >= anchor.bottom - 2
  const opensUp = pop.bottom <= anchor.top + 2
  const gap = opensDown ? pop.top - anchor.bottom : opensUp ? anchor.top - pop.bottom : 0
  if (pop.top >= minTop && pop.bottom <= maxBottom) return { kind: 'ok' }
  if (opensDown) {
    const roomAbove = anchor.top - gap - minTop
    if (roomAbove >= h) return { kind: 'flip', dy: Math.round(anchor.top - gap - pop.bottom) }
    const roomBelow = maxBottom - pop.top
    return roomBelow >= roomAbove ? { kind: 'limit', maxHeight: Math.max(120, Math.floor(roomBelow)) } : { kind: 'limit', maxHeight: Math.max(120, Math.floor(roomAbove)) }
  }
  if (opensUp) {
    const roomBelow = maxBottom - (anchor.bottom + gap)
    if (roomBelow >= h) return { kind: 'flip', dy: Math.round(anchor.bottom + gap - pop.top) }
    const roomAbove = pop.bottom - minTop
    return { kind: 'limit', maxHeight: Math.max(120, Math.floor(roomAbove)) }
  }
  // not attached above or below (for example beside its button): only keep it inside
  if (pop.bottom > maxBottom && pop.top - (pop.bottom - maxBottom) >= minTop) return { kind: 'flip', dy: Math.round(maxBottom - pop.bottom) }
  return { kind: 'ok' }
}

/** Class-name test for "this element is a pop-up panel": absolutely placed, above the page (z-20 and up), with a border and a shadow. Menus, pickers and reason boxes all are; badges and labels are not. */
export function looksLikePopup(classNames: readonly string[]): boolean {
  if (!classNames.includes('absolute')) return false
  const z = classNames.find((c) => /^z-(\d+|\[\d+\])$/.test(c))
  if (!z) return false
  const n = Number(z.replace(/\D/g, ''))
  if (n < 20) return false
  return classNames.some((c) => c === 'border' || c.startsWith('border-')) && classNames.some((c) => c.startsWith('shadow'))
}
