'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { pushBusy } from '@/lib/ui/busy'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Open dialogs, newest last. Only the newest one reacts to Escape / Tab, so a dialog opened on top of another one does not close both.
const openDialogs: symbol[] = []

// (a control that is hidden cannot take focus, so it is not part of the Tab loop)
function isVisible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert]')) return false
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/**
 * Where Tab should go so focus stays inside a dialog. Returns the element to focus when the
 * key would leave the dialog (last -> first, or first -> last with Shift), otherwise null
 * (let the browser move focus as usual).
 */
export function tabTrapTarget<T>(items: T[], active: T | null, shift: boolean, containsActive: boolean): T | null {
  if (items.length === 0) return null
  const first = items[0]
  const last = items[items.length - 1]
  if (!containsActive) return shift ? last : first
  if (shift && active === first) return last
  if (!shift && active === last) return first
  return null
}

interface Options {
  /** Called when the person presses Escape. Pass a function that does nothing while a save is running. */
  onClose: () => void
  /** Short name read out by a screen reader. */
  label?: string
  /** Set false while the dialog is not shown (for dialogs that stay mounted). Default true. */
  enabled?: boolean
  /** The box that should get the cursor when the dialog opens (default: the first button or box inside). */
  initialFocus?: RefObject<HTMLElement | null>
}

/**
 * Basic keyboard and screen-reader support for a pop-up window, in one place:
 * Escape closes it, focus moves into it when it opens (unless something inside already has it),
 * Tab stays inside it, and focus goes back to where it was when it closes.
 * Also tells the background auto-refresh to wait while it is open.
 * Spread `props` on the element that wraps the whole pop-up.
 */
export function useModalA11y({ onClose, label, enabled = true, initialFocus }: Options): {
  props: { ref: RefObject<HTMLDivElement | null>; role: 'dialog'; 'aria-modal': true; 'aria-label'?: string; tabIndex: -1 }
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!enabled) return
    const id = Symbol('dialog')
    openDialogs.push(id)
    const release = pushBusy()
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current

    // move focus inside, unless an input inside already took it (autoFocus)
    if (root && !root.contains(document.activeElement)) {
      const first = initialFocus?.current ?? root.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? root).focus()
    }

    const onKey = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== id) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible)
      const target = tabTrapTarget(items, document.activeElement as HTMLElement | null, e.shiftKey, root.contains(document.activeElement))
      if (target) { e.preventDefault(); target.focus() }
      else if (items.length === 0) { e.preventDefault(); root.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = openDialogs.indexOf(id)
      if (at >= 0) openDialogs.splice(at, 1)
      release()
      // give focus back to what opened the dialog (if it is still on the page)
      if (returnTo && document.contains(returnTo)) returnTo.focus()
    }
  // initialFocus is a ref object (same object every render), so it is deliberately not a dependency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return { props: { ref, role: 'dialog', 'aria-modal': true, ...(label ? { 'aria-label': label } : {}), tabIndex: -1 } }
}
