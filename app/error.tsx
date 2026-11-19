'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { queueEvent, flushEvents } from '@/lib/events/client'
import { isChunkLoadError, reloadForChunkError } from '@/lib/ui/chunk-recovery'

const MAX_AUTO_RETRIES = 6
/** messages already reported in this page load (a retry loop must not write the same line again and again) */
const reportedMessages = new Set<string>()

/**
 * Root error boundary. A momentary failure (e.g. the profile could not be loaded
 * because of a brief database/network hiccup) used to send the user to /login and
 * back to /home in a loop. Now the user stays on the same URL and the page is
 * quietly re-requested until it loads.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  const [tries, setTries] = useState(0)
  const [chunkStuck, setChunkStuck] = useState(false)
  // a page file that cannot be loaded (the tab is from an older version of the app) is not cured by asking the server for the page again: it needs a reload of the whole page
  const chunkError = isChunkLoadError(error.message)

  useEffect(() => {
    // Record every crash (with the server's digest to match it to the server log) - but the same message only once per page load: one stuck browser wrote 3,344 identical lines.
    if (reportedMessages.has(error.message)) return
    reportedMessages.add(error.message)
    queueEvent({ kind: 'render_error', path: location.pathname, message: error.message, detail: { digest: error.digest } })
    flushEvents()
  }, [error])

  useEffect(() => {
    if (!chunkError) return
    // a limited number of reloads (lib/ui/chunk-recovery.ts); after that the person is told to press Ctrl+F5
    const t = setTimeout(() => { if (!reloadForChunkError()) setChunkStuck(true) }, 300)
    return () => clearTimeout(t)
  }, [chunkError])

  useEffect(() => {
    if (chunkError) return
    if (tries >= MAX_AUTO_RETRIES) return
    const t = setTimeout(() => {
      router.refresh()
      reset()
      setTries((n) => n + 1)
    }, Math.min(800 * (tries + 1), 4000))
    return () => clearTimeout(t)
  }, [tries, router, reset, chunkError])

  const gaveUp = tries >= MAX_AUTO_RETRIES

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      {chunkStuck ? (
        <div className="max-w-sm space-y-3 text-center">
          <p className="text-sm font-semibold text-foreground">A new version of Citykart Desk is available</p>
          <p className="text-xs text-muted-foreground">This page could not load it. Please press Ctrl + F5 to refresh. Your session is still active.</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">Refresh now</button>
        </div>
      ) : gaveUp && !chunkError ? (
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
