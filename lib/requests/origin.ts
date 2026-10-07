// Where a ticket was opened from: "Agent Requests" (work assigned to me / my group's queue)
// or "Requests" (tickets I raised or am cc'd on). The ticket page lives at /requests/[id]
// for both, so the page's own URL can't say which list the person came from — the `from`
// query parameter carries it. The sidebar highlight and the ticket's back link both read it.

export const REQUESTS_PATH = '/requests'
export const AGENT_QUEUE_PATH = '/requests/queue'

/** Only trust an internal relative path — never an absolute or protocol-relative URL a caller
 *  could smuggle in through the query string. */
export function safeOrigin(from: string | null | undefined): string | null {
  if (!from) return null
  return from.startsWith('/') && !from.startsWith('//') ? from : null
}

/**
 * Which list a ticket belongs to when the link that opened it did not say (notification and
 * email links, search results, approvals). A ticket the viewer works on — assigned to them, or
 * not raised by them while they are agent-tier for it — belongs to Agent Requests; a ticket
 * they raised belongs to Requests. A ticket they raised AND are assigned to counts as work.
 */
export function defaultTicketOrigin(p: {
  viewerId: string
  requesterId: string | null
  assignedTo: string | null
  /** Agent-tier for this ticket (manager/admin, or an agent in the ticket's technician group). */
  viewerCanWork: boolean
}): string {
  if (p.assignedTo === p.viewerId) return AGENT_QUEUE_PATH
  if (p.viewerCanWork && p.requesterId !== p.viewerId) return AGENT_QUEUE_PATH
  return REQUESTS_PATH
}

const TICKET_PAGE = /^\/requests\/(?!queue(?:\/|$))[^/]+/

/**
 * The path the sidebar / mobile nav should treat as "current". Everything is the real pathname
 * except a ticket page opened from Agent Requests, which counts as being inside Agent Requests
 * (otherwise "Requests" lights up because /requests/<id> starts with /requests/).
 */
export function navActivePath(pathname: string, from: string | null | undefined): string {
  const origin = safeOrigin(from)
  if (origin && TICKET_PAGE.test(pathname) && (origin === AGENT_QUEUE_PATH || origin.startsWith(`${AGENT_QUEUE_PATH}?`) || origin.startsWith(`${AGENT_QUEUE_PATH}/`))) {
    return AGENT_QUEUE_PATH
  }
  return pathname
}

/** Link to a ticket that remembers which list it was opened from. */
export function ticketHref(id: string, origin: string): string {
  return `/requests/${id}?from=${encodeURIComponent(origin)}`
}
