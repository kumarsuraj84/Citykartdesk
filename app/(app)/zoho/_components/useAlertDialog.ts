'use client'

import { useEffect, useRef } from 'react'

/**
 * For the small inline confirm boxes ("Move N tickets now?", "Switch ON?"): when the box opens, keyboard focus moves INTO it (onto the button marked
 * data-autofocus, the harmless one such as Cancel), Escape closes it, and closing puts focus back where the person was: on the button that opened it, or
 * - when that button is replaced while the box is open - on the button marked data-return-focus in the same section. Without this a keyboard or screen-reader
 * user presses "Move" and nothing tells them a question has appeared.
 */
export function useAlertDialog(open: boolean, onClose: () => void) {
  const box = useRef<HTMLDivElement | null>(null)
  const opener = useRef<Element | null>(null)
  const scope = useRef<Element | null>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    scope.current = box.current?.closest('section') ?? null
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('button')
    first?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close.current() } }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // the screen is redrawn after the box closes: put focus back on the next frame
      requestAnimationFrame(() => {
        const back = opener.current
        const target = back instanceof HTMLElement && document.contains(back) ? back : scope.current?.querySelector<HTMLElement>('[data-return-focus]')
        target?.focus()
      })
    }
  }, [open])

  return box
}
