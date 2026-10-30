// Recall (withdraw) a pending approval. Before this, a ticket on "Pending approval" had no way out except the approver deciding: if the approver left, was on
// leave or was the wrong person, the ticket stayed on hold for good. A manager, admin or platform owner can now cancel the pending approval, which puts the
// ticket back to the status it had before it was sent (pre_approval_status), gives back the time it spent on hold to the SLA, and tells everyone concerned.
// A plain module (the signed-in check lives in lib/actions/approvals.ts) so it can be tested without a server action.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { archiveApprovalNotifications, creditHoldTime, reopenApproval, type ApprovalActor } from '@/lib/approvals/decision'
import { stopOpenTimeEntries } from '@/lib/requests/status-change'
import type { RequestStatus } from '@/types'

export const RECALL_ROLES = ['manager', 'admin', 'platform_owner']

export async function recallApprovalCore(
  admin: ReturnType<typeof createAdminClient>,
  profile: ApprovalActor & { org_id: string | null },
  requestId: string,
  reason?: string,
): Promise<{ error?: string }> {
  if (!RECALL_ROLES.includes(profile.role)) return { error: 'Only a manager or an admin can recall an approval.' }

  const { data: req } = await admin
    .from('requests')
    .select('id, org_id, title, status, requester_id, waiting_since, response_due_at, resolution_due_at, pre_approval_status, paused_ms_total')
    .eq('id', requestId)
    .maybeSingle()
  // the same answer for "no such ticket" and "another organisation's ticket"
  if (!req || !profile.org_id || req.org_id !== profile.org_id) return { error: 'Request not found.' }
  if (req.status !== 'pending_approval') return { error: 'This request is not waiting for an approval.' }

  const { data: approval } = await admin
    .from('approvals')
    .select('id, workflow_id, requested_by')
    .eq('request_id', requestId)
    .eq('status', 'pending')
    .maybeSingle()
  if (!approval) return { error: 'There is no pending approval to recall.' }

  // Settle the approval first and only once: an approver deciding at the same moment either wins this or sees "already decided".
  const { data: claimed, error: claimError } = await admin
    .from('approvals')
    .update({ status: 'cancelled' })
    .eq('id', approval.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (claimError) return { error: sanitizeError(claimError, { route: 'approvals/recall.ts#recallApprovalCore', fallback: 'Failed to recall the approval.' }) }
  if (!claimed) return { error: 'This approval has already been decided.' }

  // Back to what it was before it was sent (in progress or waiting on the user). A ticket that was waiting on the requester goes back to waiting with a fresh
  // pause start; the hold time is credited to the due dates through the OLD waiting_since, exactly as an approval does.
  const resumedStatus = (req.pre_approval_status as RequestStatus | null) ?? 'in_progress'
  const now = new Date()
  const payload: {
    status: RequestStatus; pre_approval_status: null; waiting_since: string | null
    response_due_at?: string; resolution_due_at?: string; paused_ms_total?: number
  } = {
    status: resumedStatus,
    pre_approval_status: null,
    waiting_since: resumedStatus === 'waiting_user' ? now.toISOString() : null,
  }
  Object.assign(payload, await creditHoldTime(req, now))

  const { data: moved, error: moveError } = await admin
    .from('requests')
    .update(payload)
    .eq('id', requestId)
    .eq('status', 'pending_approval')
    .select('id')
  if (moveError) {
    // the ticket did not move: put the approval back so nothing is half done
    await reopenApproval(admin, approval.id, 'cancelled')
    return { error: sanitizeError(moveError, { route: 'approvals/recall.ts#recallApprovalCore', fallback: 'Failed to move the request back.' }) }
  }
  const ticketMoved = (moved?.length ?? 0) > 0
  // Back to waiting on the user is not "in progress": no timer may run there (B-07). Going back to in progress keeps whatever the technician has running.
  if (ticketMoved && resumedStatus !== 'in_progress') await stopOpenTimeEntries(requestId, now.toISOString())

  // Whoever was still to decide: every step without a decision (a parallel approval has one step per person asked).
  const [{ data: steps }, { data: decisions }] = await Promise.all([
    admin.from('approval_workflow_steps').select('step_order, approver_user_id').eq('workflow_id', approval.workflow_id),
    admin.from('approval_decisions').select('step_order').eq('approval_id', approval.id),
  ])
  const decided = new Set((decisions ?? []).map((d) => d.step_order))
  const waitingApprovers = (steps ?? []).filter((s) => s.approver_user_id && !decided.has(s.step_order)).map((s) => s.approver_user_id as string)

  await archiveApprovalNotifications(requestId)

  const cleanReason = reason?.trim() || undefined
  if (ticketMoved) {
    await logActivity({
      requestId,
      actorId: profile.id,
      action: 'status_changed',
      metadata: { from: 'pending_approval', to: resumedStatus, approval_recalled: true, ...(cleanReason ? { reason: cleanReason } : {}) },
    })
  } else {
    await logActivity({ requestId, actorId: profile.id, action: 'status_changed', metadata: { approval_recalled: true, ticket_already_moved_on: true, ...(cleanReason ? { reason: cleanReason } : {}) } })
  }

  const who = new Set<string>([...waitingApprovers, req.requester_id, ...(approval.requested_by ? [approval.requested_by] : [])])
  who.delete(profile.id)
  for (const recipientId of who) {
    notify({
      recipientId,
      actorId: profile.id,
      type: 'status_changed',   // a type the admin Notification Rules screen can switch off (approval_decided is not listed there)
      title: 'Approval withdrawn',
      body: `${profile.full_name} withdrew the approval for "${req.title}". It no longer needs a decision.`,
      requestId,
      link: `/requests/${requestId}`,
    }).catch(() => {})
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/approvals')
  revalidatePath('/home')
  revalidatePath('/notifications')
  return {}
}
