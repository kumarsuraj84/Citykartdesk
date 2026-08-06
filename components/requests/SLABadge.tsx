import { Clock, PauseCircle } from 'lucide-react'
import { computeSLAState } from '@/lib/utils'
import type { RequestStatus } from '@/types'

interface SLABadgeProps {
  resolutionDueAt: string | null
  responseDueAt: string | null
  status: RequestStatus
  showLabel?: boolean
}

const SLA_STYLES = {
  on_track: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  at_risk:  'bg-amber-50 text-amber-700 border border-amber-100',
  breached: 'bg-red-50 text-red-700 border border-red-100',
} as const

const SLA_LABELS = {
  on_track: 'On track',
  at_risk:  'At risk',
  breached: 'SLA Breached',
} as const

export function SLABadge({
  resolutionDueAt,
  responseDueAt,
  status,
  showLabel = false,
}: SLABadgeProps) {
  // Special case: request is on hold waiting for approval — SLA timer paused
  if (status === 'pending_approval') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 whitespace-nowrap shrink-0"
        title="SLA timer paused — waiting for approval"
      >
        <PauseCircle className="h-3 w-3" />
        On Hold · Pending Approval
      </span>
    )
  }

  const dueAt = resolutionDueAt ?? responseDueAt
  const state = computeSLAState(dueAt, status)

  if (state === 'none') return null

  const due = dueAt ? new Date(dueAt) : null
  const dueStr = due
    ? due.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${SLA_STYLES[state]}`}
      title={dueStr ?? undefined}
    >
      <Clock className="h-3 w-3" />
      {showLabel ? SLA_LABELS[state] : dueStr}
    </span>
  )
}
