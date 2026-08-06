'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'

type ActionResult = { error?: string }

export async function searchUsersForDelegation(
  query: string
): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  const safe = query.replace(/[%_]/g, '\\$&').trim()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .ilike('full_name', `%${safe}%`)
    .order('full_name')
    .limit(10)
  return (data ?? []) as { id: string; full_name: string }[]
}

// Search all active users (for ad-hoc approval picker)
export async function searchManagersForApproval(
  query: string
): Promise<{ id: string; full_name: string; role: string }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as any
  const safe = query.replace(/[%_]/g, '\\$&').trim()
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .eq('is_active', true)
    .ilike('full_name', `%${safe}%`)
    .order('full_name')
    .limit(8)
  return (data ?? []) as { id: string; full_name: string; role: string }[]
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as any

  const { data: req } = await supabase
    .from('requests')
    .select('id, title, status, team_id, requester_id')
    .eq('id', requestId)
    .single()
  if (!req) return { error: 'Request not found.' }

  const onTeam = profile.team_members.some((m: any) => m.team_id === req.team_id)
  if (!['manager', 'admin'].includes(profile.role) && !onTeam)
    return { error: 'Unauthorized.' }

  if (['resolved', 'closed', 'cancelled', 'pending_approval'].includes(req.status))
    return { error: 'Request is already in approval or a terminal state.' }

  // Verify all approvers exist and are active
  const { data: approvers } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', approverIds)
    .eq('is_active', true)
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

  // Create ad-hoc workflow
  const { data: workflow, error: wfErr } = await admin
    .from('approval_workflows')
    .insert({ name: `Ad-hoc: ${req.title}` })
    .select('id')
    .single()
  if (wfErr || !workflow) return { error: wfErr?.message ?? 'Failed to create approval workflow.' }

  // Create one step per approver (step_order 1..N)
  const stepRows = approverIds.map((uid, i) => ({
    workflow_id: workflow.id,
    step_order: i + 1,
    approver_type: 'specific_user' as const,
    approver_user_id: uid,
  }))
  const { error: stepErr } = await admin.from('approval_workflow_steps').insert(stepRows)
  if (stepErr) return { error: stepErr.message }

  // current_step = 0 means parallel — everyone acts simultaneously
  const { data: approval, error: approvalErr } = await admin
    .from('approvals')
    .insert({ request_id: requestId, workflow_id: workflow.id, status: 'pending', current_step: 0 })
    .select('id')
    .single()
  if (approvalErr || !approval) return { error: approvalErr?.message ?? 'Failed to create approval.' }

  // Put request on hold
  const { error: stErr } = await admin
    .from('requests')
    .update({ status: 'pending_approval', updated_at: new Date().toISOString() })
    .eq('id', requestId)
  if (stErr) return { error: stErr.message }

  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'status_changed',
    metadata: { from: req.status, to: 'pending_approval' },
  }).catch(() => {})

  // Notify all approvers at once
  const approverMap = new Map((approvers as any[]).map((a: any) => [a.id, a.full_name]))
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

  revalidatePath(`/requests/${requestId}`)
  return {}
}

// ── Shared: verify the caller is the correct approver for the current step ────

async function resolveApprovalContext(approvalId: string) {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' } as const

  const isManager = profile.role === 'manager' || profile.role === 'admin'

  const { data: approval } = await supabase
    .from('approvals')
    .select('id, request_id, workflow_id, current_step, status')
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as unknown as any
    const { data: decisions } = await admin
      .from('approval_decisions')
      .select('step_order')
      .eq('approval_id', approvalId)
    const decidedSteps = new Set((decisions ?? []).map((d: any) => d.step_order))

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

  const { approval, steps, currentStep, profile, supabase, isParallel, decidedSteps } = ctx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as any

  // Record the decision
  const { error: decisionError } = await admin.from('approval_decisions').insert({
    approval_id: approvalId,
    step_order: currentStep.step_order,
    decided_by: profile.id,
    decision: 'approved',
    comment: comment?.trim() || null,
  })
  if (decisionError) return { error: decisionError.message }

  // For parallel: done when all steps now have an approved decision
  const nowApprovedSteps = new Set([...decidedSteps, currentStep.step_order])
  const allApproved = isParallel
    ? steps.every((s) => nowApprovedSteps.has(s.step_order))
    : currentStep.step_order >= Math.max(...steps.map((s) => s.step_order))

  const isLastStep = allApproved

  if (isLastStep) {
    // All steps approved — move approval to approved + unblock the request
    const { error: approvalUpdateError } = await admin
      .from('approvals')
      .update({ status: 'approved' })
      .eq('id', approvalId)
    if (approvalUpdateError) return { error: approvalUpdateError.message }

    const { error: requestUpdateError } = await supabase
      .from('requests')
      .update({ status: 'open' })
      .eq('id', approval.request_id)
    if (requestUpdateError) return { error: requestUpdateError.message }

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
      metadata: { from: 'pending_approval', to: 'open' },
    })

    // Notify requester: approval fully approved
    const { data: req } = await admin
      .from('requests')
      .select('requester_id')
      .eq('id', approval.request_id)
      .single()
    if (req && req.requester_id !== profile.id) {
      notify({
        recipientId: req.requester_id,
        actorId: profile.id,
        type: 'approval_approved',
        title: 'Your request has been approved',
        body: `${profile.full_name} approved it — your request is now open.`,
        requestId: approval.request_id,
        link: `/requests/${approval.request_id}`,
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
      if (advanceError) return { error: advanceError.message }

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

  const isManager = profile.role === 'manager' || profile.role === 'admin'

  const { data: approval } = await supabase
    .from('approvals')
    .select('id, request_id, workflow_id, current_step, status')
    .eq('id', approvalId)
    .single()

  if (!approval) return { error: 'Approval not found.' }
  if (approval.status !== 'pending') return { error: 'This approval is no longer pending.' }

  const { data: currentStep } = await supabase
    .from('approval_workflow_steps')
    .select('id, step_order, approver_type, approver_user_id')
    .eq('workflow_id', approval.workflow_id)
    .eq('step_order', approval.current_step ?? 1)
    .single()

  if (!currentStep) return { error: 'Current approval step not found.' }

  const canDelegate =
    (currentStep.approver_type === 'any_manager' && isManager) ||
    (currentStep.approver_type === 'specific_user' && currentStep.approver_user_id === profile.id)

  if (!canDelegate) return { error: 'You are not the designated approver for this step.' }

  const admin = createAdminClient()
  const { error: updateError } = await admin
    .from('approval_workflow_steps')
    .update({ approver_user_id: newApproverId, approver_type: 'specific_user' })
    .eq('id', currentStep.id)

  if (updateError) return { error: updateError.message }

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

  const { approval, currentStep, profile, supabase } = ctx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as any

  const { error: decisionError } = await admin.from('approval_decisions').insert({
    approval_id: approvalId,
    step_order: currentStep.step_order,
    decided_by: profile.id,
    decision: 'rejected',
    comment: comment?.trim() || null,
  })
  if (decisionError) return { error: decisionError.message }

  const { error: approvalUpdateError } = await admin
    .from('approvals')
    .update({ status: 'rejected' })
    .eq('id', approvalId)
  if (approvalUpdateError) return { error: approvalUpdateError.message }

  const { error: requestUpdateError } = await supabase
    .from('requests')
    .update({ status: 'cancelled' })
    .eq('id', approval.request_id)
  if (requestUpdateError) return { error: requestUpdateError.message }

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
      body: `${profile.full_name} rejected the approval${comment ? `: "${comment.trim()}"` : '.'}`,
      requestId: approval.request_id,
      link: `/requests/${approval.request_id}?tab=approvals`,
    }).catch(() => {})
  }

  revalidatePath(`/requests/${approval.request_id}`)
  revalidatePath('/approvals')
  revalidatePath('/home')

  return {}
}
