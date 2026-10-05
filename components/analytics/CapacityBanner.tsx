'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { WorkloadRow } from '@/lib/queries/workload'

export function CapacityBanner({ agents }: { agents: WorkloadRow[] }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || agents.length === 0) return null

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-5 py-4 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">
        <p>
          <strong>Highest open tickets</strong> — Backlog of technicians as of now:
        </p>
        <p className="mt-1 flex flex-wrap gap-x-1.5">
          {agents.map((a, i) => (
            <span key={a.agentId}>
              {a.agentName} ({a.totalOpen}){i < agents.length - 1 ? ',' : ''}
            </span>
          ))}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-amber-700/70 hover:bg-amber-100 hover:text-amber-900 transition-colors dark:text-amber-400/70 dark:hover:bg-amber-950/40"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
