import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { stopOpenTimeEntries } from '@/lib/requests/status-change'
import type { RequestStatus } from '@/types'

type Db = ReturnType<typeof createAdminClient>

export type AdHocRequest = {
  id: string
  request_no: string | null
  title: string
  status: RequestStatus
  requester_id: string
  org_id: string
  waiting_since: string | null
}

/**
 * Sends a ticket to people for parallel ad-hoc approval and puts it on hold (Pending Approval, the SLA clock pauses). The FIRST decision (approve or reject) is
 * final. Used by the technician's "Send for approval" and by the automatic CVM approval. Permission and separation-of-duties checks belong to the caller
 * (who may send, which approvers are allowed): this function only does the work.
 *
 * current_step = 0 signals "parallel mode" - all approvers act independently, and the first decision resumes or cancels the request right then.
 */
export async function createAdHocApproval(
  admin: Db,
  p: { request: AdHocRequest; approvers: { id: string; full_name: string }[]; senderId: string; senderName: string },
): Promise<{ error?: string }> {
  const req = p.request
  const approverIds = p.approvers.map((a) => a.id)

  // Block if an approval is already open
  const { data: existing } = await admin.from('approvals').select('id').eq('request_id', req.id).eq('status', 'pending').maybeSingle()
  if (existing) return { error: 'An approval is already pending for this request.' }

  // Create ad-hoc workflow. org_id must be set - approval_workflow_steps' RLS (approval_workflow_steps_select) checks the workflow's own org_id, not the
  // request's; leaving it null makes the steps invisible to the RLS-scoped client that resolveApprovalContext() uses, so approve/reject would fail
  // with "Approval workflow has no steps" for every approver, permanently.
  const { data: workflow, error: wfErr } = await admin
    .from('approval_workflows')
    .insert({ name: `Ad-hoc approval ${req.request_no ?? ''}`.trim(), org_id: req.org_id })
    .select('id')
    .single()
  if (wfErr || !workflow) return { error: sanitizeError(wfErr, { route: 'approvals/adhoc.ts#createAdHocApproval', fallback: 'Failed to create approval workflow.' }) }

  // Create one step per approver (step_order 1..N)
  const stepRows = approverIds.map((uid, i) => ({ workflow_id: workflow.id, step_order: i + 1, approver_type: 'specific_user' as const, approver_user_id: uid }))
  const { error: stepErr } = await admin.from('approval_workflow_steps').insert(stepRows)
  if (stepErr) {
    await admin.from('approval_workflows').delete().eq('id', workflow.id)   // nothing half-made is left behind (D-045)
    return { error: sanitizeError(stepErr, { route: 'approvals/adhoc.ts#createAdHocApproval', fallback: 'Failed to create approval steps.' }) }
  }

  const { data: approval, error: approvalErr } = await admin
    .from('approvals')
    .insert({ request_id: req.id, workflow_id: workflow.id, status: 'pending', current_step: 0, requested_by: p.senderId })
    .select('id')
    .single()
  if (approvalErr || !approval) {
    await admin.from('approval_workflows').delete().eq('id', workflow.id)
    return { error: sanitizeError(approvalErr, { route: 'approvals/adhoc.ts#createAdHocApproval', fallback: 'Failed to create approval.' }) }
  }

  // Put request on hold - SLA pauses the same way "Waiting on User" does. If it was already paused (e.g. sent while waiting on the user), keep the
  // original pause start rather than resetting the clock. pre_approval_status remembers whatever it actually was (in_progress OR waiting_user) so full
  // approval can resume there instead of always forcing in_progress.
  const { error: stErr } = await admin
    .from('requests')
    .update({
      status: 'pending_approval',
      pre_approval_status: req.status,
      updated_at: new Date().toISOString(),
      waiting_since: req.waiting_since ?? new Date().toISOString(),
    })
    .eq('id', req.id)
  if (stErr) {
    // The ticket never moved to "pending approval": withdraw the approval and its workflow so the ticket is not left blocked by an approval nobody can decide.
    await admin.from('approvals').delete().eq('id', approval.id)
    await admin.from('approval_workflows').delete().eq('id', workflow.id)
    return { error: sanitizeError(stErr, { route: 'approvals/adhoc.ts#createAdHocApproval', fallback: 'Failed to update request status.' }) }
  }

  // the ticket is parked waiting for the approval, so nobody is working on it: running timers stop (B-07)
  await stopOpenTimeEntries(req.id, new Date().toISOString())

  await logActivity({ requestId: req.id, actorId: p.senderId, action: 'status_changed', metadata: { from: req.status, to: 'pending_approval' } })
  await logActivity({ requestId: req.id, actorId: p.senderId, action: 'approval_requested', metadata: { approver_names: p.approvers.map((a) => a.full_name) } })

  // Notify all approvers at once
  for (const uid of approverIds) {
    notify({
      recipientId: uid,
      actorId: p.senderId,
      type: 'approval_requested',
      title: 'Approval required',
      body: `"${req.title}" has been sent to you for approval.`,
      requestId: req.id,
      link: `/requests/${req.id}?tab=approvals`,
    }).catch(() => {})
  }

  // Let the requester know their ticket has moved to approval, and by whom it's being reviewed - otherwise it just silently stops progressing from their side.
  if (req.requester_id !== p.senderId) {
    const approverNames = p.approvers.map((a) => a.full_name).join(', ')
    notify({
      recipientId: req.requester_id,
      actorId: p.senderId,
      type: 'approval_requested',
      title: 'Your request has been sent for approval',
      body: `${p.senderName} sent it to ${approverNames} for approval.`,
      requestId: req.id,
      link: `/requests/${req.id}?tab=approvals`,
      metadata: { audience: 'requester', approverNames, requestTitle: req.title },
    }).catch(() => {})
  }
  return {}
}
