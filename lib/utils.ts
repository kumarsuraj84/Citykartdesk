import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { RequestStatus, SLAState } from "@/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Statuses for which the SLA clock is no longer meaningful.
// Note: 'resolved' is included here (SLA display stops at resolution)
// even though it is not a lifecycle-terminal status (requests can be reopened).
// Use TERMINAL_STATUSES from lib/constants/requests for lifecycle decisions.
const SLA_INACTIVE_STATUSES: RequestStatus[] = ['resolved', 'closed', 'cancelled']

export function computeSLAState(
  dueAt: string | null,
  status: RequestStatus
): SLAState {
  if (!dueAt || SLA_INACTIVE_STATUSES.includes(status)) return 'none'
  const now = Date.now()
  const due = new Date(dueAt).getTime()
  if (due < now) return 'breached'
  const hoursRemaining = (due - now) / (1000 * 60 * 60)
  if (hoursRemaining < 4) return 'at_risk'
  return 'on_track'
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
