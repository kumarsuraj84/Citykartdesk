'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { queueEvent } from '@/lib/events/client'

const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="checkbox"], summary'

/** Best-effort label for a clicked control — its visible text/aria label only, never field values. */
function labelFor(el: Element): string {
  const aria = el.getAttribute('aria-label') || el.getAttribute('title')
  const text = (aria || (el as HTMLElement).innerText || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim()
  const tag = el.tagName.toLowerCase()
  const href = tag === 'a' ? el.getAttribute('href') : null
  return `${tag}:${text.slice(0, 60)}${href ? ` -> ${href.slice(0, 80)}` : ''}`
}

/** Records page views, clicks and browser errors so problems can be traced afterwards. */
export function EventTracker() {
  const pathname = usePathname()

  useEffect(() => {
    queueEvent({ kind: 'pageview', path: pathname })
  }, [pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(CLICKABLE)
      if (el) queueEvent({ kind: 'click', path: location.pathname, target: labelFor(el) })
    }
    const onError = (e: ErrorEvent) =>
      queueEvent({
        kind: 'js_error',
        path: location.pathname,
        message: e.message,
        detail: { source: e.filename, line: e.lineno, col: e.colno },
      })
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      queueEvent({
        kind: 'js_error',
        path: location.pathname,
        message: r instanceof Error ? r.message : String(r),
        detail: { type: 'unhandledrejection', stack: r instanceof Error ? r.stack?.slice(0, 800) : undefined },
      })
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
