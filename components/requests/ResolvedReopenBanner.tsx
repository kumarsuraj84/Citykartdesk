'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RotateCcw, Loader2, Clock, XCircle } from 'lucide-react'
import { updateRequestStatus } from '@/lib/actions/requests'

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'expired'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

/** "72 hours" -> "72 hours"; a clean multiple of 24 reads better as days ("3 days"). */
function formatWindow(hours: number): string {
  if (hours > 0 && hours % 24 === 0) {
    const days = hours / 24
    return `${days} day${days === 1 ? '' : 's'}`
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

/**
 * Only the requester sees this, only while the ticket is Resolved. Reopening a
 * resolved ticket through the generic status dropdown is buried and easy to miss —
 * this is the one obvious "not actually fixed? reopen it" control, with a live
 * countdown against the admin-configured window (Request Configuration → General).
 * Once that window passes, the same spot tells them plainly it's too late and to log
 * a fresh ticket, instead of the reopen option just silently disappearing.
 */
export function ResolvedReopenBanner({
  requestId,
  reopenDeadlineAt,
  windowHours,
}: {
  requestId: string
  reopenDeadlineAt: string
  windowHours: number
}) {
  const router = useRouter()
  const [remaining, setRemaining] = useState(() => new Date(reopenDeadlineAt).getTime() - Date.now())
  const [showForm, setShowForm] = useState(false)
  const [comment, setComment] = useState('')
  const [isReopening, setIsReopening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(reopenDeadlineAt).getTime() - Date.now()), 30_000)
    return () => clearInterval(id)
  }, [reopenDeadlineAt])

  const expired = remaining <= 0
  const windowLabel = formatWindow(windowHours)

  function handleReopen() {
    if (!comment.trim()) { setError('Please add a short note on what’s still wrong.'); return }
    setError(null)
    setIsReopening(true)
    updateRequestStatus(requestId, 'open', comment.trim()).then((result) => {
      setIsReopening(false)
      if (result?.error) { setError(result.error); toast.error(result.error); return }
      toast.success('Request reopened.')
      router.refresh()
    })
  }

  if (expired) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          The {windowLabel} window to reopen this request has passed, so it can no longer be reopened.
          Still having the issue? Please log a new request.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Not actually fixed?
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
            You can reopen this within {windowLabel} of it being resolved — after that it closes for good.
          </p>
        </div>
        {!showForm && (
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
              <Clock className="h-3 w-3" />
              {formatCountdown(remaining)} left
            </span>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reopen Request
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <div className="mt-3 space-y-2">
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What's still wrong? This helps the technician pick up where they left off."
            rows={2}
            className="w-full resize-none rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-400/40 dark:border-amber-700 dark:bg-amber-950/60"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleReopen}
              disabled={isReopening}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {isReopening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Confirm Reopen
            </button>
            <button
              onClick={() => { setShowForm(false); setComment(''); setError(null) }}
              disabled={isReopening}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300"
            >
              Cancel
            </button>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
              <Clock className="h-3 w-3" />
              {formatCountdown(remaining)} left
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
