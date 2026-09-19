'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { queueEvent, flushEvents } from '@/lib/events/client'

const MAX_AUTO_RETRIES = 6

/**
 * Root error boundary. A momentary failure (e.g. the profile could not be loaded
 * because of a brief database/network hiccup) used to send the user to /login and
 * back to /home in a loop. Now the user stays on the same URL and the page is
 * quietly re-requested until it loads.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const [tries, setTries] = useState(0)

  useEffect(() => {
    // Record every crash (with the server's digest to match it to the server log).
    queueEvent({ kind: 'render_error', path: location.pathname, message: error.message, detail: { digest: error.digest } })
    flushEvents()
  }, [error])

  useEffect(() => {
    if (tries >= MAX_AUTO_RETRIES) return
    const t = setTimeout(() => {
      router.refresh()
      reset()
      setTries((n) => n + 1)
    }, Math.min(800 * (tries + 1), 4000))
    return () => clearTimeout(t)
  }, [tries, router, reset])

  const gaveUp = tries >= MAX_AUTO_RETRIES

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      {gaveUp ? (
        <div className="max-w-sm space-y-3 text-center">
          <p className="text-sm font-semibold text-foreground">Can&apos;t reach the server right now</p>
          <p className="text-xs text-muted-foreground">Your session is still active. Try again in a moment.</p>
          <button
            type="button"
            onClick={() => setTries(0)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Try again
          </button>
        </div>
      ) : (
        <div role="status" aria-label="Loading" className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      )}
    </div>
  )
}
