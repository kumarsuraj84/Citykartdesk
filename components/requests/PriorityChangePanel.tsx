'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { changePriority } from '@/lib/actions/requests'
import { PRIORITY_BADGE_STYLES } from '@/lib/constants/requests'
import type { RequestPriority } from '@/types'

const PRIORITIES: { value: RequestPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
]

interface PriorityChangePanelProps {
  requestId: string
  currentPriority: RequestPriority
}

export function PriorityChangePanel({ requestId, currentPriority }: PriorityChangePanelProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSelect(priority: RequestPriority) {
    if (priority === currentPriority) { setOpen(false); return }
    setOpen(false)
    setError(null)
    startTransition(async () => {
      const result = await changePriority(requestId, priority)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Change Priority</h2>
      </div>
      <div className="p-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={isPending}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                  PRIORITY_BADGE_STYLES[currentPriority] ?? ''
                }`}
              >
                {currentPriority}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {open && (
            <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-xl border border-border bg-card shadow-lg">
              <div className="p-1">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleSelect(p.value)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                      p.value === currentPriority ? 'bg-muted/50' : ''
                    }`}
                  >
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                        PRIORITY_BADGE_STYLES[p.value] ?? ''
                      }`}
                    >
                      {p.label}
                    </span>
                    {p.value === currentPriority && (
                      <span className="ml-auto text-xs text-muted-foreground">current</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}
      </div>
    </div>
  )
}
