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
 * A list at the top of a page is frozen at EVERY window size: when the window is so short that nothing is left for it, the box keeps a usable minimum (STICKY_SMALL_BOX) and the page scrolls to
 * the filters and the pager. A table lower down on a page of several blocks that does not fit, a short table, a table that already has its own height limit, a table inside a dialog, or one
 * marked `data-no-sticky` is left exactly as it was. Nothing is stored and nothing is sent anywhere.
 */

/** A table that starts anywhere on the page is fixed to the screen that is left for it when that is at least this much. */
export const STICKY_MIN_HEIGHT = 200
export const STICKY_GAP = 12
/** A list at the top of the page (its table starts within this many px of the top: the title, tabs and filters above it) is ALWAYS frozen, whatever the window size. */
export const STICKY_TOP_LIMIT = 420
/** On a short window (a small laptop screen, large Windows scaling, a phone turned sideways) the box never gets smaller than this: the headings stay frozen, a few rows stay visible,
 *  and the page itself scrolls to reach the filters above and the pager below. About the header and three rows. */
export const STICKY_SMALL_BOX = 160
/** ...and so is a list that is the LAST block of its page (only a pager and the page padding follow it, at most this much), wherever it starts: on a narrow phone the title, tabs and filters stack and push the table far down. */
export const STICKY_LAST_BLOCK = 140

/**
 * The height to give the box, or null when the table is to be left alone. Pure, so it is covered by a unit test.
 *  - room for at least STICKY_MIN_HEIGHT: the box fills the screen that is left (the page itself has nothing to scroll);
 *  - less room, but the table is at the top of the page or is the last block of it (a list page): the box is as tall as the room, never under STICKY_SMALL_BOX, and the page scrolls;
 *  - less room and the table is lower down with other blocks after it: left as it was.
 */
export function stickyMaxHeight(p: { mainHeight: number; top: number; below: number }): number | null {
  const room = Math.floor(p.mainHeight - p.top - p.below - STICKY_GAP)
  if (room >= STICKY_MIN_HEIGHT) return room
  if (p.top <= STICKY_TOP_LIMIT || p.below <= STICKY_LAST_BLOCK) return Math.max(room, STICKY_SMALL_BOX)
  return null
}

/**
 * The room below a box (a pager, the page's bottom padding), measured to the end of the page's OWN content. Measuring to the end of the scroll area instead (main.scrollHeight) gave a different answer
 * every time the box had already been shortened: the content then ends 12 px before the scroll area does, that gap was counted as "space below", and each re-run took another 12 px off the box until it
 * fell under the minimum and jumped back to full height: a flicker, with the frozen headings lost on every jump (seen on a laptop in Chrome and in Edge, 18 Nov 2026).
 * Measured this way the answer is the same however often it is worked out. Pure, so a test can run it over and over.
 */
export function spaceBelow(p: { contentBottom: number; boxBottom: number }): number {
  return Math.max(0, p.contentBottom - p.boxBottom)
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
      // the page's own content block (the area inside the scroll area that holds the page); its bottom edge is where the content really ends
      const content = (main.querySelector(':scope > .page') ?? main.firstElementChild) as HTMLElement | null
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
        const boxRect = box.getBoundingClientRect()
        const top = boxRect.top - mainTop + main.scrollTop
        const below = content ? spaceBelow({ contentBottom: content.getBoundingClientRect().bottom, boxBottom: boxRect.bottom }) : Math.max(0, main.scrollHeight - (top + box.offsetHeight))
        const room = stickyMaxHeight({ mainHeight: main.clientHeight, top, below })
        if (room !== null && box.scrollHeight > room) {
          const now = parseFloat(box.style.maxHeight)
          if (!(box.hasAttribute('data-sticky-on') && Math.abs(now - room) <= 2)) box.style.maxHeight = room + 'px'   // (a change of a pixel or two, from a zoom level's rounding, is ignored)
          box.style.overflowY = 'auto'; box.setAttribute('data-sticky-on', '')
        }
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
