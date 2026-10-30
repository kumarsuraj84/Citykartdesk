'use client'

import { RouteErrorView } from '@/components/ui/RouteErrorView'

// A ticket page that fails must not take the whole requests area down with it: this keeps the problem on this one page.
export default function RequestDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteErrorView error={error} reset={reset} what="This ticket" homeHref="/requests" homeLabel="Back to requests" />
}
