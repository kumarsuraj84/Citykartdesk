import type { RequestStatus } from '@/types'

// ── Status ────────────────────────────────────────────────────────────────────

/** Every status that still means work to do (what "Open now" counts on the dashboards and Home). */
export const OPEN_REQUEST_STATUSES = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval'] as const

/**
 * Statuses where the ticket's SLA clock is STOPPED (the ticket waits for somebody outside the technician's control). One list for the whole app: the server pauses on exactly
 * these (lib/requests/status-change.ts), so every screen, count and rule must treat them as "paused", never as "breached" or "running".
 */
export const PAUSED_SLA_STATUSES = ['waiting_user', 'hold_purchase_ho', 'pending_approval'] as const
export const isSlaPausedStatus = (status: string | null | undefined): boolean => (PAUSED_SLA_STATUSES as readonly string[]).includes(status ?? '')

/** Statuses that are finished: no SLA, no work left. (TERMINAL_STATUSES below means only closed / cancelled: nothing more can happen at all.) */
export const CLOSED_LIKE_REQUEST_STATUSES = ['resolved', 'closed', 'cancelled'] as const
export const isClosedLikeStatus = (status: string | null | undefined): boolean => (CLOSED_LIKE_REQUEST_STATUSES as readonly string[]).includes(status ?? '')

export const STATUS_LABELS: Record<RequestStatus, string> = {
  open:             'Open',
  assigned:         'Assigned',
  in_progress:      'In Progress',
  waiting_user:     'Waiting on User',
  hold_purchase_ho: 'Hold due to Purchase from HO',
  pending_approval: 'Pending Approval',
  resolved:         'Resolved',
  closed:           'Closed',
  cancelled:        'Cancelled',
}

export const STATUS_STYLES: Record<RequestStatus, string> = {
  open:             'bg-blue-50 text-blue-700 border border-blue-100',
  assigned:         'bg-sky-50 text-sky-700 border border-sky-100',
  in_progress:      'bg-indigo-50 text-indigo-700 border border-indigo-100',
  waiting_user:     'bg-orange-50 text-orange-700 border border-orange-100',
  hold_purchase_ho: 'bg-amber-50 text-amber-700 border border-amber-100',
  pending_approval: 'bg-violet-50 text-violet-700 border border-violet-100',
  resolved:         'bg-emerald-50 text-emerald-700 border border-emerald-100',
  closed:           'bg-slate-100 text-slate-600 border border-slate-200',
  cancelled:        'bg-red-50 text-red-600 border border-red-100',
}

// ── Priority ──────────────────────────────────────────────────────────────────

/** Text-only colour — used for inline priority labels in list rows. */
export const PRIORITY_TEXT_STYLES: Record<string, string> = {
  low:    'text-slate-500',
  medium: 'text-blue-600',
  high:   'text-orange-600',
  urgent: 'text-red-600',
}

/** Badge style (bg + text) — used for pill badges on detail pages. */
export const PRIORITY_BADGE_STYLES: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
}

export const PRIORITY_ARROWS: Record<string, string> = {
  low: '↓', medium: '→', high: '↑', urgent: '↑↑',
}

// ── Terminal statuses ─────────────────────────────────────────────────────────

/** Statuses that end the request lifecycle — no further transitions allowed. */
export const TERMINAL_STATUSES: RequestStatus[] = ['closed', 'cancelled']
