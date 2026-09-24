'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, XCircle, Clock, UserCheck, MessageSquare, CalendarDays } from 'lucide-react'
import { approveApproval, rejectApproval, delegateApproval, searchUsersForDelegation } from '@/lib/actions/approvals'
import type { ApprovalWithDetails } from '@/lib/queries/approvals'
import type { UserRole } from '@/types'

interface ApprovalPanelProps {
  approval: ApprovalWithDetails
  viewerId: string
  viewerRole: UserRole
  // Called after approve/reject/delegate succeeds -- unused on the full
  // request page (this panel is just inline there), but lets a modal host
  // like ApprovalPreviewDialog close itself once the viewer's decision is
  // done, instead of leaving them to find a separate Close button.
  onDecided?: () => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function StatusPill({ status }: { status: string }) {
  if (status === 'approved')
    return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" />Approved</span>
  if (status === 'rejected')
    return <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"><XCircle className="h-3 w-3" />Rejected</span>
  if (status === 'cancelled')
    return <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Cancelled</span>
  return <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><Clock className="h-3 w-3" />Pending</span>
}

export function ApprovalPanel({ approval, viewerId, viewerRole, onDecided }: ApprovalPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [comment, setComment]       = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [showCommentBox, setShowCommentBox] = useState<'approve' | 'reject' | null>(null)
  const [showDelegate, setShowDelegate]     = useState(false)
  const [delegateUserId, setDelegateUserId] = useState('')
  const [delegateSearch, setDelegateSearch] = useState('')
  const [delegateResults, setDelegateResults] = useState<{ id: string; full_name: string }[]>([])

  const isManager  = viewerRole === 'manager' || viewerRole === 'admin' || viewerRole === 'platform_owner'
  const isParallel = approval.current_step === 0
  const isAdHoc    = approval.workflow?.name.startsWith('Ad-hoc:') ?? false

  const currentStep = isParallel
    ? null
    : approval.steps.find((s) => s.step_order === (approval.current_step ?? 1))

  const decidedStepOrders = new Set(approval.decisions.map((d) => d.step_order))
  const myParallelStep = isParallel
    ? approval.steps.find(
        (s) => s.approver_type === 'specific_user' && s.approver_user_id === viewerId && !decidedStepOrders.has(s.step_order)
      )
    : null

  const canAct =
    approval.status === 'pending' &&
    (isParallel
      ? !!myParallelStep
      : currentStep &&
        (
          (currentStep.approver_type === 'any_manager' && isManager) ||
          (currentStep.approver_type === 'specific_user' && currentStep.approver_user_id === viewerId)
        )
    )

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveApproval(approval.id, comment || undefined)
      if (result.error) { setError(result.error) }
      else { setShowCommentBox(null); setComment(''); onDecided?.() }
    })
  }

  function handleReject() {
    setError(null)
    startTransition(async () => {
      const result = await rejectApproval(approval.id, comment || undefined)
      if (result.error) { setError(result.error) }
      else { setShowCommentBox(null); setComment(''); onDecided?.() }
    })
  }

  async function handleDelegateSearch(q: string) {
    setDelegateSearch(q)
    if (!q.trim()) { setDelegateResults([]); return }
    setDelegateResults(await searchUsersForDelegation(q))
  }

  function handleDelegate() {
    if (!delegateUserId) return
    setError(null)
    startTransition(async () => {
      const result = await delegateApproval(approval.id, delegateUserId)
      if (result.error) { setError(result.error) }
      else { setShowDelegate(false); setDelegateUserId(''); setDelegateSearch(''); setDelegateResults([]); onDecided?.() }
    })
  }

  const approvedCount = approval.decisions.filter((d) => d.decision === 'approved').length
  const totalSteps    = approval.steps.length

  return (
    <div className="space-y-3">

      {/* ── Header card ── */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        {/* Status + sent date row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <StatusPill status={approval.status} />
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            Sent {formatDate(approval.created_at)}
          </div>
        </div>

        {/* Workflow name (non-ad-hoc only) */}
        {!isAdHoc && approval.workflow?.name && (
          <p className="text-xs text-muted-foreground">
            Workflow: <span className="font-medium text-foreground">{approval.workflow.name}</span>
          </p>
        )}

        {/* Progress summary */}
        {isParallel && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">All must approve to release</span>
              <span className="font-semibold text-foreground">{approvedCount}/{totalSteps}</span>
            </div>
            {totalSteps > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${
                    approvedCount === totalSteps ? 'bg-emerald-500' : 'bg-amber-400'
                  }`}
                  style={{ width: `${(approvedCount / totalSteps) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Approvers list ── */}
      {approval.steps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {isParallel ? 'Approvers' : 'Approval Steps'}
          </p>

          {approval.steps.map((step, idx) => {
            const decision = approval.decisions.find((d) => d.step_order === step.step_order)
            const isCurrent = !isParallel && approval.status === 'pending' && step.step_order === (approval.current_step ?? 1)
            const isAwaiting = isParallel ? (approval.status === 'pending' && !decision) : isCurrent
            const approverName =
              step.approver_type === 'specific_user'
                ? (step.approver?.full_name ?? 'Unknown user')
                : decision?.decider?.full_name ?? 'Any Manager'
            const isMe = step.approver_user_id === viewerId

            return (
              <div
                key={step.id}
                className={`rounded-lg border px-4 py-3 space-y-2 ${
                  decision?.decision === 'approved'
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : decision?.decision === 'rejected'
                    ? 'border-red-200 bg-red-50/50'
                    : isAwaiting
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-border bg-muted/20'
                }`}
              >
                {/* Approver row */}
                <div className="flex items-center gap-3">
                  {/* Avatar initial */}
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      decision?.decision === 'approved'
                        ? 'bg-emerald-500 text-white'
                        : decision?.decision === 'rejected'
                        ? 'bg-red-500 text-white'
                        : isAwaiting
                        ? 'bg-amber-400 text-white'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isParallel
                      ? approverName.charAt(0).toUpperCase()
                      : (decision?.decision === 'approved' ? '✓' : decision?.decision === 'rejected' ? '✕' : String(idx + 1))}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{approverName}</span>
                      {isMe && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">You</span>
                      )}
                      {!decision && isAwaiting && (
                        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Awaiting</span>
                      )}
                    </div>
                  </div>

                  {/* Decision badge */}
                  {decision && (
                    <span className={`shrink-0 text-[11px] font-semibold ${
                      decision.decision === 'approved' ? 'text-emerald-700' : 'text-red-600'
                    }`}>
                      {decision.decision === 'approved' ? '✓ Approved' : '✕ Rejected'}
                    </span>
                  )}
                </div>

                {/* Decision detail */}
                {decision && (
                  <div className="ml-10 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      {decision.decider?.full_name ?? 'Unknown'} · {formatDate(decision.decided_at)}
                    </p>
                    {decision.comment && (
                      <div className="flex items-start gap-2 rounded-md border border-border/60 bg-white/70 px-3 py-2">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                        <p className="text-xs text-foreground leading-relaxed">{decision.comment}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Action buttons ── */}
      {canAct && (
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-xs font-semibold text-foreground">Your decision is needed</p>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}

          {showCommentBox && (
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment (optional)…"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          )}

          <div className="flex gap-2">
            {showCommentBox === 'approve' ? (
              <>
                <button onClick={handleApprove} disabled={isPending}
                  className="btn-success flex-1">
                  <CheckCircle2 className="h-4 w-4" />
                  {isPending ? 'Approving…' : 'Confirm Approve'}
                </button>
                <button onClick={() => { setShowCommentBox(null); setComment('') }}
                  className="btn-soft">
                  Cancel
                </button>
              </>
            ) : showCommentBox === 'reject' ? (
              <>
                <button onClick={handleReject} disabled={isPending}
                  className="btn-danger flex-1">
                  <XCircle className="h-4 w-4" />
                  {isPending ? 'Rejecting…' : 'Confirm Reject'}
                </button>
                <button onClick={() => { setShowCommentBox(null); setComment('') }}
                  className="btn-soft">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setShowCommentBox('approve')}
                  className="btn-success flex-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </button>
                <button onClick={() => setShowCommentBox('reject')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
                <button onClick={() => { setShowDelegate((v) => !v); setShowCommentBox(null) }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                  title="Delegate to another user">
                  <UserCheck className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {showDelegate && !showCommentBox && (
            <div className="space-y-2 rounded-lg border border-border bg-background px-3 py-3">
              <p className="text-xs font-semibold text-muted-foreground">Delegate to</p>
              <input
                type="text"
                value={delegateSearch}
                onChange={(e) => handleDelegateSearch(e.target.value)}
                placeholder="Search by name…"
                className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {delegateResults.length > 0 && (
                <ul className="rounded-lg border border-border bg-card divide-y divide-border max-h-40 overflow-auto">
                  {delegateResults.map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => { setDelegateUserId(u.id); setDelegateSearch(u.full_name); setDelegateResults([]) }}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors ${delegateUserId === u.id ? 'bg-primary/10 text-primary font-semibold' : ''}`}
                      >
                        {u.full_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <button onClick={handleDelegate} disabled={isPending || !delegateUserId}
                  className="btn-gradient flex-1">
                  <UserCheck className="h-4 w-4" />
                  {isPending ? 'Delegating…' : 'Delegate'}
                </button>
                <button
                  onClick={() => { setShowDelegate(false); setDelegateUserId(''); setDelegateSearch(''); setDelegateResults([]) }}
                  className="btn-soft">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
