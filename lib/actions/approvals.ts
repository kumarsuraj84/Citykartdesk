'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getRequestPreviewSummary, getRequestComments } from '@/lib/queries/requests'
import { getApprovalForRequest, type ApprovalWithDetails } from '@/lib/queries/approvals'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import type { RequestPriority, RequestStatus } from '@/types'

type ActionResult = { error?: string }

export async function searchUsersForDelegation(
  query: string
): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  const safe = query.replace(/[%_]/g, '\\$&').trim()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .ilike('full_name', `%${safe}%`)
    .order('full_name')
    .limit(10)
  return (data ?? []) as { id: string; full_name: string }[]
}

// Search all active users (for ad-hoc approval picker) — matches by name OR
// email. Email isn't a `profiles` column (it lives in Supabase Auth), so a
// name hit is checked DB-side first and an email hit falls back to scanning
// auth.users — cheap at this app's single-org scale, avoided entirely when
// the name search already found matches.
export async function searchManagersForApproval(
  query: string
): Promise<{ id: string; full_name: string; role: string }[]> {
  const profile = await getCurrentProfile()
  if (!profile || !profile.org_id) return []

  const q = query.trim()
  if (!q) return []

  const admin = createAdminClient()
  const safe = q.replace(/[%_]/g, '\\$&')
  const { data: byName } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .ilike('full_name', `%${safe}%`)
    .order('full_name')
    .limit(8)

  if (byName && byName.length >= 8) return byName as { id: string; full_name: string; role: string }[]

  // The name search above is a cheap, RLS-scoped table query — safe at any
  // typing speed. This fallback calls the Auth Admin API's full-org user
  // list, which is expensive and, with no gate, was callable by any logged-in
  // user on nearly every keystroke (most partial names return &lt;8 matches).
  // Rate-limited per-user rather than skipping the fallback outright, since a
  // legitimate slow typist should still get email-search results most of the time.
  const { limited } = await rateLimit(`approval-search-email:${profile.id}`, 20, 60_000)
  if (limited) return byName as { id: string; full_name: string; role: string }[] ?? []

  // Looks like (or might be) an email — cross-reference auth.users.
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const qLower = q.toLowerCase()
  const matchingIds = new Set(
    (authData?.users ?? [])
      .filter((u) => u.email?.toLowerCase().includes(qLower))
      .map((u) => u.id)
  )
  if (matchingIds.size === 0) return byName as { id: string; full_name: string; role: string }[] ?? []

  const { data: byEmail } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .in('id', [...matchingIds])
    .order('full_name')
    .limit(8)

  const merged = new Map<string, { id: string; full_name: string; role: string }>()
  for (const u of byName ?? []) merged.set(u.id, u)
  for (const u of byEmail ?? []) merged.set(u.id, u)
  return [...merged.values()].slice(0, 8)
}

// Clears the "approval required" notification once it's no longer actionable
// — for the deciding approver right after they act, and for everyone still
// pending once the whole approval is settled (approved-to-completion or
// rejected). Notifications, once archived, drop out of the bell/notifications
// list on the next route refresh (same is-null filter every other query uses).
async function archiveApprovalNotifications(requestId: string, opts: { onlyUserId?: string } = {}) {
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

// Send a request to multiple users for parallel ad-hoc approval.
// current_step = 0 signals "parallel mode" — all approvers act independently.
// Request releases from hold only when ALL have approved.
export async function sendAdHocApproval(
  requestId: string,
  approverIds: string[]
): Promise<ActionResult> {
  if (!approverIds.length) return { error: 'Select at least one approver.' }

  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: req } = await supabase
    .from('requests')
    .select('id, title, status, team_id, requester_id, org_id, waiting_since')
    .eq('id', requestId)
    .single()
  if (!req) return { error: 'Request not found.' }

  const onTeam = profile.role === 'agent' && profile.team_members.some((m) => m.team_id === req.team_id)
  if (!['manager', 'admin', 'platform_owner'].includes(profile.role) && !onTeam)
    return { error: 'Unauthorized.' }

  if (['resolved', 'closed', 'cancelled', 'pending_approval'].includes(req.status))
    return { error: 'Request is already in approval or a terminal state.' }

  if (['open', 'assigned'].includes(req.status))
    return { error: 'Start working on this request before sending it for approval.' }

  if (!req.org_id) return { error: 'Request has no organization.' }

  // Verify all approvers exist, are active, and are in the same org as the
  // request — without this, an approver id from another tenant (never
  // reachable via searchManagersForApproval's own org_id filter, but not
  // blocked here either) would get an approval_workflow_steps row, and RLS's
  // is_request_approver() grants read access purely off that row, with no
  // separate org check of its own — this is the only gate standing between
  // a cross-org approver_user_id and a cross-tenant data leak.
  const { data: approvers } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', approverIds)
    .eq('is_active', true)
    .eq('org_id', req.org_id)
  if (!approvers || approvers.length !== approverIds.length)
    return { error: 'One or more selected users were not found.' }

  // Block if an approval is already open
  const { data: existing } = await admin
    .from('approvals')
    .select('id')
    .eq('request_id', requestId)
    .eq('status', 'pending')
    .maybeSingle()
  if (existing) return { error: 'An approval is already pending for this request.' }

  // Create ad-hoc workflow. org_id must be set — approval_workflow_steps' RLS
  // (approval_workflow_steps_select) checks the workflow's own org_id, not the
  // request's; leaving it null makes the steps invisible to the RLS-scoped
  // client that resolveApprovalContext() uses, so approve/reject would fail
  // with "Approval workflow has no steps" for every approver, permanently.
  const { data: workflow, error: wfErr } = await admin
    .from('approval_workflows')
    .insert({ name: `Ad-hoc: ${req.title}`, org_id: req.org_id })
    .select('id')
    .single()
  if (wfErr || !workflow) return { error: sanitizeError(wfErr, { route: 'approvals.ts#sendAdHocApproval', fallback: 'Failed to create approval workflow.' }) }

  // Create one step per approver (step_order 1..N)
  const stepRows = approverIds.map((uid, i) => ({
    workflow_id: workflow.id,
    step_order: i + 1,
    approver_type: 'specific_user' as const,
    approver_user_id: uid,
  }))
  const { error: stepErr } = await admin.from('approval_workflow_steps').insert(stepRows)
  if (stepErr) return { error: sanitizeError(stepErr, { route: 'approvals.ts#sendAdHocApproval', fallback: 'Failed to create approval steps.' }) }

  // current_step = 0 means parallel — everyone acts simultaneously
  const { data: approval, error: approvalErr } = await admin
    .from('approvals')
    .insert({ request_id: requestId, workflow_id: workflow.id, status: 'pending', current_step: 0, requested_by: profile.id })
    .select('id')
    .single()
  if (approvalErr || !approval) return { error: sanitizeError(approvalErr, { route: 'approvals.ts#sendAdHocApproval', fallback: 'Failed to create approval.' }) }

  // Put request on hold — SLA pauses the same way "Waiting on User" does.
  // If it was already paused (e.g. sent while waiting on the user), keep the
  // original pause start rather than resetting the clock. pre_approval_status
  // remembers whatever it actually was (in_progress OR waiting_user) so full
  // approval can resume there instead of always forcing in_progress — a
  // ticket sent for approval while genuinely waiting on the requester
  // shouldn't come back looking ready for the technician to act.
  const { error: stErr } = await admin
    .from('requests')
    .update({
      status: 'pending_approval',
      pre_approval_status: req.status,
      updated_at: new Date().toISOString(),
      waiting_since: req.waiting_since ?? new Date().toISOString(),
    })
    .eq('id', requestId)
  if (stErr) return { error: sanitizeError(stErr, { route: 'approvals.ts#sendAdHocApproval', fallback: 'Failed to update request status.' }) }

  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'status_changed',
    metadata: { from: req.status, to: 'pending_approval' },
  }).catch(() => {})

  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'approval_requested',
    metadata: { approver_names: approvers.map((a) => a.full_name) },
  }).catch(() => {})

  // Notify all approvers at once
  for (const uid of approverIds) {
    notify({
      recipientId: uid,
      actorId: profile.id,
      type: 'approval_requested',
      title: 'Approval required',
      body: `"${req.title}" has been sent to you for approval.`,
      requestId,
      link: `/requests/${requestId}?tab=approvals`,
    }).catch(() => {})
  }

  // Let the requester know their ticket has moved to approval, and by whom it's
  // being reviewed — otherwise it just silently stops progressing from their side.
  if (req.requester_id !== profile.id) {
    const approverNames = approvers.map((a) => a.full_name).join(', ')
    notify({
      recipientId: req.requester_id,
      actorId: profile.id,
      type: 'approval_requested',
      title: 'Your request has been sent for approval',
      body: `${profile.full_name} sent it to ${approverNames} for approval.`,
      requestId,
      link: `/requests/${requestId}?tab=approvals`,
      metadata: { audience: 'requester', approverNames, requestTitle: req.title },
    }).catch(() => {})
  }

  revalidatePath(`/requests/${requestId}`)
  return {}
}

// ── Shared: verify the caller is the correct approver for the current step ────

async function resolveApprovalContext(approvalId: string) {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' } as const

  const isManager = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'

  const { data: approval } = await supabase
    .from('approvals')
    .select('id, request_id, workflow_id, current_step, status, requested_by')
    .eq('id', approvalId)
    .single()

  if (!approval) return { error: 'Approval not found.' } as const
  if (approval.status !== 'pending') return { error: 'This approval is no longer pending.' } as const

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

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveApproval(approvalId: string, comment?: string): Promise<ActionResult> {
  const ctx = await resolveApprovalContext(approvalId)
  if ('error' in ctx) return { error: ctx.error }

  const { approval, steps, currentStep, profile, isParallel, decidedSteps } = ctx
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

  // For parallel: done when all steps now have an approved decision
  const nowApprovedSteps = new Set([...decidedSteps, currentStep.step_order])
  const allApproved = isParallel
    ? steps.every((s) => nowApprovedSteps.has(s.step_order))
    : currentStep.step_order >= Math.max(...steps.map((s) => s.step_order))

  const isLastStep = allApproved

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
      metadata: { step: currentStep.step_order, comment: comment?.trim() },
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
      metadata: { step: currentStep.step_order, comment: comment?.trim() },
    })
  }

  revalidatePath(`/requests/${approval.request_id}`)
  revalidatePath('/approvals')
  revalidatePath('/home')
  revalidatePath('/notifications')

  return {}
}

// ── Delegate ──────────────────────────────────────────────────────────────────

export async function delegateApproval(
  approvalId: string,
  newApproverId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isManager = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'

  const { data: approval } = await supabase
    .from('approvals')
    .select('id, request_id, workflow_id, current_step, status')
    .eq('id', approvalId)
    .single()

  if (!approval) return { error: 'Approval not found.' }
  if (approval.status !== 'pending') return { error: 'This approval is no longer pending.' }

  const isParallel = approval.current_step === 0
  const admin = createAdminClient()

  let currentStep: { id: string; step_order: number; approver_type: string; approver_user_id: string | null } | null = null

  if (isParallel) {
    // Parallel (ad-hoc) mode: current_step is always 0, so it can never match
    // a real step_order — looking it up the sequential way (below) always
    // returned "Current approval step not found", making Delegate silently
    // fail for every ad-hoc approval. Find the caller's own undecided step
    // instead, same lookup resolveApprovalContext() uses for approve/reject.
    const { data: steps } = await supabase
      .from('approval_workflow_steps')
      .select('id, step_order, approver_type, approver_user_id')
      .eq('workflow_id', approval.workflow_id)
    const { data: decisions } = await admin
      .from('approval_decisions')
      .select('step_order')
      .eq('approval_id', approvalId)
    const decidedSteps = new Set((decisions ?? []).map((d) => d.step_order))
    currentStep = (steps ?? []).find(
      (s) => s.approver_type === 'specific_user' && s.approver_user_id === profile.id && !decidedSteps.has(s.step_order)
    ) ?? null
  } else {
    const { data } = await supabase
      .from('approval_workflow_steps')
      .select('id, step_order, approver_type, approver_user_id')
      .eq('workflow_id', approval.workflow_id)
      .eq('step_order', approval.current_step ?? 1)
      .single()
    currentStep = data
  }

  if (!currentStep) return { error: 'Current approval step not found.' }

  const canDelegate =
    (currentStep.approver_type === 'any_manager' && isManager) ||
    (currentStep.approver_type === 'specific_user' && currentStep.approver_user_id === profile.id)

  if (!canDelegate) return { error: 'You are not the designated approver for this step.' }

  // Same gate sendAdHocApproval() applies to its initial approver list — an
  // inactive or cross-org target would still get RLS-granted approve/reject
  // access via is_request_approver(), which checks nothing but this row.
  const { data: req } = await admin.from('requests').select('org_id').eq('id', approval.request_id).single()
  const { data: newApprover } = await admin
    .from('profiles')
    .select('id')
    .eq('id', newApproverId)
    .eq('is_active', true)
    .eq('org_id', req?.org_id ?? '')
    .maybeSingle()
  if (!newApprover) return { error: 'Selected user was not found in your organisation.' }

  const { error: updateError } = await admin
    .from('approval_workflow_steps')
    .update({ approver_user_id: newApproverId, approver_type: 'specific_user' })
    .eq('id', currentStep.id)

  if (updateError) return { error: sanitizeError(updateError, { route: 'approvals.ts#delegateApproval', fallback: 'Failed to delegate approval.' }) }

  // The outgoing approver is no longer the one who needs to act — clear
  // their now-stale "approval required" notification (mirrors approve/
  // reject's own archiving) so it doesn't keep pointing them at a step
  // they can no longer decide.
  await archiveApprovalNotifications(approval.request_id, { onlyUserId: profile.id })

  await logActivity({
    requestId: approval.request_id,
    actorId: profile.id,
    action: 'assigned',
    metadata: { field: 'approver', delegated_to: newApproverId },
  })

  await notify({
    recipientId: newApproverId,
    actorId: profile.id,
    type: 'approval_requested',
    title: 'Approval delegated to you',
    body: `${profile.full_name} delegated an approval to you.`,
    requestId: approval.request_id,
    link: `/requests/${approval.request_id}?tab=approvals`,
  }).catch(() => {})

  revalidatePath(`/requests/${approval.request_id}`)
  revalidatePath('/approvals')

  return {}
}

// ── Reject ────────────────────────────────────────────────────────────────────

export async function rejectApproval(approvalId: string, comment?: string): Promise<ActionResult> {
  const ctx = await resolveApprovalContext(approvalId)
  if ('error' in ctx) return { error: ctx.error }

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
    metadata: { step: currentStep.step_order, comment: comment?.trim() },
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

// ── Preview (for the Approvals list and the notification bell) ────────────────
// Lets an approver see the ticket details + conversation and act on it without
// leaving the current page — reuses the same RLS-scoped queries the full
// request page uses, so visibility rules stay identical.

export type ApprovalPreviewData = {
  request: {
    id: string
    request_no: string
    title: string
    description: string | null
    status: RequestStatus
    priority: RequestPriority
    requester_name: string
    service_name: string
    category_name: string | null
    sub_category_name: string | null
    created_at: string
  }
  comments: {
    id: string
    body: string
    created_at: string
    author_name: string
  }[]
}

export async function getApprovalPreview(
  approvalId: string
): Promise<{ data?: ApprovalPreviewData; error?: string }> {
  const supabase = await createClient()
  const { data: approval } = await supabase
    .from('approvals')
    .select('request_id')
    .eq('id', approvalId)
    .single()
  if (!approval) return { error: 'Approval not found.' }

  const [request, comments] = await Promise.all([
    getRequestPreviewSummary(approval.request_id),
    getRequestComments(approval.request_id),
  ])
  if (!request) return { error: 'Request not found.' }

  return {
    data: {
      request: {
        id: request.id,
        request_no: request.request_no,
        title: request.title,
        description: request.description,
        status: request.status,
        priority: request.priority,
        requester_name: request.requester?.full_name ?? 'Unknown',
        service_name: request.service?.name ?? '—',
        category_name: request.category?.name ?? null,
        sub_category_name: request.sub_category?.name ?? null,
        created_at: request.created_at,
      },
      // Internal notes are an agent-only concern — an ad-hoc approver may not
      // be an agent at all, so they're left out of the preview entirely.
      comments: comments
        .filter((c) => !c.is_internal)
        .map((c) => ({
          id: c.id,
          body: c.body,
          created_at: c.created_at,
          author_name: c.author?.full_name ?? 'Unknown',
        })),
    },
  }
}

// Resolves the current/most recent approval for a request — used by the
// notification bell, which only stores request_id on the notification, to
// get the full ApprovalWithDetails the preview dialog's action panel needs.
export async function getApprovalForRequestAction(requestId: string): Promise<ApprovalWithDetails | null> {
  return getApprovalForRequest(requestId)
}
