'use client'

import { AlertTriangle } from 'lucide-react'

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card px-8 py-16 text-center shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">Something went wrong</p>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load the admin panel. Please try again.
        </p>
      </div>
      <button
        onClick={reset}
        className="btn-gradient text-white"
      >
        Try again
      </button>
    </div>
  )
}
