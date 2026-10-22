/**
 * Request status transition matrices — single source of truth.
 *
 * Architectural decision (Pre-Sprint 3 Stabilization):
 *
 *   open → assigned  is NOT a manual status transition.
 *
 * The `assigned` status is reached exclusively through the AssignmentPanel
 * (which calls assignRequest(), which auto-promotes open → assigned).
 * Keeping assignment-as-status separate from workflow-transitions prevents
 * the two mechanisms from fighting each other and keeps the StatusTransitionPanel
 * focused on workflow progression.
 *
 * Both lib/actions/requests.ts (server) and
 * components/requests/StatusTransitionPanel.tsx (client)
 * MUST import from this file — no local copies.
 */

import type { RequestStatus } from '@/types'

/**
 * open/assigned → in_progress is deliberately NOT here even though it's a
 * real transition an agent can make — it's reachable ONLY through the
 * dedicated "Start Working" button (RequestActionBar), which forces the
 * mandatory first-response message through the same modal. Listing it here
 * too would let the generic status dropdown (RequestSidebarPanel's
 * StatusRow) skip that message entirely.
 *
 * closed has no outgoing transitions at all — only a *resolved* ticket can
 * be reopened; once auto-closed (admin-configurable days after resolving
 * with no reopen — Request Configuration → General) it's permanent, for
 * both agents and requesters.
 */

/** Transitions an agent/manager may trigger via the status panel. */
export const AGENT_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  open:             ['cancelled'],
  assigned:         ['cancelled'],
  in_progress:      ['waiting_user', 'hold_purchase_ho', 'resolved', 'cancelled'],
  waiting_user:     ['in_progress', 'resolved'],
  // Only a technician can set this or move it back to in_progress — the
  // requester's matching row below is intentionally empty. Reachable only
  // from in_progress, mirroring waiting_user, per the app owner's spec.
  hold_purchase_ho: ['in_progress'],
  pending_approval: [],
  resolved:         ['open'],
  closed:           [],
  cancelled:        [],
}

/**
 * Transitions a vendor technician may make on a ticket assigned to him. A vendor never cancels, never reassigns and never reopens.
 * open/assigned → in_progress is the "Start working" step (it needs the OEM ticket number); in_progress → hold_purchase_ho is reachable only through the
 * "Part required" / "PO required" windows; hold_purchase_ho → in_progress is "Parts received" (the vendor request screens check the rest).
 */
export const VENDOR_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  open:             ['in_progress'],
  assigned:         ['in_progress'],
  in_progress:      ['resolved', 'hold_purchase_ho'],
  waiting_user:     [],
  hold_purchase_ho: ['in_progress'],
  pending_approval: [],
  resolved:         [],
  closed:           [],
  cancelled:        [],
}

/** Transitions a requester may trigger. */
export const REQUESTER_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  open:             ['cancelled'],
  assigned:         [],
  in_progress:      [],
  waiting_user:     ['open', 'cancelled'],
  // Deliberately empty — the requester has no way to set or leave this status
  // themselves; only a technician can (see AGENT_TRANSITIONS above).
  hold_purchase_ho: [],
  pending_approval: [],
  resolved:         ['open'],
  closed:           [],
  cancelled:        [],
}

/**
 * Status moves a Business Rule (or any other automatic server step) may make. It is the same list the database keeps in request_status_transition_allowed(),
 * plus the automatic closing of a resolved ticket. A rule can no longer jump a ticket to any status (VAPT-008): for example, it cannot revive a cancelled
 * ticket or close one that was never resolved. tests/vapt/23-business-rule-limits.test.ts compares this list with the database function.
 */
export const SERVER_ALLOWED_TRANSITIONS: ReadonlyArray<readonly [RequestStatus, RequestStatus]> = [
  ['open', 'assigned'], ['open', 'in_progress'], ['open', 'cancelled'],
  ['assigned', 'open'], ['assigned', 'in_progress'], ['assigned', 'cancelled'],
  ['in_progress', 'waiting_user'], ['in_progress', 'hold_purchase_ho'], ['in_progress', 'resolved'], ['in_progress', 'cancelled'],
  ['waiting_user', 'in_progress'], ['waiting_user', 'resolved'], ['waiting_user', 'open'], ['waiting_user', 'cancelled'],
  ['hold_purchase_ho', 'in_progress'], ['hold_purchase_ho', 'cancelled'],   // cancelled: only when a PO is rejected
  ['resolved', 'open'],
  ['resolved', 'closed'],
]

export function isServerTransitionAllowed(from: string, to: string): boolean {
  return from === to || SERVER_ALLOWED_TRANSITIONS.some(([a, b]) => a === from && b === to)
}
