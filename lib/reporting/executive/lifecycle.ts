// The "Last Leg": one ticket's journey in five steps, worked out from its real dates and approval (no invented data).
//   1 raised by the store · 2 approval gate or assignment · 3 first response · 4 fulfilment / resolution · 5 store sign-off

import type { ExecTicketDetail } from '@/lib/actions/executiveDashboard'
import { humanHours } from './labels'

export type StepState = 'completed' | 'current' | 'breached' | 'pending'

export interface LifecycleStep {
  n: number
  title: string
  actor: string
  role: string
  /** when it happened (epoch ms), or null when it has not */
  at: number | null
  /** short text for the right-hand side, e.g. "2.4h" or "Awaiting decision" */
  duration: string
  state: StepState
  note: string
}

const H = 3_600_000

export interface LifecycleSummary {
  steps: LifecycleStep[]
  /** hours the ticket took (or has taken so far) */
  takenH: number
  responseTargetH: number | null
  resolutionTargetH: number | null
  /** resolved/open past its resolution target */
  breached: boolean
}

export function buildLifecycle(d: ExecTicketDetail, now: number): LifecycleSummary {
  const isResolved = d.resolved !== null
  const end = d.resolved ?? now
  const takenH = (end - d.created) / H
  const responseTargetH = d.responseDue ? (d.responseDue - d.created) / H : null
  const resolutionTargetH = d.resolutionDue ? (d.resolutionDue - d.created) / H : null
  const responseH = d.responded ? (d.responded - d.created) / H : null
  const breached = d.resolutionDue !== null && end > d.resolutionDue
  const unassigned = d.technician === 'Unassigned'

  const steps: LifecycleStep[] = []

  steps.push({
    n: 1, title: 'Store intake', actor: d.requester || 'Requester', role: d.store ? `Requester · ${d.store}` : 'Requester',
    at: d.created, duration: 'Raised', state: 'completed',
    note: `Logged via ${d.source} under ${d.group}.${d.oem ? ` Mapped OEM: ${d.oem}.` : ''}`,
  })

  if (d.approval) {
    const a = d.approval
    const waitedH = ((a.decided ?? now) - a.requested) / H
    steps.push({
      n: 2, title: 'Manager approval gate', actor: a.by || 'Approving manager', role: 'Approving authority',
      at: a.decided, duration: a.decided === null ? `${humanHours(waitedH)} waiting` : humanHours(waitedH),
      state: a.decided === null ? 'current' : 'completed',
      note: a.status === 'pending' ? 'Waiting for the manager to approve before the work can continue.' : `Decision: ${a.status}${a.by ? ` by ${a.by}` : ''}.`,
    })
  } else {
    const waitedH = d.assignedAt ? (d.assignedAt - d.created) / H : (now - d.created) / H
    steps.push({
      n: 2, title: 'Queue routing & assignment', actor: unassigned ? `${d.group} dispatcher` : d.technician, role: `${d.group} group`,
      at: d.assignedAt, duration: d.assignedAt ? humanHours(waitedH) : unassigned ? `${humanHours(waitedH)} unassigned` : '-',
      state: unassigned && !isResolved ? 'current' : 'completed',
      note: unassigned ? 'Not assigned to a technician yet.' : `Handled by ${d.technician} in ${d.group}.`,
    })
  }

  const responseLate = responseH !== null && responseTargetH !== null && responseH > responseTargetH
  const noResponseOverdue = responseH === null && d.responseDue !== null && now > d.responseDue && !isResolved
  steps.push({
    n: 3, title: 'First response', actor: unassigned ? `${d.group} technician` : d.technician, role: `${d.group} specialist`,
    at: d.responded, duration: responseH !== null ? humanHours(responseH) : '-',
    state: responseH !== null ? (responseLate ? 'breached' : 'completed') : noResponseOverdue ? 'breached' : 'pending',
    note: responseH !== null
      ? `First response after ${humanHours(responseH)}${responseTargetH !== null ? ` (target ${humanHours(responseTargetH)})` : ''}.`
      : noResponseOverdue ? 'No response yet and the response target has passed.' : 'No response yet.',
  })

  steps.push({
    n: 4, title: d.oem ? `Fulfilment & resolution (${d.brand || d.oem} store)` : 'Fulfilment & resolution',
    actor: unassigned ? `${d.group} technician` : d.technician, role: 'Resolution owner',
    at: d.resolved, duration: isResolved ? humanHours(takenH) : `${humanHours(takenH)} so far`,
    state: isResolved ? (breached ? 'breached' : 'completed') : breached ? 'breached' : 'current',
    note: isResolved
      ? `Resolved after ${humanHours(takenH)}${resolutionTargetH !== null ? ` (target ${humanHours(resolutionTargetH)})` : ''}${breached ? ' - past its SLA' : ''}.`
      : `In progress (${d.status.replace(/_/g, ' ')}); ${humanHours(takenH)} elapsed${resolutionTargetH !== null ? ` of ${humanHours(resolutionTargetH)}` : ''}.`,
  })

  steps.push({
    n: 5, title: 'Store confirmation & closure', actor: d.requester || 'Requester', role: 'Sign-off & CSAT',
    at: d.closed ?? d.resolved, duration: isResolved ? 'Completed' : '-', state: isResolved ? 'completed' : 'pending',
    note: isResolved
      ? `${d.csat ? `Rated ${d.csat.rating} out of 5${d.csat.comment ? `: “${d.csat.comment}”` : ''}.` : 'No rating given yet.'}${d.reopenCount ? ` Re-opened ${d.reopenCount} time${d.reopenCount === 1 ? '' : 's'}.` : ''}`
      : 'The store confirms and rates the service once the ticket is resolved.',
  })

  return { steps, takenH, responseTargetH, resolutionTargetH, breached }
}
