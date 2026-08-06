'use client'

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, Clock, Loader2, AlertCircle } from 'lucide-react'
import { getReclassifyProgress, type ReclassifyProgress } from '@/lib/actions/intake/pipeline'

// Poll interval while there are unclassified messages — short so the user sees
// progress without hammering the DB. Slows to 60 s once fully classified.
const POLL_PENDING_MS = 12_000
const POLL_DONE_MS = 60_000

export function PipelineStatusBanner() {
  const [data, setData] = useState<ReclassifyProgress | null>(null)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const progress = await getReclassifyProgress()
      setData(progress)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Adaptive polling: fast when pipeline is running, slow when done.
  useEffect(() => {
    if (data === null) return
    const pending = data.totalMessages - data.classified
    const interval = pending > 0 ? POLL_PENDING_MS : POLL_DONE_MS
    const id = setInterval(refresh, interval)
    return () => clearInterval(id)
  }, [data, refresh])

  if (error || data === null) return null

  const { totalMessages, classified } = data
  const pending = totalMessages - classified
  const isProcessing = pending > 0 && classified > 0
  const noneClassified = classified === 0 && totalMessages > 0
  const allDone = totalMessages > 0 && pending <= 0

  // If there are no messages at all, show nothing.
  if (totalMessages === 0) return null

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        allDone
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-400'
          : isProcessing
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-400'
          : noneClassified
          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-400'
          : 'border-border bg-muted/50 text-muted-foreground'
      }`}
    >
      {allDone ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      ) : isProcessing ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : noneClassified ? (
        <Clock className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      )}

      {allDone && (
        <span>
          <span className="font-semibold">{classified.toLocaleString()}</span> emails classified
        </span>
      )}

      {isProcessing && (
        <span>
          Classifying&nbsp;
          <span className="font-semibold">{classified.toLocaleString()}/{totalMessages.toLocaleString()}</span>
          &nbsp;·&nbsp;
          <span className="font-semibold">{pending.toLocaleString()}</span> pending
        </span>
      )}

      {noneClassified && (
        <span>
          <span className="font-semibold">{totalMessages.toLocaleString()}</span> emails queued for classification&nbsp;·&nbsp;processing soon
        </span>
      )}
    </div>
  )
}
