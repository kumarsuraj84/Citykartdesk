'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { autoRefreshAllowed, isBusy, isOverlayOpen, nextRefreshDelay } from '@/lib/ui/busy'

// If a script error or a failed request shows up this soon after a refresh, the refresh is counted as failed.
const FAILURE_WINDOW_MS = 6_000

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/**
 * Soft-refreshes the authenticated pages in the background via router.refresh()
 * — re-runs Server Component data fetches and patches the RSC tree in place,
 * no full page reload and no loss of client-side state (open drawers, form
 * state) — so status changes, new/assigned tickets, and approval decisions
 * made by someone else show up without the viewer manually reloading.
 *
 * It waits (and looks again soon) while the tab is hidden, the computer is offline, the viewer
 * is typing, rows are ticked, or a menu/dialog/upload is open (see lib/ui/busy). It is switched
 * off on heavy pages (dashboards, intake inbox, admin). The wait is 30 s with a random spread, and
 * grows after failed refreshes so a struggling server is not hammered.
 */
export function AutoRefresh() {
  const router = useRouter()
  const pathname = usePathname()
  const failures = useRef(0)

  useEffect(() => {
    if (!autoRefreshAllowed(pathname)) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let lastRefreshAt = Date.now()
    let refreshed = false
    let failedSinceLast = false
    let cancelled = false

    const onFailure = () => {
      if (refreshed && Date.now() - lastRefreshAt < FAILURE_WINDOW_MS) failedSinceLast = true
    }
    window.addEventListener('error', onFailure)
    window.addEventListener('unhandledrejection', onFailure)

    const schedule = (delay: number) => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(tick, delay)
    }

    function tick() {
      if (cancelled) return
      const paused =
        document.hidden ||
        navigator.onLine === false ||
        isTypingTarget(document.activeElement) ||
        isBusy() ||
        isOverlayOpen()
      if (paused) {
        schedule(5_000) // look again soon; this does not count as a refresh
        return
      }
      // wait longer after a refresh that failed; back to the normal pace once one goes through cleanly
      if (refreshed) failures.current = failedSinceLast ? failures.current + 1 : 0
      failedSinceLast = false
      refreshed = true
      lastRefreshAt = Date.now()
      router.refresh()
      schedule(nextRefreshDelay(failures.current))
    }

    const onVisible = () => {
      // coming back to the tab after a while: catch up soon rather than waiting out the full wait
      if (!document.hidden && Date.now() - lastRefreshAt > 30_000) schedule(1_500)
    }
    document.addEventListener('visibilitychange', onVisible)

    schedule(nextRefreshDelay(0))
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('error', onFailure)
      window.removeEventListener('unhandledrejection', onFailure)
    }
  }, [router, pathname])

  return null
}
