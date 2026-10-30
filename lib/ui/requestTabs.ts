// The tabs of the ticket page, and the rule for which one opens first.

export const REQUEST_TAB_IDS = ['conversations', 'details', 'tasks', 'approvals', 'time_elapsed', 'history'] as const
export type RequestTabId = (typeof REQUEST_TAB_IDS)[number]

/**
 * The tab named in the address (?tab=approvals, as the links in notifications and e-mails use) if it is one we know and the
 * viewer may see it; otherwise Conversations. The Approvals tab exists only for tickets that have an approval flow.
 */
export function parseRequestTab(raw: string | string[] | null | undefined, opts: { showApprovals: boolean }): RequestTabId {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || !(REQUEST_TAB_IDS as readonly string[]).includes(value)) return 'conversations'
  if (value === 'approvals' && !opts.showApprovals) return 'conversations'
  return value as RequestTabId
}
