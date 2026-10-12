// The names shown on an approval row: who the request is waiting on while it is pending, and who approved or rejected it once decided.
// Pure, so the wording is easy to test; used by components/requests/ApprovalRow.tsx.

import type { ApprovalWithDetails } from '@/lib/queries/approvals'

export interface ApprovalPeopleLine {
  tone: 'pending' | 'approved' | 'rejected' | 'none'
  /** the short line on the row */
  text: string
  /** everyone the approval was sent to, for the hover text */
  allApprovers: string[]
}

const join = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

type Step = ApprovalWithDetails['steps'][number]
const stepName = (s: Step) => (s.approver_type === 'any_manager' ? 'any manager' : (s.approver?.full_name ?? 'an approver'))

export function approvalPeopleLine(approval: Pick<ApprovalWithDetails, 'status' | 'current_step' | 'steps' | 'decisions'>): ApprovalPeopleLine {
  const steps = [...approval.steps].sort((a, b) => a.step_order - b.step_order)
  const decisions = [...approval.decisions].sort((a, b) => new Date(a.decided_at).getTime() - new Date(b.decided_at).getTime())
  const allApprovers = [...new Set(steps.map(stepName))]
  const decidedSteps = new Set(decisions.map((d) => d.step_order))
  const decidedBy = (d: (typeof decisions)[number]) => d.decider?.full_name ?? 'an approver'

  if (approval.status === 'pending') {
    if (approval.current_step === 0) {
      // everyone asked at once: whoever has not answered yet
      const waiting = [...new Set(steps.filter((s) => !decidedSteps.has(s.step_order)).map(stepName))]
      return { tone: 'pending', text: waiting.length > 0 ? `Awaiting: ${join(waiting)}` : 'Awaiting approval', allApprovers }
    }
    const current = steps.find((s) => s.step_order === (approval.current_step ?? 1))
    const later = steps.filter((s) => s.step_order > (approval.current_step ?? 1)).map(stepName)
    const position = steps.length > 1 && current ? ` (step ${steps.indexOf(current) + 1} of ${steps.length})` : ''
    return {
      tone: 'pending',
      text: current ? `Awaiting: ${stepName(current)}${position}${later.length > 0 ? `, then ${join([...new Set(later)])}` : ''}` : 'Awaiting approval',
      allApprovers,
    }
  }

  if (approval.status === 'approved' || approval.status === 'rejected') {
    const verb = approval.status === 'approved' ? 'Approved' : 'Rejected'
    const matching = decisions.filter((d) => d.decision === approval.status)
    const by = [...new Set((matching.length > 0 ? matching : decisions.slice(-1)).map(decidedBy))]
    // asked but not needed (the first answer settled it)
    const notNeeded = [...new Set(steps.filter((s) => !decidedSteps.has(s.step_order)).map(stepName))].filter((n) => !by.includes(n))
    return {
      tone: approval.status,
      text: `${verb} by ${join(by) || 'an approver'}${notNeeded.length > 0 ? ` · also asked: ${join(notNeeded)}` : ''}`,
      allApprovers,
    }
  }
  return { tone: 'none', text: '', allApprovers }
}
