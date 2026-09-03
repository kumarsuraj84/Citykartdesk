import type { RequestStatus } from '@/types'

// ── Status ────────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<RequestStatus, string> = {
  open:             'Open',
  assigned:         'Assigned',
  in_progress:      'In Progress',
  waiting_user:     'Waiting on User',
  pending_approval: 'Pending Approval',
  resolved:         'Resolved',
  closed:           'Closed',
  cancelled:        'Cancelled',
}

/** Hours after resolving a request that the requester (or the resolving agent) may still reopen it. */
export const RESOLVED_REOPEN_WINDOW_HOURS = 72

export const STATUS_STYLES: Record<RequestStatus, string> = {
  open:             'bg-blue-50 text-blue-700 border border-blue-100',
  assigned:         'bg-sky-50 text-sky-700 border border-sky-100',
  in_progress:      'bg-indigo-50 text-indigo-700 border border-indigo-100',
  waiting_user:     'bg-orange-50 text-orange-700 border border-orange-100',
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
