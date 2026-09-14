// D-01: "SLA Breached" was computed three different ways across the app,
// all shown under labels that don't say which one they mean:
//
//   Category A — "Currently Breached": the ticket is open RIGHT NOW and its
//   deadline has already passed. A ticket that was resolved late no longer
//   counts once it's resolved/closed — this is a live, operational number
//   ("what needs attention today"), not a historical one.
//
//   Category B — "Ever Breached / Resolved Late": among tickets that HAVE
//   been resolved, did the resolution happen after the deadline. Ignores
//   currently-open tickets entirely — this is a historical/quality number
//   ("how well did we hit our deadlines"), not a live one.
//
// Neither is wrong — a live ops dashboard legitimately wants Category A, a
// compliance report legitimately wants the resolved-outcome view Category B
// implies. The defect was that Home Dashboard/Monitoring/the Admin Analytics
// KPI card (Category A) and the Report Builder/its CSV/XLSX export
// (a broader definition, see isEverBreached below) were all labelled or
// described with bare "SLA Breached" text, and each surface reimplemented
// its own formula ad hoc, so a fix to one could silently drift from the
// others. This module gives each formula exactly one implementation.
//
// isEverBreached() is the Report Builder's existing formula, which is
// actually the more complete of the two "did we hit the deadline" views: it
// already counts a resolved-late ticket as breached even after it closes
// (Category B, but not limited to only resolved tickets — an open ticket
// past its deadline is "breached" too, same as Category A). Kept as its own
// named function rather than folded into isCurrentlyBreached because a
// historical/compliance report and a live ops dashboard have genuinely
// different, both-correct questions to answer.

export type ResolutionBreachInput = {
  resolution_due_at: string | null
  status: string
}

export type EverBreachedInput = {
  resolution_due_at: string | null
  resolved_at: string | null
  closed_at: string | null
}

export type EverResponseBreachedInput = {
  response_due_at: string | null
  responded_at: string | null
}

/** Statuses that mean "no longer actively worked" — a ticket in one of these
 *  can never be "currently breached," only "ever breached" (see below). */
export const CLOSED_LIKE_STATUSES = ['resolved', 'closed', 'cancelled'] as const

/** Category A: open right now AND past its resolution deadline. Excludes
 *  anything already resolved/closed/cancelled, however late it was. */
export function isCurrentlyBreached(row: ResolutionBreachInput, now: Date = new Date()): boolean {
  if (!row.resolution_due_at) return false
  if ((CLOSED_LIKE_STATUSES as readonly string[]).includes(row.status)) return false
  return new Date(row.resolution_due_at) < now
}

/** The "ever breached" view: still-open tickets are breached the moment
 *  they pass their deadline (same live condition as isCurrentlyBreached);
 *  once resolved/closed, whether it was breached is fixed forever by
 *  whether that happened after the deadline — resolving/closing a ticket
 *  can never retroactively un-breach it. */
export function isEverBreached(row: EverBreachedInput, now: Date = new Date()): boolean {
  if (!row.resolution_due_at) return false
  const closedLike = row.resolved_at ?? row.closed_at
  return closedLike ? closedLike > row.resolution_due_at : now.toISOString() > row.resolution_due_at
}

/** Same "ever breached" shape, for the separate first-response SLA. */
export function isEverResponseBreached(row: EverResponseBreachedInput, now: Date = new Date()): boolean {
  if (!row.response_due_at) return false
  return row.responded_at ? row.responded_at > row.response_due_at : now.toISOString() > row.response_due_at
}

/** Query-builder equivalent of isCurrentlyBreached(), for the two call
 *  sites that filter at the database instead of an already-fetched array
 *  (lib/queries/admin.ts's monitoring count, lib/actions/analytics.ts's
 *  slaBreached drawer filter). Generic over any Supabase/PostgREST query
 *  builder exposing .lt()/.not() with the same chaining shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCurrentlyBreachedFilter<T extends { lt: (...args: any[]) => T; not: (...args: any[]) => T }>(
  query: T,
  nowIso: string = new Date().toISOString()
): T {
  return query
    .lt('resolution_due_at', nowIso)
    .not('status', 'in', `(${CLOSED_LIKE_STATUSES.map((s) => `"${s}"`).join(',')})`)
}
