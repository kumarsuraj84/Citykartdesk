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
 * be reopened; once auto-closed (72h after resolving with no reopen) it's
 * permanent, for both agents and requesters.
 */

/** Transitions an agent/manager may trigger via the status panel. */
export const AGENT_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  open:             ['cancelled'],
  assigned:         ['cancelled'],
  in_progress:      ['waiting_user', 'resolved', 'cancelled'],
  waiting_user:     ['in_progress', 'resolved'],
  pending_approval: [],
  resolved:         ['open'],
  closed:           [],
  cancelled:        [],
}

/** Transitions a requester may trigger. */
export const REQUESTER_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  open:             ['cancelled'],
  assigned:         [],
  in_progress:      [],
  waiting_user:     ['open', 'cancelled'],
  pending_approval: [],
  resolved:         ['open'],
  closed:           [],
  cancelled:        [],
}
