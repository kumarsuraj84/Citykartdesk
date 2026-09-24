'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { approveApproval, rejectApproval } from '@/lib/actions/approvals'

interface Props {
  approvalId: string
  onDecided: () => void
  onCancel: () => void
}

// The "Take Action" expansion — a comment box plus Reject/Approve, inline in
// the row it belongs to. No detail popup involved: for the common case where
// the approver already knows what they're deciding, this is the whole flow.
export function ApprovalQuickActions({ approvalId, onDecided, onCancel }: Props) {
  const [isPending, startTransition] = useTransition()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveApproval(approvalId, comment || undefined)
      if (result.error) setError(result.error)
      else onDecided()
    })
  }

  function handleReject() {
    setError(null)
    startTransition(async () => {
      const result = await rejectApproval(approvalId, comment || undefined)
      if (result.error) setError(result.error)
      else onDecided()
    })
  }

  return (
    <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{error}</p>
      )}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)…"
        rows={2}
        autoFocus
        className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
      />
      <div className="flex gap-1.5">
        <button type="button" onClick={onCancel} disabled={isPending}
          className="btn-soft px-2.5 py-1.5 text-xs">
          Cancel
        </button>
        <button type="button" onClick={handleReject} disabled={isPending}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60">
          <XCircle className="h-3.5 w-3.5" />
          {isPending ? 'Rejecting…' : 'Reject'}
        </button>
        <button type="button" onClick={handleApprove} disabled={isPending}
          className="btn-success flex-1 py-1.5 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {isPending ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
  )
}
