'use client'

// DESK-BLANKPAGE-001: this app had no global-error.tsx at all. app/layout.tsx
// wraps {children} in a custom <ErrorBoundary> (components/ErrorBoundary.tsx),
// but that only catches render errors *inside* the tree it wraps — an error
// thrown by Next.js's own root-level machinery, or anything above where
// ErrorBoundary sits, had nowhere to go and could render blank. This is the
// last-resort catch-all Next.js looks for specifically at this path; unlike
// a route segment's error.tsx, it must render its own <html>/<body> since it
// replaces the root layout entirely when it fires.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="flex h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
          <p className="max-w-md text-sm text-gray-500">
            The page ran into an unexpected error. Reloading usually fixes this.
          </p>
          <button
            onClick={() => { reset(); window.location.reload() }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  )
}
