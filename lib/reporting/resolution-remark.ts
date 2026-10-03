export type StatusActivity = {
  request_id: string
  actor_id: string | null
  created_at: string
  metadata: { to?: string; remark?: string } | null
}

export type RemarkComment = {
  request_id: string
  author_id: string | null
  created_at: string
  body: string
}

// Comments posted by updateRequestStatus() land a moment after the status_changed
// activity; anything further apart than this is an unrelated comment.
const LEGACY_MATCH_WINDOW_MS = 120_000

/** The most recent status change to "resolved" per request. */
export function latestResolveActivities(activities: StatusActivity[]): Map<string, StatusActivity> {
  const latest = new Map<string, StatusActivity>()
  for (const a of activities) {
    if (a.metadata?.to !== 'resolved') continue
    const existing = latest.get(a.request_id)
    if (!existing || a.created_at > existing.created_at) latest.set(a.request_id, a)
  }
  return latest
}

/**
 * The remark the technician typed when resolving. New resolutions store it on the
 * activity itself; older ones only have it as the public comment posted right after
 * the status change by the same person.
 */
export function resolutionRemarks(
  latest: Map<string, StatusActivity>,
  comments: RemarkComment[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [requestId, act] of latest) {
    const stored = act.metadata?.remark?.trim()
    if (stored) { out.set(requestId, stored); continue }

    const at = new Date(act.created_at).getTime()
    const match = comments
      .filter((c) => c.request_id === requestId && c.author_id === act.actor_id && c.body.trim() !== '')
      .map((c) => ({ c, delta: new Date(c.created_at).getTime() - at }))
      .filter(({ delta }) => delta >= 0 && delta <= LEGACY_MATCH_WINDOW_MS)
      .sort((a, b) => a.delta - b.delta)[0]
    if (match) out.set(requestId, match.c.body.trim())
  }
  return out
}
