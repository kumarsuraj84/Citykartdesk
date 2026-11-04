// How an approval got its approver(s), written into the history entry "requested approval" so a wrong approver can be traced afterwards:
//  - 'auto_cvm'            the automatic CVM approval of a category that asks for it (Hangers, Fixtures, Fixture Attachments): nobody chose anybody;
//  - 'cvm_suggestion_kept' a technician sent it with the store's CVM that the screen had pre-filled (only offered for those categories) among the approvers;
//  - 'chosen'              a technician picked every approver by hand.
// Pure (no database), so the wording and the rule are easy to test.

export type ApprovalVia = 'auto_cvm' | 'cvm_suggestion_kept' | 'chosen'

/** A manual "Send for approval": did the approvers include the CVM the screen offered? (`suggestedCvmId` is what the server works out itself, never what the browser says.) */
export function classifyManualApproval(p: { approverIds: string[]; suggestedCvmId: string | null }): ApprovalVia {
  return p.suggestedCvmId && p.approverIds.includes(p.suggestedCvmId) ? 'cvm_suggestion_kept' : 'chosen'
}

/** The words shown after "sent this request for approval to <names>". Empty for an old entry that has no `via`. */
export function approvalViaText(via: unknown, actorName: string): string {
  switch (via) {
    case 'auto_cvm': return 'automatically: the CVM approval of this category, nobody chose the approver'
    case 'cvm_suggestion_kept': return `the store's CVM was pre-filled for this category and ${actorName} kept it`
    case 'chosen': return `chosen by ${actorName}`
    default: return ''
  }
}

/** The label of the send button: the names when one or two people are picked, else the count. */
export function sendButtonLabel(names: string[], adding: boolean): string {
  const verb = adding ? 'Add' : 'Send to'
  if (names.length === 0) return `${verb} people →`
  if (names.length <= 2) return `${verb} ${names.join(' and ')} →`
  return `${verb} ${names.length} people →`
}
