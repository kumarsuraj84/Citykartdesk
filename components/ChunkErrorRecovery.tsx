'use client'
import { useEffect } from 'react'

// DESK-BLANKPAGE-001: after any redeploy, a browser tab left open from
// before it will throw a ChunkLoadError the moment it tries to lazily fetch
// a JS chunk by its old (now-replaced) hashed filename — e.g. clicking a
// Link to a route segment that wasn't already loaded. Neither React's own
// hydration machinery nor components/ErrorBoundary.tsx (which only catches
// errors *inside* the render tree it wraps) reliably catches this: it
// commonly surfaces as an unhandled promise rejection from the dynamic
// import itself, one level above any component-level try/catch, and can
// leave the page blank until the user manually refreshes — exactly the
// "goes blank while working, refresh fixes it" symptom this file exists
// to self-heal, and reported today, during a session with four separate
// redeploys.
//
// Fix: catch that one specific, well-known failure signature at the window
// level and reload automatically — once. The sessionStorage guard exists so
// a chunk that's missing for a *different* reason (a broken deployment,
// not a stale tab) fails visibly after one retry instead of reload-looping
// forever.
const RELOAD_GUARD_KEY = 'ck-chunk-error-reload-guard'
const GUARD_TTL_MS = 10_000

function isChunkLoadError(message: string | undefined | null): boolean {
  if (!message) return false
  return /Loading chunk .* failed|ChunkLoadError|Failed to fetch dynamically imported module/i.test(message)
}

function recoverOnce() {
  let lastReload = 0
  try {
    lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0)
  } catch {
    // sessionStorage unavailable (private mode, etc.) — fall back to a
    // single in-memory attempt for this page load only.
  }
  if (Date.now() - lastReload < GUARD_TTL_MS) return // already just tried this — don't loop
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    // ignore — worst case this retries more than once in private mode
  }
  window.location.reload()
}

export function ChunkErrorRecovery() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      if (isChunkLoadError(event.message) || isChunkLoadError(event.error?.message)) recoverOnce()
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { message?: string } | string | undefined
      const message = typeof reason === 'string' ? reason : reason?.message
      if (isChunkLoadError(message)) recoverOnce()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
