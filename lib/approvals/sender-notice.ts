// Who is told, besides the requester, when an approval is decided.
//  - Normally the person who sent the ticket for approval (the technician working on it).
//  - When the approval was sent by the "moved tickets" tool of the Zoho transfer (activity "approval_requested" with via = zoho_transfer), the person recorded as the sender is the
//    administrator who pressed the button, not someone working on the ticket. They are NOT told; the technician the ticket is assigned to is (18 Nov 2026: the platform owner got
//    "Request approved" mails for tickets handled by other technicians).
// The decision is a pure function (tested); the small database lookup is kept separate.

export type SenderNoticeInput = {
  requestedBy: string | null
  requesterId: string | null
  /** the person who just approved / rejected */
  approverId: string
  assigneeId: string | null
  sentViaTransfer: boolean
}
export type SenderNotice = { recipientId: string; /** 'sender' = the person who sent it for approval; 'assignee' = the technician the ticket is assigned to */ role: 'sender' | 'assignee' }

/** Who gets the second notice (the requester is told separately). null = nobody. Never the approver, never the requester (already told). */
export function senderNoticeRecipient(i: SenderNoticeInput): SenderNotice | null {
  const ok = (id: string | null): id is string => !!id && id !== i.requesterId && id !== i.approverId
  if (i.sentViaTransfer) return ok(i.assigneeId) ? { recipientId: i.assigneeId, role: 'assignee' } : null
  return ok(i.requestedBy) ? { recipientId: i.requestedBy, role: 'sender' } : null
}

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Whether the newest "sent for approval" entry of the ticket came from the Zoho moved-tickets tool. A failed lookup counts as "no" (the old behaviour). */
export async function wasSentViaTransfer(admin: Db, requestId: string): Promise<boolean> {
  try {
    const { data } = await admin.from('request_activity').select('metadata').eq('request_id', requestId).eq('action', 'approval_requested').order('created_at', { ascending: false }).limit(1)
    const via = ((data ?? []) as { metadata: { via?: string } | null }[])[0]?.metadata?.via
    return via === 'zoho_transfer'
  } catch { return false }
}

export async function resolveSenderNotice(admin: Db, p: { requestId: string; requestedBy: string | null; requesterId: string | null; approverId: string }): Promise<SenderNotice | null> {
  if (!p.requestedBy) return null
  const viaTransfer = await wasSentViaTransfer(admin, p.requestId)
  let assigneeId: string | null = null
  if (viaTransfer) {
    try {
      const { data } = await admin.from('requests').select('assigned_to').eq('id', p.requestId).maybeSingle()
      assigneeId = (data as { assigned_to: string | null } | null)?.assigned_to ?? null
    } catch { assigneeId = null }
  }
  return senderNoticeRecipient({ requestedBy: p.requestedBy, requesterId: p.requesterId, approverId: p.approverId, assigneeId, sentViaTransfer: viaTransfer })
}
