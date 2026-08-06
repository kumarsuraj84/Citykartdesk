'use client'

import { useState, useTransition } from 'react'
import { Save, Check, AlertTriangle } from 'lucide-react'
import { updateSLATier } from '@/lib/actions/admin/config'
import type { SLAConfigRow } from '@/lib/queries/admin'

const PRIORITY_STYLES: Record<string, { badge: string; label: string }> = {
  urgent: { badge: 'bg-red-50 text-red-700 border-red-100',    label: 'Urgent / Critical' },
  high:   { badge: 'bg-orange-50 text-orange-700 border-orange-100', label: 'High' },
  medium: { badge: 'bg-blue-50 text-blue-700 border-blue-100', label: 'Medium' },
  low:    { badge: 'bg-slate-50 text-slate-600 border-slate-200', label: 'Low' },
}

function formatHours(h: number | null): string {
  if (h === null || h === undefined) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

interface RowProps {
  row: SLAConfigRow
}

function SLARow({ row }: RowProps) {
  const [editing, setEditing]             = useState(false)
  const [responseHours, setResponseHours] = useState(String(row.response_hours ?? ''))
  const [resolutionHours, setResolutionHours] = useState(String(row.resolution_hours ?? ''))
  const [escalationPct, setEscalationPct] = useState(String(row.escalation_pct))
  const [saved, setSaved]                 = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [isPending, startTransition]      = useTransition()
  const style                             = PRIORITY_STYLES[row.priority]

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateSLATier(row.priority, {
        response_hours:   responseHours   ? parseFloat(responseHours)   : null,
        resolution_hours: resolutionHours ? parseFloat(resolutionHours) : null,
        escalation_pct:   escalationPct   ? parseInt(escalationPct, 10) : 80,
      })
      if (result.error) { setError(result.error); return }
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  if (!editing) {
    return (
      <div className="grid grid-cols-[140px_1fr_1fr_1fr_100px] items-center border-b border-border/50 last:border-0 px-4 py-3">
        <span className={`inline-flex w-fit rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}>
          {style.label}
        </span>
        <span className="text-sm text-foreground tabular-nums">
          {formatHours(row.response_hours)}
        </span>
        <span className="text-sm text-foreground tabular-nums">
          {formatHours(row.resolution_hours)}
        </span>
        <span className="text-sm text-foreground">
          {row.escalation_pct}%
        </span>
        <div className="flex items-center gap-2">
          {saved && <Check className="h-4 w-4 text-emerald-500" />}
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-primary hover:underline"
          >
            Edit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-border/50 last:border-0 px-4 py-3 bg-muted/20 space-y-3">
      <div className="flex items-center gap-3">
        <span className={`inline-flex w-fit rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}>
          {style.label}
        </span>
        <span className="text-xs text-muted-foreground">Editing</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Response (hours)</label>
          <input
            type="number"
            min="0"
            step="0.25"
            value={responseHours}
            onChange={(e) => setResponseHours(e.target.value)}
            placeholder="e.g. 1"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {responseHours && <p className="text-[10px] text-muted-foreground">{formatHours(parseFloat(responseHours))}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Resolution (hours)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={resolutionHours}
            onChange={(e) => setResolutionHours(e.target.value)}
            placeholder="e.g. 8"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {resolutionHours && <p className="text-[10px] text-muted-foreground">{formatHours(parseFloat(resolutionHours))}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">Escalation at %</label>
          <input
            type="number"
            min="1"
            max="100"
            value={escalationPct}
            onChange={(e) => setEscalationPct(e.target.value)}
            placeholder="80"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground">% of resolution SLA elapsed</p>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="btn-gradient disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="btn-soft"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function SLAConfigClient({ initialConfig }: { initialConfig: SLAConfigRow[] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="grid grid-cols-[140px_1fr_1fr_1fr_100px] border-b border-border bg-muted/30 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Response SLA</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resolution SLA</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Escalation</span>
        <span />
      </div>
      {initialConfig.map((row) => (
        <SLARow key={row.priority} row={row} />
      ))}
    </div>
  )
}
