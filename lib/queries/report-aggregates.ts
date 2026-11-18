// The five per-ticket numbers the Report Builder shows next to each ticket (collaborators, attachments, comments, tracked minutes, CSAT rating).
// For a big report they come from ONE call to the database function report_request_aggregates (migration 210) instead of about 100 tickets per request
// to five tables (roughly 600 calls for 9,000 tickets). A small report, or a database without the function yet, uses the old way (`fallback`).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }> }

export interface RequestAggregates {
  collabCounts: Map<string, number>
  attachmentCounts: Map<string, number>
  commentCounts: Map<string, number>
  timeMinutes: Map<string, number>
  csatRatings: Map<string, number>
}

/** Below this many tickets the old per-ticket-batch way is just as quick (one or two calls per table), so the function is only used for bigger reports. */
export const AGGREGATES_RPC_MIN_TICKETS = 150

/** Reads the function's answer: a list of [ticket id, collaborators, attachments, comments, minutes, rating]. Returns null when the answer is not that shape. */
export function parseAggregates(data: unknown): RequestAggregates | null {
  if (!Array.isArray(data)) return null
  const out: RequestAggregates = { collabCounts: new Map(), attachmentCounts: new Map(), commentCounts: new Map(), timeMinutes: new Map(), csatRatings: new Map() }
  for (const row of data) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') return null
    const [id, collab, attachments, comments, minutes, rating] = row as [string, number, number, number, number, number | null]
    if (collab) out.collabCounts.set(id, Number(collab))
    if (attachments) out.attachmentCounts.set(id, Number(attachments))
    if (comments) out.commentCounts.set(id, Number(comments))
    if (minutes) out.timeMinutes.set(id, Number(minutes))
    if (rating !== null && rating !== undefined) out.csatRatings.set(id, Number(rating))
  }
  return out
}

export async function loadRequestAggregates(
  admin: AnyClient,
  orgId: string,
  requestIds: string[],
  fallback: () => Promise<RequestAggregates>,
): Promise<RequestAggregates> {
  if (requestIds.length < AGGREGATES_RPC_MIN_TICKETS) return fallback()
  try {
    const { data, error } = await admin.rpc('report_request_aggregates', { p_org: orgId })
    if (error) return fallback()          // (the function is not in this database yet: use the old way)
    return parseAggregates(data) ?? fallback()
  } catch {
    return fallback()
  }
}
