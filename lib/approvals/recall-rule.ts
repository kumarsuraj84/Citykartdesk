// Who may withdraw (recall) a pending approval. A plain file with no server code, so the approval panel on the screen and the server use the same rule.

export const RECALL_ROLES = ['manager', 'admin', 'platform_owner']

/** A manager, admin or platform owner (any approval), or the technician who sent the approval (only their own). */
export function mayRecallApproval(role: string, viewerId: string, sentBy: string | null | undefined): boolean {
  return RECALL_ROLES.includes(role) || (role === 'agent' && !!sentBy && sentBy === viewerId)
}
