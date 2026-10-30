'use client'

import { useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { queueEvent, flushEvents } from '@/lib/events/client'

/**
 * One friendly "this page could not load" screen for every route error file.
 * reset() alone only clears the error and re-draws the same broken result, it does not ask
 * the server again. So "Try again" first asks the server for fresh data (router.refresh())
 * and only then clears the error.
 */
export function RouteErrorView({
  error,
  reset,
  what = 'This page',
  homeHref = '/home',
  homeLabel = 'Go to Home',
}: {
  error: Error & { digest?: string }
  reset: () => void
  what?: string
  homeHref?: string
  homeLabel?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    // Record the crash with the server's reference so it can be matched to the server log.
    queueEvent({ kind: 'render_error', path: location.pathname, message: error.message, detail: { digest: error.digest, type: 'route_error' } })
    flushEvents()
  }, [error])

  function tryAgain() {
    startTransition(() => {
      router.refresh()
      reset()
    })
  }

  return (
    <div role="alert" className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card px-8 py-16 text-center shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{what} could not load</p>
        <p className="text-sm text-muted-foreground">Please try again. If it keeps happening, tell your admin.</p>
        {error.digest && <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={tryAgain} disabled={pending} className="btn-gradient text-white disabled:opacity-60">
          {pending ? 'Trying…' : 'Try again'}
        </button>
        <Link href={homeHref} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          {homeLabel}
        </Link>
      </div>
    </div>
  )
}
