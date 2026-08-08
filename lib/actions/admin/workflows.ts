'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getApprovalWorkflowWithSteps, type ApprovalWorkflowStep } from '@/lib/queries/admin'

type ActionResult<T = undefined> = T extends undefined
  ? { error?: string }
  : { error?: string; data?: T }

// ── Guard: admin or manager ───────────────────────────────────────────────────

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner') {
    return { error: 'Admin or manager role required.' }
  }
  return { profile }
}

// ── Workflow CRUD ─────────────────────────────────────────────────────────────

export async function createWorkflow(name: string): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if ('error' in guard && guard.error) return { error: guard.error }
  if (!guard.profile?.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('approval_workflows')
    .insert({ name: name.trim(), org_id: guard.profile.org_id })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/admin/approvals')
  return { data: { id: data.id } }
}

export async function updateWorkflow(id: string, name: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if ('error' in guard && guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin
    .from('approval_workflows')
    .update({ name: name.trim() })
    .eq('id', id)
    .eq('org_id', guard.profile!.org_id!)

  if (error) return { error: error.message }

  revalidatePath('/admin/approvals')
  return {}
}

export async function deleteWorkflow(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if ('error' in guard && guard.error) return { error: guard.error }

  const admin = createAdminClient()

  // Check if any active service uses this workflow
  const { data: bound } = await admin
    .from('services')
    .select('id, name')
    .eq('approval_workflow_id', id)
    .eq('is_active', true)
    .limit(1)

  if (bound && bound.length > 0) {
    return { error: `Cannot delete: workflow is used by active service "${bound[0].name}". Unbind it first.` }
  }

  const { error } = await admin
    .from('approval_workflows')
    .delete()
    .eq('id', id)
    .eq('org_id', guard.profile!.org_id!)

  if (error) return { error: error.message }

  revalidatePath('/admin/approvals')
  return {}
}

// ── Workflow Steps ────────────────────────────────────────────────────────────

/** Fetches a workflow's steps on demand — the list view never loads them upfront. */
export async function fetchWorkflowSteps(workflowId: string): Promise<ActionResult<ApprovalWorkflowStep[]>> {
  const guard = await requireAdminOrManager()
  if ('error' in guard && guard.error) return { error: guard.error }

  const workflow = await getApprovalWorkflowWithSteps(workflowId)
  if (!workflow) return { error: 'Workflow not found.' }
  return { data: workflow.steps }
}

type UpsertStepInput = {
  id?: string
  workflowId: string
  stepOrder: number
  approverType: 'specific_user' | 'any_manager'
  approverUserId?: string | null
}

export async function upsertWorkflowStep(input: UpsertStepInput): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if ('error' in guard && guard.error) return { error: guard.error }

  if (input.approverType === 'specific_user' && !input.approverUserId) {
    return { error: 'A specific user must be selected for this approver type.' }
  }

  if (input.approverType === 'any_manager' && input.approverUserId) {
    return { error: 'Any-manager steps must not have a specific user set.' }
  }

  const admin = createAdminClient()

  // approval_workflow_steps has no org_id of its own — scope via its parent workflow.
  const { data: workflow } = await admin
    .from('approval_workflows')
    .select('id')
    .eq('id', input.workflowId)
    .eq('org_id', guard.profile!.org_id!)
    .maybeSingle()
  if (!workflow) return { error: 'Workflow not found.' }

  const payload = {
    workflow_id: input.workflowId,
    step_order: input.stepOrder,
    approver_type: input.approverType,
    approver_user_id: input.approverType === 'specific_user' ? (input.approverUserId ?? null) : null,
  }

  let id: string

  if (input.id) {
    // Confirm the step being edited already belongs to that (in-org) workflow.
    const { data: existingStep } = await admin
      .from('approval_workflow_steps')
      .select('id')
      .eq('id', input.id)
      .eq('workflow_id', input.workflowId)
      .maybeSingle()
    if (!existingStep) return { error: 'Step not found.' }

    const { data, error } = await admin
      .from('approval_workflow_steps')
      .update(payload)
      .eq('id', input.id)
      .select('id')
      .single()
    if (error) return { error: error.message }
    id = data.id
  } else {
    const { data, error } = await admin
      .from('approval_workflow_steps')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { error: error.message }
    id = data.id
  }

  revalidatePath('/admin/approvals')
  return { data: { id } }
}

export async function deleteWorkflowStep(stepId: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if ('error' in guard && guard.error) return { error: guard.error }

  const admin = createAdminClient()

  // approval_workflow_steps has no org_id of its own — scope via its parent workflow.
  const { data: existingStep } = await admin
    .from('approval_workflow_steps')
    .select('id, approval_workflows!inner(org_id)')
    .eq('id', stepId)
    .eq('approval_workflows.org_id', guard.profile!.org_id!)
    .maybeSingle()
  if (!existingStep) return { error: 'Step not found.' }

  const { error } = await admin
    .from('approval_workflow_steps')
    .delete()
    .eq('id', stepId)

  if (error) return { error: error.message }

  revalidatePath('/admin/approvals')
  return {}
}

// ── Service Binding ───────────────────────────────────────────────────────────

export async function bindWorkflowToService(
  workflowId: string | null,
  serviceId: string
): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if ('error' in guard && guard.error) return { error: guard.error }

  const admin = createAdminClient()

  // If binding to a workflow (not unbinding), confirm it's in-org before attaching it.
  if (workflowId) {
    const { data: workflow } = await admin.from('approval_workflows').select('id').eq('id', workflowId).eq('org_id', guard.profile!.org_id!).maybeSingle()
    if (!workflow) return { error: 'Workflow not found.' }
  }

  const { error } = await admin
    .from('services')
    .update({ approval_workflow_id: workflowId })
    .eq('id', serviceId)
    .eq('org_id', guard.profile!.org_id!)

  if (error) return { error: error.message }

  revalidatePath('/admin/approvals')
  revalidatePath('/admin/services')
  return {}
}
