'use client'
import { useEffect, useState } from 'react'
import { isChunkLoadError, reloadForChunkError } from '@/lib/ui/chunk-recovery'

// DESK-BLANKPAGE-001: after any redeploy, a browser tab left open from before it will throw a ChunkLoadError the moment it tries to lazily fetch a JS chunk by its old
// (now-replaced) hashed filename - e.g. clicking a Link to a route segment that wasn't already loaded. Neither React's own hydration machinery nor components/ErrorBoundary.tsx
// reliably catches this: it commonly surfaces as an unhandled promise rejection from the dynamic import itself, and can leave the page blank until the user manually refreshes.
//
// Fix: catch that one well-known failure at the window level and reload automatically - but only a limited number of times (lib/ui/chunk-recovery.ts: 2 in 10 minutes).
// It used to be "once every 10 seconds", so a browser that kept failing reloaded and logged errors for hours (1,507 events from one person on 3 Nov). When the limit is used up,
// the person is shown a small notice that says what to do instead of the page looping.
export function ChunkErrorRecovery() {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    function recover() { if (!reloadForChunkError()) setStuck(true) }
    function onError(event: ErrorEvent) {
      if (isChunkLoadError(event.message) || isChunkLoadError(event.error?.message)) recover()
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { message?: string } | string | undefined
      const message = typeof reason === 'string' ? reason : reason?.message
      if (isChunkLoadError(message)) recover()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (!stuck) return null
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>A new version of Citykart Desk is available and this page could not load it. Please press <strong>Ctrl + F5</strong> to refresh.</span>
      <button type="button" onClick={() => window.location.reload()} className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-amber-100">Refresh now</button>
    </div>
  )
}
