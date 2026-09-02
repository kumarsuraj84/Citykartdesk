'use client'

import { useState, useEffect } from 'react'
import { Timer, CheckCircle2, PauseCircle } from 'lucide-react'
import type { RequestStatus } from '@/types'

interface SLACountdownClocksProps {
  responseDueAt: string | null
  resolutionDueAt: string | null
  respondedAt: string | null
  resolvedAt: string | null
  status: RequestStatus
  waitingSince: string | null
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  const s = Math.floor((abs % 60_000) / 1000)
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

// One SLA countdown — ticks live toward zero then goes negative (breached).
// Freezes once its milestone actually happens (responded_at/resolved_at),
// and freezes-in-place (doesn't keep ticking) while the ticket is on hold,
// since the due date itself gets extended by the pause once it resumes
// rather than continuously — see updateRequestStatus/rejectApproval.
function SingleClock({
  label,
  theme,
  dueAt,
  stoppedAt,
  isPaused,
  pausedSinceMs,
}: {
  label: string
  theme: string
  dueAt: string | null
  stoppedAt: string | null
  isPaused: boolean
  pausedSinceMs: number | null
}) {
  // `now` starts null so the very first client render matches the server's
  // (neither knows "now") — filling it in only after mount, in an effect,
  // avoids a hydration mismatch from the server and client computing
  // Date.now() at two different instants.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    if (stoppedAt || isPaused || !dueAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [stoppedAt, isPaused, dueAt])

  if (!dueAt) return null
  const dueMs = new Date(dueAt).getTime()

  if (stoppedAt) {
    const remaining = dueMs - new Date(stoppedAt).getTime()
    const breached = remaining < 0
    return (
      <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${breached ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${breached ? 'text-red-600' : 'text-emerald-600'}`} />
        <span className={`text-xs font-medium ${breached ? 'text-red-700' : 'text-emerald-700'}`}>
          {label} {breached ? `breached — ${formatDuration(remaining)} over` : `met — ${formatDuration(remaining)} to spare`}
        </span>
      </div>
    )
  }

  // Paused doesn't depend on "now" at all, so it's safe pre-mount; a live
  // clock has no safe value yet — render a stable placeholder until mounted.
  if (!isPaused && now === null) {
    return (
      <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${theme}`}>
        <Timer className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono text-xs font-semibold tabular-nums">{label}: —</span>
      </div>
    )
  }

  const remaining = isPaused && pausedSinceMs != null ? dueMs - pausedSinceMs : dueMs - (now as number)
  const breached = remaining < 0

  return (
    <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${breached ? 'border-red-200 bg-red-50' : theme}`}>
      {isPaused ? <PauseCircle className="h-3.5 w-3.5 shrink-0" /> : <Timer className="h-3.5 w-3.5 shrink-0" />}
      <span className={`font-mono text-xs font-semibold tabular-nums ${breached ? 'text-red-700' : ''}`}>
        {label}: {breached ? '-' : ''}{formatDuration(remaining)}
        {isPaused && <span className="ml-1 font-sans font-normal opacity-70">(paused)</span>}
      </span>
    </div>
  )
}

/** Two live SLA countdowns shown together — Response (blue) and Resolution
 *  (purple) — visually distinct so a technician never confuses which is
 *  which, both counting down to zero and turning red/negative on breach. */
export function SLACountdownClocks({
  responseDueAt,
  resolutionDueAt,
  respondedAt,
  resolvedAt,
  status,
  waitingSince,
}: SLACountdownClocksProps) {
  const isPaused = status === 'waiting_user' || status === 'pending_approval'
  const pausedSinceMs = isPaused && waitingSince ? new Date(waitingSince).getTime() : null

  if (!responseDueAt && !resolutionDueAt) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SingleClock
        label="Response"
        theme="border-blue-200 bg-blue-50 text-blue-700"
        dueAt={responseDueAt}
        stoppedAt={respondedAt}
        isPaused={isPaused}
        pausedSinceMs={pausedSinceMs}
      />
      <SingleClock
        label="Resolution"
        theme="border-purple-200 bg-purple-50 text-purple-700"
        dueAt={resolutionDueAt}
        stoppedAt={resolvedAt}
        isPaused={isPaused}
        pausedSinceMs={pausedSinceMs}
      />
    </div>
  )
}
