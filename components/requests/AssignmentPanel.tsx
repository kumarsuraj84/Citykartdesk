'use client'

import { useState, useTransition } from 'react'
import { Loader2, UserMinus, UserPlus, RefreshCw } from 'lucide-react'
import { assignRequest } from '@/lib/actions/requests'

interface TeamMember {
  id: string
  full_name: string
}

interface AssignmentPanelProps {
  requestId: string
  currentAssigneeId: string | null
  currentAssigneeName: string | null
  viewerId: string
  teamMembers: TeamMember[]
}

export function AssignmentPanel({
  requestId,
  currentAssigneeId,
  currentAssigneeName,
  viewerId,
  teamMembers,
}: AssignmentPanelProps) {
  const [selected, setSelected]      = useState<string>(currentAssigneeId ?? viewerId)
  const [error, setError]            = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await assignRequest(requestId, selected)
      if (result.error) setError(result.error)
    })
  }

  function handleAssignToMe() {
    setError(null)
    startTransition(async () => {
      const result = await assignRequest(requestId, viewerId)
      if (result.error) setError(result.error)
    })
  }

  function handleUnassign() {
    setError(null)
    startTransition(async () => {
      const result = await assignRequest(requestId, null)
      if (result.error) setError(result.error)
    })
  }

  const isAssignedToMe = currentAssigneeId === viewerId

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Assignment</h3>

      {/* Current assignee */}
      {currentAssigneeId ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
            {currentAssigneeName?.charAt(0).toUpperCase()}
          </div>
          <span className="flex-1 text-xs font-medium text-foreground truncate">
            {currentAssigneeName}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Unassigned</p>
      )}

      {/* Assign form */}
      <form onSubmit={handleAssign} className="space-y-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}{m.id === viewerId ? ' (me)' : ''}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {currentAssigneeId ? 'Reassign' : 'Assign'}
          </button>

          {!isAssignedToMe && (
            <button
              type="button"
              onClick={handleAssignToMe}
              disabled={isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Assign to me
            </button>
          )}
        </div>

        {currentAssigneeId && (
          <button
            type="button"
            onClick={handleUnassign}
            disabled={isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          >
            <UserMinus className="h-3.5 w-3.5" />
            Unassign
          </button>
        )}
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  )
}
