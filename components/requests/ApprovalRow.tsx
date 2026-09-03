'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Clock } from 'lucide-react'
import { StatusBadge, PriorityBadge } from './RequestBadges'
import { ApprovalPreviewDialog } from './ApprovalPreviewDialog'
import { formatRelativeTime } from '@/lib/utils'
import type { ApprovalWithDetails } from '@/lib/queries/approvals'
import type { ApprovalStatus, UserRole } from '@/types'

const STATUS_ICONS: Record<ApprovalStatus, React.ElementType> = {
  pending:   Clock,
  approved:  CheckCircle2,
  rejected:  XCircle,
  cancelled: XCircle,
}

const STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending:   'text-amber-600 bg-amber-50 border-amber-200',
  approved:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  rejected:  'text-red-600 bg-red-50 border-red-200',
  cancelled: 'text-muted-foreground bg-muted border-border',
}

// Clicking a row opens a preview (ticket details + conversation) with the
// Approve/Reject actions right there — no more falling through to the full
// request page just to see what's being approved.
export function ApprovalRow({
  approval,
  viewerId,
  viewerRole,
}: {
  approval: ApprovalWithDetails
  viewerId: string
  viewerRole: UserRole
}) {
  const [open, setOpen] = useState(false)
  const req = approval.request
  if (!req) return null

  const Icon = STATUS_ICONS[approval.status]
  const colorCls = STATUS_COLORS[approval.status]
  const isParallel = approval.current_step === 0

  const currentStepInfo = isParallel
    ? null
    : approval.steps.find((s) => s.step_order === (approval.current_step ?? 1))
  const approverLabel =
    currentStepInfo?.approver_type === 'specific_user' && currentStepInfo.approver
      ? currentStepInfo.approver.full_name
      : 'Any Manager'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${colorCls}`}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
            {req.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{req.request_no}</span>
            <span className="text-muted-foreground/40">·</span>
            {req.service && <span className="text-xs text-muted-foreground">{req.service.name}</span>}
            <span className="text-muted-foreground/40">·</span>
            {req.requester && (
              <span className="text-xs text-muted-foreground">{req.requester.full_name}</span>
            )}
            {approval.status === 'pending' && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-xs text-amber-600">
                  Awaiting: {isParallel ? 'All approvers' : approverLabel}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <StatusBadge status={req.status} size="sm" />
          <PriorityBadge priority={req.priority} size="sm" />
        </div>

        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground" suppressHydrationWarning>
          {formatRelativeTime(approval.updated_at)}
        </span>
      </button>

      {open && (
        <ApprovalPreviewDialog
          approval={approval}
          viewerId={viewerId}
          viewerRole={viewerRole}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
