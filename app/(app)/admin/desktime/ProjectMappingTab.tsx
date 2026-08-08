'use client'

import { useState, useTransition } from 'react'
import { Link2, RefreshCw } from 'lucide-react'
import { saveDeskTimeMapping, reapplyDeskTimeMapping } from '@/lib/actions/admin/desktime'
import type { DeskTimeProjectMapRow } from '@/lib/queries/desktime'

const NONE = '__none__'

function MappingRow({ row, allProjects, isAdmin }: {
  row: DeskTimeProjectMapRow; allProjects: { id: string; name: string }[]; isAdmin: boolean
}) {
  const [value, setValue] = useState(row.project_id ?? NONE)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleChange(next: string) {
    setValue(next)
    setError(null)
    startTransition(async () => {
      const result = await saveDeskTimeMapping(row.id, next === NONE ? null : next)
      if (result.error) setError(result.error)
    })
  }

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 font-medium text-foreground">{row.desktime_project_name}</td>
      <td className="px-3 py-2">
        <select
          value={value}
          disabled={!isAdmin || isPending}
          onChange={(e) => handleChange(e.target.value)}
          className="h-8 w-64 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        >
          <option value={NONE}>Ignore (unassigned)</option>
          {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${value !== NONE ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
          {value !== NONE ? 'Linked' : 'Unassigned'}
        </span>
      </td>
    </tr>
  )
}

export function ProjectMappingTab({ mapRows, allProjects, isAdmin }: {
  mapRows: DeskTimeProjectMapRow[]; allProjects: { id: string; name: string }[]; isAdmin: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleReapply() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const result = await reapplyDeskTimeMapping()
      if (result.error) { setError(result.error); return }
      if (result.data) setMessage(`Re-applied mapping — ${result.data.updated} time entr${result.data.updated === 1 ? 'y' : 'ies'} updated.`)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">DeskTime → project mapping</h2>
        </div>
        {isAdmin && (
          <button onClick={handleReapply} disabled={isPending} className="btn-soft disabled:opacity-40">
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
            Re-apply mapping
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Every DeskTime project seen during a sync appears here. Choose the CityKart project it belongs to, or leave it ignored to keep its hours unassigned.
      </p>
      {message && <p className="text-xs text-emerald-600">{message}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {mapRows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No DeskTime projects discovered yet — run a sync first.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">DeskTime project</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">CityKart project</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {mapRows.map((row) => <MappingRow key={row.id} row={row} allProjects={allProjects} isAdmin={isAdmin} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
