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

/** Transitions an agent/manager may trigger via the status panel. */
export const AGENT_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  open:             ['in_progress', 'cancelled'],
  assigned:         ['in_progress', 'cancelled'],
  in_progress:      ['waiting_user', 'resolved', 'cancelled'],
  waiting_user:     ['in_progress', 'resolved'],
  pending_approval: [],
  resolved:         ['closed', 'open'],
  closed:           ['open'],
  cancelled:        [],
}

/** Transitions a requester may trigger. */
export const REQUESTER_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  open:             ['cancelled'],
  assigned:         [],
  in_progress:      [],
  waiting_user:     ['open', 'cancelled'],
  pending_approval: [],
  resolved:         ['closed', 'open'],
  closed:           [],
  cancelled:        [],
}
