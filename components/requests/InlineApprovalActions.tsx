'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { approveApproval, rejectApproval } from '@/lib/actions/approvals'

interface InlineApprovalActionsProps {
  approvalId: string
}

export function InlineApprovalActions({ approvalId }: InlineApprovalActionsProps) {
  const [isPending, startTransition] = useTransition()
  const [showConfirm, setShowConfirm] = useState<'approve' | 'reject' | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveApproval(approvalId, comment || undefined)
      if (result.error) setError(result.error)
      else { setShowConfirm(null); setComment('') }
    })
  }

  function handleReject() {
    setError(null)
    startTransition(async () => {
      const result = await rejectApproval(approvalId, comment || undefined)
      if (result.error) setError(result.error)
      else { setShowConfirm(null); setComment('') }
    })
  }

  if (showConfirm) {
    return (
      <div
        className="flex flex-col gap-2 px-4 pb-3"
        onClick={(e) => e.preventDefault()}
      >
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
        )}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment (optional)…"
          rows={2}
          className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
        />
        <div className="flex gap-2">
          {showConfirm === 'approve' ? (
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="btn-success flex-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isPending ? 'Approving…' : 'Confirm Approve'}
            </button>
          ) : (
            <button
              onClick={handleReject}
              disabled={isPending}
              className="btn-danger flex-1"
            >
              <XCircle className="h-3.5 w-3.5" />
              {isPending ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          )}
          <button
            onClick={() => { setShowConfirm(null); setComment('') }}
            className="btn-soft"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2 px-4 pb-3"
      onClick={(e) => e.preventDefault()}
    >
      <button
        onClick={() => setShowConfirm('approve')}
        className="btn-success"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approve
      </button>
      <button
        onClick={() => setShowConfirm('reject')}
        className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
      >
        <XCircle className="h-3.5 w-3.5" />
        Reject
      </button>
    </div>
  )
}
