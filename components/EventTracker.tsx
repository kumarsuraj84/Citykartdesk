'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { queueEvent } from '@/lib/events/client'
import { setFailureReporter } from '@/lib/syslog/failure-reporter'
import { errorCodeOfBody, judgeResponse, sourceOfUrl } from '@/lib/syslog/shape'

const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="checkbox"], summary'

/**
 * A stable name for a clicked control, never its visible text: that text can hold people's names and ticket titles,
 * and a link's address can hold search words or filters. Uses data-track, then the aria-label, then the tag and (for links)
 * the path of the address without its query string.
 */
export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const track = el.getAttribute('data-track')
  if (track) return `${tag}:${track.slice(0, 60)}`
  const aria = el.getAttribute('aria-label')
  if (aria) return `${tag}:${aria.slice(0, 60)}`
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? ''
    // keep only the path: no ?query, no #fragment, and ids in the path are not the point
    const path = href.split('#')[0].split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    return `a:${path.slice(0, 80)}`
  }
  const role = el.getAttribute('role')
  const type = el.getAttribute('type')
  return role ? `${tag}[${role}]` : type ? `${tag}[${type}]` : tag
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
    // failed calls the browser itself makes to the database / storage / auth service (a page that fails to load its data shows up here)
    setFailureReporter((r) => {
      const path = (() => { try { return new URL(r.url, location.href).pathname } catch { return r.url.slice(0, 120) } })()
      if (r.error !== undefined) {
        queueEvent({ kind: 'js_error', path: location.pathname, message: `${r.method} ${path}: the call failed`, detail: { type: 'service_call', service: sourceOfUrl(r.url), url: path } })
        return
      }
      const { code, message } = errorCodeOfBody(r.body ?? '')
      const v = judgeResponse(r.status ?? 0, sourceOfUrl(r.url), code, r.method)
      if (v.record && v.category === 'error') queueEvent({ kind: 'js_error', path: location.pathname, message: `${r.method} ${path} -> ${r.status}${message ? ': ' + message : ''}`, detail: { type: 'service_call', service: sourceOfUrl(r.url), status: r.status, code } })
    })
    document.addEventListener('click', onClick, true)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      setFailureReporter(null)
    }
  }, [])

  return null
}
