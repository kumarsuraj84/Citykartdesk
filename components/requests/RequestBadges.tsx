/**
 * Shared badge primitives for request status, priority, and SLA.
 * All badge styles source from lib/constants/requests — no duplicates.
 */
import { STATUS_LABELS, STATUS_STYLES, PRIORITY_BADGE_STYLES } from '@/lib/constants/requests'
import type { RequestStatus, RequestPriority } from '@/types'

// ── Status Badge ──────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: RequestStatus
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0'

  return (
    <span className={`${base} ${STATUS_STYLES[status]}`}>
      <span className="h-1.5 w-1.5 rounded bg-current opacity-70" />
      {STATUS_LABELS[status]}
    </span>
  )
}

// ── Priority Badge ────────────────────────────────────────────────────────────

interface PriorityBadgeProps {
  priority: RequestPriority
  size?: 'sm' | 'md'
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
}

const PRIORITY_ARROWS: Record<string, string> = {
  low: '↓', medium: '→', high: '↑', urgent: '↑↑',
}

export function PriorityBadge({ priority, size = 'md' }: PriorityBadgeProps) {
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0'

  return (
    <span className={`${base} ${PRIORITY_BADGE_STYLES[priority] ?? 'bg-gray-100 text-gray-600'}`}>
      <span className="font-bold leading-none">{PRIORITY_ARROWS[priority] ?? '·'}</span>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  )
}
