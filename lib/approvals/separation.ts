// Separation of duties for approvals (VAPT-016, earlier D-030), in ONE place so every way of choosing approvers uses the same rule.
// Nobody approves what they raised or sent. The same people can therefore not be MADE approvers by a side door either: when sending for approval, adding
// approvers to a pending approval, or delegating a step.

export type SeparationContext = {
  /** who raised the ticket */
  requesterId: string | null
  /** who sent it for approval (null before it was sent) */
  senderId?: string | null
  /** the person making this change (adds / delegates) */
  actorId?: string | null
}

export const REQUESTER_APPROVER_MESSAGE = 'The person who raised the request cannot be an approver of it.'
export const SENDER_APPROVER_MESSAGE = 'The person who sent the request for approval cannot be an approver of it.'
export const SELF_APPROVER_MESSAGE = 'You cannot add yourself as an approver.'

/** A reason the candidate may not become an approver, or null when they may. */
export function approverBarredReason(candidateId: string, ctx: SeparationContext): string | null {
  if (ctx.requesterId && candidateId === ctx.requesterId) return REQUESTER_APPROVER_MESSAGE
  if (ctx.senderId && candidateId === ctx.senderId) return SENDER_APPROVER_MESSAGE
  if (ctx.actorId && candidateId === ctx.actorId) return SELF_APPROVER_MESSAGE
  return null
}

/** The first reason any of the candidates is barred, or null when all may become approvers. */
export function firstBarredApprover(candidateIds: string[], ctx: SeparationContext): string | null {
  for (const id of candidateIds) {
    const reason = approverBarredReason(id, ctx)
    if (reason) return reason
  }
  return null
}
