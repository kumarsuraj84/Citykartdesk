'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle } from 'lucide-react'
import { decideByEmail } from '@/lib/actions/approvalEmail'

/** The decision itself: a comment (required) and Approve / Reject. The e-mail button the approver clicked is pre-selected. */
export function ApprovalDecisionForm({ token, preselect }: { token: string; preselect: 'approve' | 'reject' | null }) {
  const router = useRouter()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // which button was pressed: only that one says "Saving…" (both used to)
  const [action, setAction] = useState<'approve' | 'reject' | null>(null)

  const decide = (kind: 'approve' | 'reject') => {
    if (!comment.trim()) { setError('Please add a comment: it is required to approve or reject.'); return }
    setError(null)
    setAction(kind)
    start(async () => {
      const r = await decideByEmail(token, kind, comment.trim())
      if (r.error) setError(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <label htmlFor="apv-comment" className="text-sm font-medium">
        Your comment <span className="font-normal text-muted-foreground">(required{preselect ? `, you chose ${preselect === 'approve' ? 'Approve' : 'Reject'} in the e-mail` : ''})</span>
      </label>
      <textarea id="apv-comment" value={comment} onChange={(e) => { setComment(e.target.value); setError(null) }} rows={3} maxLength={2000} autoFocus={!!preselect}
        placeholder="Add a comment (required)…" required aria-required="true"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
      <div className="flex gap-2">
        <button type="button" onClick={() => decide('approve')} disabled={pending}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${preselect === 'reject' ? 'bg-emerald-600/80' : 'bg-emerald-600'}`}>
          <CheckCircle2 className="h-4 w-4" />{pending && action === 'approve' ? 'Saving…' : 'Approve'}
        </button>
        <button type="button" onClick={() => decide('reject')} disabled={pending}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${preselect === 'approve' ? 'bg-red-600/80' : 'bg-red-600'}`}>
          <XCircle className="h-4 w-4" />{pending && action === 'reject' ? 'Saving…' : 'Reject'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
