import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC]">
      <div className="text-center px-6 max-w-sm">
        <div className="flex justify-center mb-5">
          <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
            <FileQuestion className="h-7 w-7 text-muted-foreground" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
        <p className="text-muted-foreground text-sm mb-6">
          The page you're looking for doesn't exist or you don't have access to it.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            href="/home"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Home
          </Link>
          <Link
            href="/requests"
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            View Requests
          </Link>
        </div>
      </div>
    </div>
  )
}
