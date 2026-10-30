import { Clock, PauseCircle } from 'lucide-react'
import { computeSLAState } from '@/lib/utils'
import { isSlaPausedStatus } from '@/lib/constants/requests'
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

// Why the SLA clock is stopped, in the words shown next to "On Hold".
const PAUSE_REASONS: Record<string, string> = {
  waiting_user: 'Waiting on User',
  hold_purchase_ho: 'Purchase from HO',
  pending_approval: 'Pending Approval',
}

export function SLABadge({
  resolutionDueAt,
  responseDueAt,
  status,
  showLabel = false,
}: SLABadgeProps) {
  // A paused ticket (waiting on the user, on a purchase from HO, or on an approval) has its SLA timer stopped: it shows why, and is never "breached" or "at risk"
  if (isSlaPausedStatus(status)) {
    const reason = PAUSE_REASONS[status] ?? 'Paused'
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 whitespace-nowrap shrink-0"
        title={`SLA timer paused — ${reason}`}
      >
        <PauseCircle className="h-3 w-3" />
        On Hold · {reason}
      </span>
    )
  }

  const dueAt = resolutionDueAt ?? responseDueAt
  const state = computeSLAState(dueAt, status)

  if (state === 'none') return null

  const due = dueAt ? new Date(dueAt) : null
  const dueStr = due
    ? due.toLocaleString('en-US', {
        // India time, whatever time zone the PC is set to: the server and the browser then write the same text (a PC set to another zone made the page differ from its
        // server copy, which React reports as error #418 and the System Log recorded for several store users)
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
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
