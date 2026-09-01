'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RotateCcw, Loader2, Clock } from 'lucide-react'
import { updateRequestStatus } from '@/lib/actions/requests'

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'expired'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Only the requester sees this — a request cancelled because an approval was
// rejected can be an honest mistake, so they (not the technician) get a
// narrow window to send it back to the same technician rather than it being
// a permanent dead end like every other cancellation.
export function ApprovalRejectedReopenBanner({
  requestId,
  reopenDeadlineAt,
}: {
  requestId: string
  reopenDeadlineAt: string
}) {
  const router = useRouter()
  const [remaining, setRemaining] = useState(() => new Date(reopenDeadlineAt).getTime() - Date.now())
  const [isReopening, setIsReopening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(reopenDeadlineAt).getTime() - Date.now()), 30_000)
    return () => clearInterval(id)
  }, [reopenDeadlineAt])

  if (remaining <= 0) return null

  function handleReopen() {
    setError(null)
    setIsReopening(true)
    updateRequestStatus(requestId, 'assigned').then((result) => {
      setIsReopening(false)
      if (result?.error) { setError(result.error); toast.error(result.error); return }
      toast.success('Request reopened and sent back to the technician.')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 dark:border-violet-700 dark:bg-violet-950/40">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
          This request was rejected during approval.
        </p>
        <p className="mt-0.5 text-xs text-violet-800/80 dark:text-violet-300/80">
          Approvals are sometimes rejected by mistake — you can reopen this and send it back to the technician.
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1 text-[11px] text-violet-700/80 dark:text-violet-400/80">
          <Clock className="h-3 w-3" />
          {formatCountdown(remaining)} left to reopen
        </span>
        <button
          onClick={handleReopen}
          disabled={isReopening}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
        >
          {isReopening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reopen Request
        </button>
      </div>
    </div>
  )
}
