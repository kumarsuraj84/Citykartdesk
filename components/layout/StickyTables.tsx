'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Every list page: the page title, the tabs and the filters stay where they are, the column headings stay frozen, and only the ROWS scroll.
 *
 * Why this is needed: a table that sits in a box that scrolls sideways (`overflow-x: auto`, so a wide table works on a small screen) cannot have headings that stick to the page, because
 * such a box scrolls on both axes by itself. So the box is given the height that is left on the screen (its top to the bottom of the page, minus whatever sits below it, such as a
 * pager), and the table scrolls inside it with its headings pinned (the CSS in globals.css for `[data-sticky-table]`). The page itself then has nothing left to scroll.
 *
 * Only a table that starts near the top of the page and is taller than the space left is changed; a table lower down on a page of several blocks, a short table, a table that already
 * has its own height limit, a table inside a dialog, or one marked `data-no-sticky` is left exactly as it was. Nothing is stored and nothing is sent anywhere.
 */

/** A table is only fixed when at least this much height is left for it (below that the page scrolls as before). */
export const STICKY_MIN_HEIGHT = 200
export const STICKY_GAP = 12

/** The height to give the box, or null when there is not enough room (leave it alone). Pure, so it is covered by a unit test. */
export function stickyMaxHeight(p: { mainHeight: number; top: number; below: number }): number | null {
  const room = Math.floor(p.mainHeight - p.top - p.below - STICKY_GAP)
  return room >= STICKY_MIN_HEIGHT ? room : null
}

const SKIP = '[role="dialog"],[aria-modal="true"],dialog,[data-no-sticky]'

export function StickyTables() {
  const pathname = usePathname()

  useEffect(() => {
    const main = document.getElementById('main-content')
    if (!main) return
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const apply = () => {
      frame = 0
      const mainTop = main.getBoundingClientRect().top
      const boxes = new Set<HTMLElement>()
      main.querySelectorAll('table').forEach((table) => {
        if (table.closest(SKIP)) return
        const box = table.parentElement
        if (!box || box === main) return
        if (box.hasAttribute('data-sticky-table')) { boxes.add(box); return }
        const cs = getComputedStyle(box)
        if (!/(auto|scroll)/.test(cs.overflowX)) return        // the table is not in a sideways-scrolling box
        if (cs.maxHeight !== 'none') return                    // the page already limits its height itself
        if (!table.tHead) return
        box.setAttribute('data-sticky-table', '')
        boxes.add(box)
      })
      // list pages made of cards or rows (approvals, notifications, projects ...) mark their list with data-sticky-list and get the same treatment
      main.querySelectorAll<HTMLElement>('[data-sticky-list]').forEach((el) => { if (!el.closest(SKIP)) boxes.add(el) })
      boxes.forEach((box) => {
        const top = box.getBoundingClientRect().top - mainTop + main.scrollTop
        const below = main.scrollHeight - (top + box.offsetHeight)
        const room = stickyMaxHeight({ mainHeight: main.clientHeight, top, below })
        if (room !== null && box.scrollHeight > room) { box.style.maxHeight = room + 'px'; box.style.overflowY = 'auto'; box.setAttribute('data-sticky-on', '') }
        else if (box.hasAttribute('data-sticky-on')) { box.style.maxHeight = ''; box.style.overflowY = ''; box.removeAttribute('data-sticky-on') }
      })
    }
    const later = (ms = 60) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (!frame) frame = requestAnimationFrame(apply) }, ms) }

    later(0)
    const watch = new MutationObserver(() => later())                 // a new page, a new set of rows
    watch.observe(main, { childList: true, subtree: true })
    const size = new ResizeObserver(() => later())                    // the window or the side menu changed size
    size.observe(main)
    const onClick = () => later(150)                                  // a tab or a filter shown or hidden by a click
    main.addEventListener('click', onClick)
    window.addEventListener('resize', onClick)
    return () => {
      watch.disconnect(); size.disconnect()
      main.removeEventListener('click', onClick); window.removeEventListener('resize', onClick)
      if (timer) clearTimeout(timer)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [pathname])

  return null
}
