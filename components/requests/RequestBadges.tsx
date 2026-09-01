/**
 * Shared badge primitives for request status, priority, and SLA.
 * All badge styles source from lib/constants/requests — no duplicates.
 */
import { RotateCcw } from 'lucide-react'
import { STATUS_LABELS, STATUS_STYLES, PRIORITY_BADGE_STYLES, PRIORITY_LABELS, PRIORITY_ARROWS } from '@/lib/constants/requests'
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

export function PriorityBadge({ priority, size = 'md' }: PriorityBadgeProps) {
  const base =
    size === 'sm'
      ? 'chip-3d gap-1 text-[11px] font-medium'
      : 'chip-3d gap-1 text-xs font-medium'

  return (
    <span className={`${base} ${PRIORITY_BADGE_STYLES[priority] ?? 'bg-gray-100 text-gray-600'}`}>
      <span className="font-bold leading-none">{PRIORITY_ARROWS[priority] ?? '·'}</span>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  )
}

// ── Reopened Badge ────────────────────────────────────────────────────────────
// A distinct, unmissable color (violet, used nowhere else in the status/
// priority palette) so a technician immediately recognizes "this ticket has
// history" — was resolved-then-reopened, or rejected-then-reopened — before
// they even open it. `count` shows how many times if it's happened more than once.

interface ReopenedBadgeProps {
  count: number
  size?: 'sm' | 'md'
}

export function ReopenedBadge({ count, size = 'md' }: ReopenedBadgeProps) {
  if (count <= 0) return null
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0'
  return (
    <span
      className={`${base} border border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300`}
      title={`Reopened ${count} time${count > 1 ? 's' : ''} — check the conversation for why.`}
    >
      <RotateCcw className="h-3 w-3" />
      Reopened{count > 1 ? ` ×${count}` : ''}
    </span>
  )
}
