'use client'
import { Component, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { reportError } from '@/lib/error-reporting'
import { queueEvent, flushEvents } from '@/lib/events/client'

interface Props { children: ReactNode; resetKey?: string; onRetry?: () => void }
interface State { hasError: boolean; error?: Error & { digest?: string }; key?: string }

class Boundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, key: props.resetKey }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  // Moving to another page clears the error: one broken page must not leave every other page dead until a full reload.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { key: props.resetKey, hasError: false, error: undefined }
    return null
  }

  componentDidCatch(error: Error) {
    queueEvent({ kind: 'render_error', path: typeof location !== 'undefined' ? location.pathname : undefined, message: error.message, detail: { stack: error.stack?.slice(0, 800), type: 'react_boundary' } })
    flushEvents()
    reportError({
      error_type: 'crash',
      message: error.message,
      stack: error.stack,
    })
  }

  private retry = () => {
    // Ask the server for fresh data first, then draw the page again.
    this.props.onRetry?.()
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (this.state.hasError) {
      // The raw error text is not shown: in production it is a generic Next.js sentence that means nothing to a user.
      const digest = this.state.error?.digest
      return (
        <div role="alert" className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">This page could not load</h2>
          <p className="text-sm text-muted-foreground max-w-md">Try again. If it keeps happening, tell your admin.</p>
          {digest && <p className="text-xs text-muted-foreground">Reference: {digest}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={this.retry} className="btn-gradient">Try again</button>
            <Link href="/home" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Go to Home</Link>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  return <Boundary resetKey={pathname} onRetry={() => router.refresh()}>{children}</Boundary>
}
