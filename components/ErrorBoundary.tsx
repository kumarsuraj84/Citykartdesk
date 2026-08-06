'use client'
import { Component, type ReactNode } from 'react'
import { reportError } from '@/lib/error-reporting'

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    reportError({
      error_type: 'crash',
      message: error.message,
      stack: error.stack,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md">{this.state.error?.message}</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload() }}
            className="btn-gradient"
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
