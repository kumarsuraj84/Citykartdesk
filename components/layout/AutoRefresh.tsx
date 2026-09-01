'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const REFRESH_INTERVAL_MS = 12_000

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/**
 * Soft-refreshes every authenticated page on an interval via router.refresh()
 * — re-runs Server Component data fetches and patches the RSC tree in place,
 * no full page reload and no loss of client-side state (open drawers, form
 * state) — so status changes, new/assigned tickets, and approval decisions
 * made by someone else show up without the viewer manually reloading.
 * Skipped while the tab is hidden or the viewer is actively typing, so it
 * never interrupts a comment/rule/form in progress.
 */
export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      if (isTypingTarget(document.activeElement)) return
      router.refresh()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [router])

  return null
}
