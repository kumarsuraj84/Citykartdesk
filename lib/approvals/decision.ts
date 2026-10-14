// The one place an approval is decided (approved or rejected): who may decide, the SLA clock, the request's next status, the
// activity log and every notification. It is a plain module, NOT a server action, because the caller must prove who the
// approver is first: the portal passes the signed-in person (lib/actions/approvals.ts), the e-mail page passes the approver whose
// link and identity check passed (lib/actions/approvalEmail.ts). A comment is required either way.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import type { RequestStatus } from '@/types'

type ActionResult = { error?: string }

/** The database client to read with: the signed-in person's own (so row rules apply) or the admin one (identity already proven). */
export type ApprovalDb = ReturnType<typeof createAdminClient>
/** The person deciding. */
export interface ApprovalActor { id: string; role: string; full_name: string }

export const OWN_REQUEST_MESSAGE = 'You raised or sent this request, so you cannot approve or reject it yourself. Another approver has to decide it.'
export const COMMENT_REQUIRED ='Please add a comment: it is required to approve or reject.'

export async function archiveApprovalNotifications(requestId: string, opts: { onlyUserId?: string } = {}) {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  let q = admin
    .from('notifications')
    .update({ archived_at: now, read_at: now })
    .eq('request_id', requestId)
    .eq('type', 'approval_requested')
    .is('archived_at', null)
  if (opts.onlyUserId) q = q.eq('user_id', opts.onlyUserId)
  await q
}

// ── Shared: verify the caller is the correct approver for the current step ────

export async function resolveApprovalContextFor(approvalId: string, profile: ApprovalActor, supabase: ApprovalDb) {

  const isManager = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'

  const { data: approval } = await supabase
    .from('approvals')
    .select('id, request_id, workflow_id, current_step, status, requested_by')
    .eq('id', approvalId)
    .single()

  if (!approval) return { error: 'Approval not found.' } as const
  if (approval.status !== 'pending') return { error: 'This approval is no longer pending.' } as const

  // Separation of duties (D-030): nobody approves or rejects a request they raised or sent for approval themselves.
  const { data: own } = await createAdminClient().from('requests').select('requester_id').eq('id', approval.request_id).maybeSingle()
  if (own?.requester_id === profile.id || approval.requested_by === profile.id) return { error: OWN_REQUEST_MESSAGE, reason: 'own_request' } as const

  const { data: steps } = await supabase
    .from('approval_workflow_steps')
    .select('*')
    .eq('workflow_id', approval.workflow_id)
    .order('step_order', { ascending: true })

  if (!steps?.length) return { error: 'Approval workflow has no steps.' } as const

  const isParallel = approval.current_step === 0

  if (isParallel) {
    // Parallel mode: find this user's step (any step assigned to them without a decision yet)
    const admin = createAdminClient()
    const { data: decisions } = await admin
      .from('approval_decisions')
      .select('step_order')
      .eq('approval_id', approvalId)
    const decidedSteps = new Set((decisions ?? []).map((d) => d.step_order))

    const myStep = steps.find(
      (s) =>
        s.approver_type === 'specific_user' &&
        s.approver_user_id === profile.id &&
        !decidedSteps.has(s.step_order),
    )
    if (!myStep) return { error: 'You are not a pending approver for this request.' } as const

    return { approval, steps, currentStep: myStep, profile, supabase, isManager, isParallel: true, decidedSteps } as const
  }

  // Sequential mode
  const currentStep = steps.find((s) => s.step_order === (approval.current_step ?? 1))
  if (!currentStep) return { error: 'Current approval step not found.' } as const

  const canApprove =
    (currentStep.approver_type === 'any_manager' && isManager) ||
    (currentStep.approver_type === 'specific_user' && currentStep.approver_user_id === profile.id)
  if (!canApprove) return { error: 'You are not the designated approver for this step.' } as const

  return { approval, steps, currentStep, profile, supabase, isManager, isParallel: false, decidedSteps: new Set<number>() } as const
}

export type ApprovalCtx = Exclude<Awaited<ReturnType<typeof resolveApprovalContextFor>>, { error: string }>

// ── Approve ───────────────────────────────────────────────────────────────────

async function approveCore(ctx: ApprovalCtx, approvalId: string, comment?: string, via?: string): Promise<ActionResult> {
  const { approval, steps, currentStep, profile, isParallel } = ctx
  const admin = createAdminClient()

  // Record the decision
  const { error: decisionError } = await admin.from('approval_decisions').insert({
    approval_id: approvalId,
    step_order: currentStep.step_order,
    decided_by: profile.id,
    decision: 'approved',
    comment: comment?.trim() || null,
  })
  if (decisionError) return { error: sanitizeError(decisionError, { route: 'approvals.ts#approveApproval', fallback: 'Failed to record decision.' }) }

  // This is now decided for the acting approver — their notification is done.
  await archiveApprovalNotifications(approval.request_id, { onlyUserId: profile.id })

  // Parallel (ad-hoc, several people asked at once): whoever responds first decides — one
  // approval settles it, exactly as one rejection already does. Sequential workflows still
  // need every step approved in order.
  const isLastStep = isParallel
    ? true
    : currentStep.step_order >= Math.max(...steps.map((s) => s.step_order))

  if (isLastStep) {
    // All steps approved — move approval to approved + unblock the request.
    // Guarded with .eq('status', 'pending') + checking a row actually came
    // back: two approvers finishing the last two parallel steps at the same
    // instant would otherwise both compute isLastStep = true (each reads
    // decidedSteps before the other's decision lands) and both run the
    // resolution below — double-extending due dates, double-notifying the
    // requester. Only the call that actually flips pending -> approved
    // proceeds; the other's decision is still recorded, it just doesn't
    // redo work someone else already did.
    const { data: approvalUpdated, error: approvalUpdateError } = await admin
      .from('approvals')
      .update({ status: 'approved' })
      .eq('id', approvalId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (approvalUpdateError) return { error: sanitizeError(approvalUpdateError, { route: 'approvals.ts#approveApproval', fallback: 'Failed to update approval.' }) }
    if (!approvalUpdated) {
      revalidatePath(`/requests/${approval.request_id}`)
      revalidatePath('/approvals')
      revalidatePath('/home')
      revalidatePath('/notifications')
      return {}
    }

    // Fully resolved — clear it for anyone else it was still pending with too.
    await archiveApprovalNotifications(approval.request_id)

    // Resume the SLA clock — mirrors updateRequestStatus()'s "Waiting on
    // User" resume: extend the due dates by however long the approval was
    // pending, so time spent on hold isn't counted against SLA.
    const { data: req } = await admin
      .from('requests')
      .select('requester_id, waiting_since, response_due_at, resolution_due_at, pre_approval_status, paused_ms_total')
      .eq('id', approval.request_id)
      .single()

    const resumeNow = new Date()
    // Resume into whatever it actually was before being sent for approval —
    // in_progress or waiting_user — rather than always forcing in_progress.
    // A ticket that was genuinely waiting on the requester when "Send for
    // Approval" was clicked must go back to waiting_user, still paused (a
    // fresh waiting_since — the approval hold's duration was already
    // credited to the due dates below via the OLD waiting_since), not appear
    // ready for the technician to act on. pre_approval_status may be null
    // for an approval that was already in flight before this column existed;
    // in_progress is the safe fallback (matches the old unconditional behavior).
    const resumedStatus = (req?.pre_approval_status as RequestStatus | null) ?? 'in_progress'
    const updatePayload: {
      status: RequestStatus; pre_approval_status: null; waiting_since: string | null
      response_due_at?: string; resolution_due_at?: string; paused_ms_total?: number
    } = {
      status: resumedStatus,
      pre_approval_status: null,
      waiting_since: resumedStatus === 'waiting_user' ? resumeNow.toISOString() : null,
    }
    if (req?.waiting_since) {
      const pausedMs = resumeNow.getTime() - new Date(req.waiting_since).getTime()
      if (req.response_due_at) {
        updatePayload.response_due_at = new Date(new Date(req.response_due_at).getTime() + pausedMs).toISOString()
      }
      if (req.resolution_due_at) {
        updatePayload.resolution_due_at = new Date(new Date(req.resolution_due_at).getTime() + pausedMs).toISOString()
      }
      updatePayload.paused_ms_total = Number(req.paused_ms_total ?? 0) + pausedMs
    }

    const { error: requestUpdateError } = await admin
      .from('requests')
      .update(updatePayload)
      .eq('id', approval.request_id)
    if (requestUpdateError) return { error: sanitizeError(requestUpdateError, { route: 'approvals.ts#approveApproval', fallback: 'Failed to update request.' }) }

    await logActivity({
      requestId: approval.request_id,
      actorId: profile.id,
      action: 'approved',
      metadata: { step: currentStep.step_order, comment: comment?.trim(), ...(via ? { via } : {}) },
    })

    await logActivity({
      requestId: approval.request_id,
      actorId: profile.id,
      action: 'status_changed',
      metadata: { from: 'pending_approval', to: 'in_progress' },
    })

    // Notify requester: approval fully approved
    if (req && req.requester_id !== profile.id) {
      notify({
        recipientId: req.requester_id,
        actorId: profile.id,
        type: 'approval_approved',
        title: 'Your request has been approved',
        body: `${profile.full_name} approved it — work is resuming.`,
        requestId: approval.request_id,
        link: `/requests/${approval.request_id}`,
        metadata: { approverName: profile.full_name, reason: comment?.trim() || undefined },
      }).catch(() => {})
    }

    // Also notify whoever sent it for approval (the technician), if that's someone
    // other than the requester (already notified above) and the approver themself.
    if (approval.requested_by && approval.requested_by !== req?.requester_id && approval.requested_by !== profile.id) {
      notify({
        recipientId: approval.requested_by,
        actorId: profile.id,
        type: 'approval_approved',
        title: 'Approval granted',
        body: `${profile.full_name} approved the request you sent for approval.`,
        requestId: approval.request_id,
        link: `/requests/${approval.request_id}`,
        metadata: { approverName: profile.full_name, reason: comment?.trim() || undefined, recipientIsRequester: 'false' },
      }).catch(() => {})
    }
  } else {
    // More steps pending — in parallel mode keep current_step = 0; in sequential, advance
    if (!isParallel) {
      const nextStep = steps.find((s) => s.step_order > currentStep.step_order)
      const { error: advanceError } = await admin
        .from('approvals')
        .update({ current_step: nextStep!.step_order })
        .eq('id', approvalId)
      if (advanceError) return { error: sanitizeError(advanceError, { route: 'approvals.ts#approveApproval', fallback: 'Failed to advance to next approval step.' }) }

      if (nextStep?.approver_type === 'specific_user' && nextStep.approver_user_id && nextStep.approver_user_id !== profile.id) {
        notify({
          recipientId: nextStep.approver_user_id,
          actorId: profile.id,
          type: 'approval_requested',
          title: 'Approval requested',
          body: `Step ${currentStep.step_order} approved. Your review is now needed.`,
          requestId: approval.request_id,
          link: `/requests/${approval.request_id}?tab=approvals`,
        }).catch(() => {})
      }
    }

    await logActivity({
      requestId: approval.request_id,
      actorId: profile.id,
      action: 'approved',
      metadata: { step: currentStep.step_order, comment: comment?.trim(), ...(via ? { via } : {}) },
    })
  }

  revalidatePath(`/requests/${approval.request_id}`)
  revalidatePath('/approvals')
  revalidatePath('/home')
  revalidatePath('/notifications')

  return {}
}

// ── Reject ────────────────────────────────────────────────────────────────────

async function rejectCore(ctx: ApprovalCtx, approvalId: string, comment?: string, via?: string): Promise<ActionResult> {
  const { approval, currentStep, profile } = ctx
  const admin = createAdminClient()

  const { error: decisionError } = await admin.from('approval_decisions').insert({
    approval_id: approvalId,
    step_order: currentStep.step_order,
    decided_by: profile.id,
    decision: 'rejected',
    comment: comment?.trim() || null,
  })
  if (decisionError) return { error: sanitizeError(decisionError, { route: 'approvals.ts#rejectApproval', fallback: 'Failed to record decision.' }) }

  // Guarded the same way approveApproval's final step is: two approvers
  // (or an approve/reject race) hitting this at the same instant should only
  // let ONE of them actually resolve the approval and resume the SLA clock.
  const { data: approvalRejected, error: approvalUpdateError } = await admin
    .from('approvals')
    .update({ status: 'rejected' })
    .eq('id', approvalId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (approvalUpdateError) return { error: sanitizeError(approvalUpdateError, { route: 'approvals.ts#rejectApproval', fallback: 'Failed to update approval.' }) }
  if (!approvalRejected) {
    revalidatePath(`/requests/${approval.request_id}`)
    revalidatePath('/approvals')
    revalidatePath('/home')
    revalidatePath('/notifications')
    return {}
  }

  // A single reject ends it for every approver — clear it for all of them.
  await archiveApprovalNotifications(approval.request_id)

  // Resume the SLA clock the same way an approval does — even though
  // 'cancelled' is terminal, clearing waiting_since keeps the record
  // consistent if the request is ever reopened.
  const { data: reqForResume } = await admin
    .from('requests')
    .select('waiting_since, response_due_at, resolution_due_at, paused_ms_total')
    .eq('id', approval.request_id)
    .single()

  const resumeNow = new Date()
  // Tagged as 'approval_rejected' (distinct from a technician directly
  // cancelling a ticket) so the requester — and only the requester — gets a
  // 48-hour window to reopen it: a rejected approval can be an honest
  // mistake, unlike a deliberate cancellation.
  const REOPEN_WINDOW_HOURS = 48
  const cancelPayload: {
    status: 'cancelled'; waiting_since: null; cancellation_reason: 'approval_rejected'; reopen_deadline_at: string
    response_due_at?: string; resolution_due_at?: string; paused_ms_total?: number
  } = {
    status: 'cancelled',
    waiting_since: null,
    cancellation_reason: 'approval_rejected',
    reopen_deadline_at: new Date(resumeNow.getTime() + REOPEN_WINDOW_HOURS * 3_600_000).toISOString(),
  }
  if (reqForResume?.waiting_since) {
    const pausedMs = resumeNow.getTime() - new Date(reqForResume.waiting_since).getTime()
    if (reqForResume.response_due_at) {
      cancelPayload.response_due_at = new Date(new Date(reqForResume.response_due_at).getTime() + pausedMs).toISOString()
    }
    if (reqForResume.resolution_due_at) {
      cancelPayload.resolution_due_at = new Date(new Date(reqForResume.resolution_due_at).getTime() + pausedMs).toISOString()
    }
    cancelPayload.paused_ms_total = Number(reqForResume.paused_ms_total ?? 0) + pausedMs
  }

  const { error: requestUpdateError } = await admin
    .from('requests')
    .update(cancelPayload)
    .eq('id', approval.request_id)
  if (requestUpdateError) return { error: sanitizeError(requestUpdateError, { route: 'approvals.ts#rejectApproval', fallback: 'Failed to update request.' }) }

  await logActivity({
    requestId: approval.request_id,
    actorId: profile.id,
    action: 'rejected',
    metadata: { step: currentStep.step_order, comment: comment?.trim(), ...(via ? { via } : {}) },
  })

  await logActivity({
    requestId: approval.request_id,
    actorId: profile.id,
    action: 'status_changed',
    metadata: { from: 'pending_approval', to: 'cancelled' },
  })

  // Notify requester: approval rejected
  const { data: req } = await admin
    .from('requests')
    .select('requester_id')
    .eq('id', approval.request_id)
    .single()
  if (req && req.requester_id !== profile.id) {
    notify({
      recipientId: req.requester_id,
      actorId: profile.id,
      type: 'approval_rejected',
      title: 'Your request was not approved',
      body: `${profile.full_name} rejected the approval.`,
      requestId: approval.request_id,
      link: `/requests/${approval.request_id}?tab=approvals`,
      metadata: { approverName: profile.full_name, reason: comment?.trim() || undefined },
    }).catch(() => {})
  }

  // Also notify whoever sent it for approval (the technician), if that's someone
  // other than the requester (already notified above) and the approver themself.
  if (approval.requested_by && approval.requested_by !== req?.requester_id && approval.requested_by !== profile.id) {
    notify({
      recipientId: approval.requested_by,
      actorId: profile.id,
      type: 'approval_rejected',
      title: 'Approval rejected',
      body: `${profile.full_name} rejected the request you sent for approval.`,
      requestId: approval.request_id,
      link: `/requests/${approval.request_id}?tab=approvals`,
      metadata: { approverName: profile.full_name, reason: comment?.trim() || undefined, recipientIsRequester: 'false' },
    }).catch(() => {})
  }

  revalidatePath(`/requests/${approval.request_id}`)
  revalidatePath('/approvals')
  revalidatePath('/home')
  revalidatePath('/notifications')

  return {}
}

/** Approve or reject on behalf of `profile`. A comment is mandatory for both. `via` is recorded in the ticket's history. */
export async function decideApproval(
  kind: 'approve' | 'reject',
  approvalId: string,
  profile: ApprovalActor,
  db: ApprovalDb,
  comment: string | undefined,
  via: 'portal' | 'email' = 'portal',
): Promise<ActionResult> {
  // who may decide, and whether it is still waiting, is answered first: a stale approval says so instead of asking for a comment
  const ctx = await resolveApprovalContextFor(approvalId, profile, db)
  if ('error' in ctx) return { error: ctx.error }
  if (!comment?.trim()) return { error: COMMENT_REQUIRED }
  return kind === 'approve' ? approveCore(ctx, approvalId, comment, via) : rejectCore(ctx, approvalId, comment, via)
}
