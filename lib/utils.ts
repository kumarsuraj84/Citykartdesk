import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { RequestStatus, SLAState } from "@/types"
import { isClosedLikeStatus, isSlaPausedStatus } from "@/lib/constants/requests"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// The SLA clock is not meaningful for a finished ticket (resolved/closed/cancelled: SLA display stops at resolution even though a resolved
// ticket can be reopened) and is STOPPED for a paused one (waiting on the user, on a purchase, on an approval): its deadline moves out by the
// pause when it resumes, so a paused ticket is never "breached" or "at risk". Callers show the pause itself (see SLABadge).
// Use TERMINAL_STATUSES from lib/constants/requests for lifecycle decisions.
export function computeSLAState(
  dueAt: string | null,
  status: RequestStatus
): SLAState {
  if (!dueAt || isClosedLikeStatus(status) || isSlaPausedStatus(status)) return 'none'
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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' })
}

/** Absolute "Jan 5, 2026, 3:45 PM" timestamp — pairs with formatRelativeTime()
 *  wherever a reader might want the exact moment, not just "3h ago". */
// 24-hour clock, no AM/PM — the standard for every time shown across the app.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
