'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

// The version this page was loaded with, fixed into the code at build time.
const LOADED_BUILD = process.env.NEXT_PUBLIC_BUILD_ID

const CHECK_EVERY_MS = 5 * 60 * 1000

/**
 * After a deployment, pages people already had open keep running the old code and can hit odd
 * errors ("Server Action not found", display mismatches). This asks the server which version is
 * live — every few minutes and whenever the tab is brought back — and offers a one-click refresh
 * when it differs from the version this page was loaded with.
 */
export function NewVersionBanner() {
  const [stale, setStale] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!LOADED_BUILD || LOADED_BUILD === 'dev') return
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { buildId } = (await res.json()) as { buildId?: string }
        if (!cancelled && buildId && buildId !== LOADED_BUILD) setStale(true)
      } catch {
        // Offline or the server is restarting: say nothing, try again later.
      }
    }

    const timer = setInterval(check, CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!stale || dismissed) return null

  return (
    <div
      role="status"
      className="fixed bottom-20 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-primary/30 bg-card px-4 py-3 shadow-2xl md:bottom-6"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1 text-xs text-foreground">
        <strong>A new version of Citykart Desk is available.</strong> Refresh to get the latest and avoid errors.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="btn-gradient shrink-0 px-3 py-1.5 text-xs"
      >
        Refresh
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Remind me later"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
