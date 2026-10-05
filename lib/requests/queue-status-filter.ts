import type { RequestStatus } from '@/types'

export type QueueStatusFilter = RequestStatus | 'unresolved' | undefined

/**
 * Status filter for the technicians' Agent Requests page. By default (no choice, or "Active") it
 * shows only work still in flight — resolved, closed and cancelled tickets are hidden so a
 * technician isn't confused between pending and finished tickets, and a ticket disappears from
 * the list once resolved. Resolved/Closed/etc. are still one filter choice away; "all" shows
 * everything.
 */
export function resolveQueueStatusFilter(rawStatus: string | undefined): QueueStatusFilter {
  if (rawStatus === 'all') return undefined
  if (!rawStatus || rawStatus === 'active' || rawStatus === 'unresolved') return 'unresolved'
  return rawStatus as RequestStatus
}
