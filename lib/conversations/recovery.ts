// Recovery of a conversation stuck in 'submitting' (B-04). The orchestrator moves a conversation review -> submitting just before it creates the ticket and
// -> completed (or back to review) right after. If the server restarts or crashes in between, nothing ever moved it again, and because 'submitting' can be
// neither cancelled nor expired, that phone could never raise another ticket.
//
// Once a 'submitting' conversation is older than STALE_SUBMITTING_MS the next message from that phone repairs it first:
//   - if a ticket carrying this conversation's id exists, the submission DID finish: the conversation is completed with that ticket;
//   - otherwise nothing was created: the conversation goes back to 'review' (with a note), so CREATE, CANCEL or RESTART all work again.
// A younger 'submitting' conversation is left alone (a submission may really be in flight).

import { commitTransition, findConversationById, type ConversationTransitionInput } from './repository'
import { isStaleSubmitting } from './state-machine'
import type { ConversationRow } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export type RecoveryOutcome =
  | { outcome: 'none'; conversation: ConversationRow }
  | { outcome: 'completed'; conversation: ConversationRow; requestId: string; requestNo: string | null }
  | { outcome: 'returned_to_review'; conversation: ConversationRow }

export const RECOVERED_TO_REVIEW_NOTE = 'Your earlier attempt to create this request did not finish. Please check the details and send CREATE again, or CANCEL.'

/** The ticket that was made for this conversation, if any (the marker is written into the ticket's source_metadata when it is created). */
export async function findTicketForConversation(admin: AnyClient, conversation: Pick<ConversationRow, 'id' | 'orgId'>): Promise<{ id: string; request_no: string | null } | null> {
  const { data } = await admin
    .from('requests')
    .select('id, request_no')
    .eq('org_id', conversation.orgId)
    .eq('source_metadata->>conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

export async function recoverStaleSubmitting(params: {
  admin: AnyClient
  conversation: ConversationRow
  /** builds the complete next-row snapshot (the orchestrator's nextFrom) */
  nextFrom: (conversation: ConversationRow, overrides: Partial<ConversationTransitionInput> & { state: ConversationRow['state'] }) => ConversationTransitionInput
  now?: Date
}): Promise<RecoveryOutcome> {
  const { admin, conversation, nextFrom } = params
  const now = params.now ?? new Date()
  if (!isStaleSubmitting(conversation, now)) return { outcome: 'none', conversation }

  const ticket = await findTicketForConversation(admin, conversation)
  const nowIso = now.toISOString()

  const commit = ticket
    ? await commitTransition({ admin, conversation, next: nextFrom(conversation, { state: 'completed', requestId: ticket.id, lastError: null, completedAt: nowIso }) })
    : await commitTransition({ admin, conversation, next: nextFrom(conversation, { state: 'review', lastError: RECOVERED_TO_REVIEW_NOTE }) })

  if (!commit.ok) {
    // somebody else moved it in the meantime (the late submission finished, or another message repaired it first): use whatever it is now
    const fresh = await findConversationById({ admin, orgId: conversation.orgId, id: conversation.id })
    return { outcome: 'none', conversation: fresh ?? conversation }
  }
  return ticket
    ? { outcome: 'completed', conversation: commit.conversation, requestId: ticket.id, requestNo: ticket.request_no }
    : { outcome: 'returned_to_review', conversation: commit.conversation }
}
