// Delegating ONE approval must change only that approval. Audit finding D-016: delegateApproval() rewrote the step of the workflow itself
// (approval_workflow_steps), so for a workflow shared by a service (or by other approvals) it silently re-pointed every other pending and
// future approval on that workflow to the new person, and turned an "any manager" step into a fixed person for everyone.
//
// Before a step is changed, a workflow that something else also uses is copied for this one approval; the copy is what gets changed.
// A workflow that belongs only to this approval (an ad-hoc one) is changed in place, as before.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type IsolatedStep = { stepId: string; workflowId: string; copied: boolean }

export async function isolateStepForDelegation(
  admin: AnyClient,
  approval: { id: string; workflow_id: string },
  stepOrder: number,
): Promise<IsolatedStep | { error: string }> {
  const [{ count: otherApprovals }, { count: services }] = await Promise.all([
    admin.from('approvals').select('id', { count: 'exact', head: true }).eq('workflow_id', approval.workflow_id).neq('id', approval.id),
    admin.from('services').select('id', { count: 'exact', head: true }).eq('approval_workflow_id', approval.workflow_id),
  ])

  const stepOf = async (workflowId: string) => {
    const { data } = await admin.from('approval_workflow_steps').select('id').eq('workflow_id', workflowId).eq('step_order', stepOrder).maybeSingle()
    return (data?.id as string | undefined) ?? null
  }

  if (!(otherApprovals ?? 0) && !(services ?? 0)) {
    const stepId = await stepOf(approval.workflow_id)
    return stepId ? { stepId, workflowId: approval.workflow_id, copied: false } : { error: 'Current approval step not found.' }
  }

  // shared: copy the workflow and its steps for this approval only
  const { data: source } = await admin.from('approval_workflows').select('name, description, org_id').eq('id', approval.workflow_id).maybeSingle()
  if (!source) return { error: 'Approval workflow not found.' }
  const { data: copy, error: copyErr } = await admin
    .from('approval_workflows')
    .insert({ name: `Delegated: ${source.name}`.slice(0, 200), description: source.description, org_id: source.org_id })
    .select('id')
    .single()
  if (copyErr || !copy) return { error: 'Failed to delegate approval.' }

  const cleanup = () => admin.from('approval_workflows').delete().eq('id', copy.id)
  const { data: steps } = await admin.from('approval_workflow_steps').select('step_order, approver_type, approver_user_id').eq('workflow_id', approval.workflow_id)
  const { error: stepsErr } = await admin.from('approval_workflow_steps').insert(
    (steps ?? []).map((s: { step_order: number; approver_type: string; approver_user_id: string | null }) => ({ workflow_id: copy.id, step_order: s.step_order, approver_type: s.approver_type, approver_user_id: s.approver_user_id })),
  )
  if (stepsErr) { await cleanup(); return { error: 'Failed to delegate approval.' } }

  const { error: repointErr } = await admin.from('approvals').update({ workflow_id: copy.id }).eq('id', approval.id)
  if (repointErr) { await cleanup(); return { error: 'Failed to delegate approval.' } }

  const stepId = await stepOf(copy.id)
  return stepId ? { stepId, workflowId: copy.id, copied: true } : { error: 'Current approval step not found.' }
}
