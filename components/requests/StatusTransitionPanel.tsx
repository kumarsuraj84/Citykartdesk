'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { updateRequestStatus } from '@/lib/actions/requests'
import { STATUS_LABELS } from '@/lib/constants/requests'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import type { RequestStatus } from '@/types'

interface StatusTransitionPanelProps {
  requestId: string
  currentStatus: RequestStatus
  isAgent: boolean
  isRequester: boolean
}

export function StatusTransitionPanel({
  requestId,
  currentStatus,
  isAgent,
  isRequester,
}: StatusTransitionPanelProps) {
  const agentOptions    = isAgent     ? (AGENT_TRANSITIONS[currentStatus]     ?? []) : []
  const requesterOptions = isRequester ? (REQUESTER_TRANSITIONS[currentStatus] ?? []) : []
  const allOptions = [
    ...agentOptions,
    ...requesterOptions.filter((s) => !agentOptions.includes(s)),
  ]

  const [selected, setSelected]   = useState<RequestStatus>(allOptions[0] ?? ('open' as RequestStatus))
  const [comment, setComment]     = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (allOptions.length === 0) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await updateRequestStatus(requestId, selected, comment || undefined)
      if (result.error) {
        setError(result.error)
      } else {
        setComment('')
      }
    })
  }

  const actionLabel =
    selected === 'open'          ? 'Reopen Request'
    : selected === 'cancelled'   ? 'Cancel Request'
    : selected === 'closed'      ? 'Close Request'
    : selected === 'resolved'    ? 'Mark as Resolved'
    : selected === 'waiting_user'? 'Set Waiting on User'
    : `Set ${STATUS_LABELS[selected]}`

  const isDestructive = selected === 'cancelled'

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Change Status</h3>

      {allOptions.length > 1 && (
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value as RequestStatus)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {allOptions.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      )}

      <textarea
        placeholder="Add a note about this status change…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className={
          isDestructive
            ? 'btn-danger w-full justify-center'
            : 'btn-gradient w-full justify-center'
        }
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          actionLabel
        )}
      </button>
    </form>
  )
}
