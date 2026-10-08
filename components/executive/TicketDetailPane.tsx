'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { getExecutiveTicketDetail, type ExecTicketDetail } from '@/lib/actions/executiveDashboard'
import { statusLabel } from '@/lib/reporting/executive/engine'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function when(ms: number | null): string {
  if (ms === null) return '-'
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const hoursText = (h: number) => (h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)} days`)

/** One ticket's facts, SLA position and timeline — the last level of every drill-down. */
export function TicketDetailPane({ id, now, onBack }: { id: string; now: number; onBack: () => void }) {
  const [state, setState] = useState<{ id: string; detail?: ExecTicketDetail; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    getExecutiveTicketDetail(id).then((r) => {
      if (!alive) return
      setState('error' in r ? { id, error: r.error } : { id, detail: r.detail })
    }).catch(() => { if (alive) setState({ id, error: 'Could not load this ticket.' }) })
    return () => { alive = false }
  }, [id])

  const loading = !state || state.id !== id
  const d = !loading ? state.detail : undefined

  return (
    <div className="space-y-3">
      {loading && <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the ticket…</p>}
      {!loading && state.error && <p className="py-6 text-sm text-destructive">{state.error}</p>}
      {d && <Body d={d} now={now} />}
      <button type="button" onClick={onBack} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted">← Back to the list</button>
    </div>
  )
}

function Body({ d, now }: { d: ExecTicketDetail; now: number }) {
  const end = d.resolved ?? now
  const taken = (end - d.created) / 3_600_000
  const target = d.resolutionDue ? (d.resolutionDue - d.created) / 3_600_000 : null
  const breached = d.resolutionDue !== null && end > d.resolutionDue
  const pct = target ? Math.min(100, (taken / target) * 100) : 0
  const firstResponse = d.responded ? (d.responded - d.created) / 3_600_000 : null
  const fields: [string, string][] = [
    ['Requester', [d.requester, d.department].filter(Boolean).join(' · ')],
    ['Store / OEM', [d.store, d.oem].filter(Boolean).join(' · ') || '-'],
    ['Group / Technician', `${d.group} / ${d.technician}`],
    ['Category', [d.category, d.subCategory].filter(Boolean).join(' › ')],
    ['Service', d.service || '-'],
    ['Priority / Status', `${d.priority} · ${statusLabel(d.status)}`],
    ['Created', when(d.created)],
    [d.resolved ? 'Resolved' : 'Still open', d.resolved ? when(d.resolved) : `${Math.floor(taken / 24)} days so far`],
    ['First response', firstResponse !== null ? `${hoursText(firstResponse)} after it was raised` : 'No response yet'],
    ['Re-opened', d.reopenCount ? `${d.reopenCount} time${d.reopenCount === 1 ? '' : 's'}` : 'Never'],
    ['CSAT', d.csat ? `${'★'.repeat(d.csat.rating ?? 0)}${'☆'.repeat(5 - (d.csat.rating ?? 0))}${d.csat.comment ? ` - “${d.csat.comment}”` : ''}` : 'Not rated'],
  ]
  return (
    <>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{d.no}</p>
        <h4 className="text-base font-semibold text-foreground">{d.subject}</h4>
        {d.description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{d.description}</p>}
      </div>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="text-[13px] text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {target !== null && (
        <div>
          <p className="text-[13px] font-semibold">Time taken vs resolution target</p>
          <div className="my-1.5 h-3 overflow-hidden rounded-full bg-muted"><div className={`h-full ${breached ? 'bg-destructive' : 'bg-success'}`} style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-muted-foreground">
            {hoursText(taken)} {d.resolved ? 'taken' : 'so far'} · target {hoursText(target)} ·{' '}
            <b className={breached ? 'text-destructive' : 'text-success'}>{breached ? 'SLA breached' : 'within SLA'}</b>
          </p>
        </div>
      )}
      <div>
        <p className="text-[13px] font-semibold">Timeline</p>
        {d.events.length === 0 ? <p className="text-xs text-muted-foreground">No activity recorded.</p> : (
          <ol className="ml-2 mt-2 space-y-2.5 border-l-2 border-border pl-4">
            {d.events.map((e, i) => (
              <li key={i} className="relative text-[13px]">
                <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                {e.label}
                <span className="block text-[11.5px] text-muted-foreground">{when(e.at)} · {e.by}{e.note ? ` · “${e.note}”` : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Link href={`/requests/${d.id}`} className="inline-block text-xs font-semibold text-primary underline underline-offset-2">Open the full ticket page ▸</Link>
    </>
  )
}
