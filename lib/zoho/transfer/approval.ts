/**
 * What a line of Zoho approval history means, for the moved ticket's own history: sent for approval, approved, or rejected.
 * Pure (no database). A line that says none of these returns null and is still shown in the conversation as it was written.
 */
export type ApprovalAction = 'approval_requested' | 'approved' | 'rejected'

export function approvalAction(text: string | null | undefined): ApprovalAction | null {
  const s = String(text ?? '').toLowerCase()
  if (!s) return null
  if (/^approver_added|approver added/.test(s)) return null            // somebody was named as approver: not a decision, not a request
  if (/approval status modified|approval_status_change/.test(s)) return null // the system moving the status: the decision itself is its own line
  if (/reject|denied|declin/.test(s)) return 'rejected'
  if (/(send|sent|request|initiat|submit|pending|awaiting|waiting)[^.;]*approv|approv[^.;]*(sent|requested|initiated|submitted|pending|awaited)/.test(s)) return 'approval_requested'
  if (/approved|approval granted|\bapprove\b/.test(s)) return 'approved'
  return null
}

/** The address named in a decision line such as "Approved By : anshul.jain@citykartstores.com In Stage I" (the person who decided), or null. */
export function approverEmail(text: string | null | undefined): string | null {
  const m = /([^\s<>:;,]+@[^\s<>:;,]+\.[^\s<>:;,]+)/.exec(String(text ?? ''))
  return m ? m[1].toLowerCase() : null
}
