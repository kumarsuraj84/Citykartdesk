'use client'

import { useEffect } from 'react'

// A tiny shared "the person is in the middle of something" signal.
// The page refreshes itself in the background (AutoRefresh). While anything here says "busy"
// (rows ticked, a menu or dialog open, a file uploading) that refresh waits, so it can never
// wipe out what the person is doing.
let busyCount = 0

export function pushBusy(): () => void {
  busyCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    busyCount = Math.max(0, busyCount - 1)
  }
}

export function isBusy(): boolean {
  return busyCount > 0
}

/** Mark the page busy for as long as `active` is true. */
export function useBusy(active: boolean): void {
  useEffect(() => {
    if (!active) return
    return pushBusy()
  }, [active])
}

// Open dialogs, menus and pickers (anything that marks itself as one) also count as busy,
// so code that cannot call useBusy is still covered.
const OPEN_OVERLAY_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-autorefresh-pause]'

export function isOverlayOpen(doc: Document = document): boolean {
  return doc.querySelector(OPEN_OVERLAY_SELECTOR) !== null
}

// Pages where a background refresh does more harm than good (heavy reports, the intake inbox, admin editors).
const NO_AUTO_REFRESH_PREFIXES = ['/dashboards', '/intake/inbox', '/admin']

export function autoRefreshAllowed(pathname: string | null): boolean {
  if (!pathname) return true
  return !NO_AUTO_REFRESH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export const AUTO_REFRESH_BASE_MS = 30_000
export const AUTO_REFRESH_MAX_MS = 5 * 60_000

/** Next wait: the base time (with a little random spread so everyone does not hit the server together), doubled for each failure in a row, never above the cap. */
export function nextRefreshDelay(failures: number, random: number = Math.random()): number {
  const base = Math.min(AUTO_REFRESH_BASE_MS * 2 ** Math.max(0, failures), AUTO_REFRESH_MAX_MS)
  const jitter = 0.8 + random * 0.4 // 80% to 120%
  return Math.round(base * jitter)
}
