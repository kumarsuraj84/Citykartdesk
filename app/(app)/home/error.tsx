'use client'

import { RouteErrorView } from '@/components/ui/RouteErrorView'

export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteErrorView error={error} reset={reset} what="Your dashboard" />
}
