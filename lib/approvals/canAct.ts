import type { ApprovalWithDetails } from '@/lib/queries/approvals'
import type { UserRole } from '@/types'

// Client-safe (type-only imports of the server query module — see
// lib/queries/technicianWorkloadShared.ts for why that distinction matters).
// Single source of truth for "can this viewer act on this approval right
// now" — mirrors resolveApprovalContext() in lib/actions/approvals.ts
// exactly, so a row that renders quick-action buttons is guaranteed to
// actually be actionable when the server action runs.

export function canActOnApproval(
  approval: ApprovalWithDetails,
  viewerId: string,
  viewerRole: UserRole
): boolean {
  if (approval.status !== 'pending') return false

  const isManager = viewerRole === 'manager' || viewerRole === 'admin' || viewerRole === 'platform_owner'
  const isParallel = approval.current_step === 0

  if (isParallel) {
    const decidedStepOrders = new Set(approval.decisions.map((d) => d.step_order))
    return approval.steps.some(
      (s) => s.approver_type === 'specific_user' && s.approver_user_id === viewerId && !decidedStepOrders.has(s.step_order)
    )
  }

  const currentStep = approval.steps.find((s) => s.step_order === (approval.current_step ?? 1))
  if (!currentStep) return false

  return (
    (currentStep.approver_type === 'any_manager' && isManager) ||
    (currentStep.approver_type === 'specific_user' && currentStep.approver_user_id === viewerId)
  )
}
