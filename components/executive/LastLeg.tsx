'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BellRing, Clock, Loader2, Store, Wrench } from 'lucide-react'
import { getExecutiveTicketDetail, nudgeTicket, type ExecTicketDetail } from '@/lib/actions/executiveDashboard'
import { statusLabel, capitalize } from '@/lib/reporting/executive/engine'
import { dateTimeLabel, humanHours } from '@/lib/reporting/executive/labels'
import { buildLifecycle, type StepState } from '@/lib/reporting/executive/lifecycle'

const STEP_BADGE: Record<StepState, string> = {
  completed: 'bg-success text-white',
  breached: 'bg-destructive text-white',
  current: 'bg-primary text-primary-foreground',
  pending: 'bg-muted text-muted-foreground',
}
const STEP_CARD: Record<StepState, string> = {
  completed: 'border-border bg-card',
  breached: 'border-destructive/30 bg-destructive/5',
  current: 'border-primary/40 bg-primary/5',
  pending: 'border-border bg-card',
}
const STEP_DURATION: Record<StepState, string> = { completed: 'text-success', breached: 'text-destructive', current: 'text-foreground', pending: 'text-muted-foreground' }

/** Reminder to the technician handling the ticket (or the group leads when nobody has it). The server checks who may and how often. */
function NudgeBox({ id, who }: { id: string; who: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const send = async () => {
    setBusy(true)
    try {
      const r = await nudgeTicket(id, note)
      if ('error' in r) setResult({ ok: false, text: r.error })
      else { setResult({ ok: true, text: `Reminder sent to ${r.names.join(', ') || 'the technician'}.` }); setOpen(false); setNote('') }
    } catch {
      setResult({ ok: false, text: 'Could not send the reminder. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Needs attention? Send <strong className="text-foreground">{who}</strong> a reminder by bell and email.</p>
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setResult(null) }} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            <BellRing className="h-3.5 w-3.5" />Nudge
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <label htmlFor={`nudge-${id}`} className="font-medium text-foreground">Add a short message (optional)</label>
          <textarea id={`nudge-${id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="e.g. The store has been waiting since morning, please update."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="flex gap-2">
            <button type="button" onClick={send} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Sending…' : 'Send reminder'}</button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {result && <p role={result.ok ? 'status' : 'alert'} className={`mt-2 font-medium ${result.ok ? 'text-success' : 'text-destructive'}`}>{result.text}</p>}
    </div>
  )
}

/** Leg 4: one ticket from the store's request to the sign-off, using its real dates, approval and activity. */
export function LastLeg({ id, now }: { id: string; now: number }) {
  const [state, setState] = useState<{ id: string; detail?: ExecTicketDetail; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    getExecutiveTicketDetail(id)
      .then((r) => { if (alive) setState('error' in r ? { id, error: r.error } : { id, detail: r.detail }) })
      .catch(() => { if (alive) setState({ id, error: 'Could not load this ticket.' }) })
    return () => { alive = false }
  }, [id])

  if (!state || state.id !== id) return <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the ticket…</p>
  if (state.error || !state.detail) return <p className="py-8 text-sm text-destructive">{state.error ?? 'Could not load this ticket.'}</p>
  const d = state.detail
  const life = buildLifecycle(d, now)
  const firstResp = d.responded ? (d.responded - d.created) / 3_600_000 : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-xs">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Store className="h-3.5 w-3.5 text-primary" />Store &amp; origin</p>
          <p className="text-sm font-bold text-foreground">{d.store || d.requester}</p>
          <div className="space-y-0.5 text-muted-foreground">
            {d.storeState && <div>State: <strong className="text-foreground">{d.storeState}</strong></div>}
            <div>Requester: <strong className="text-foreground">{d.requester}</strong>{d.department ? ` · ${d.department}` : ''}</div>
            <div>Raised via: <strong className="text-foreground">{d.source}</strong></div>
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-xs">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Wrench className="h-3.5 w-3.5 text-primary" />Equipment &amp; OEM</p>
          <p className="text-sm font-bold text-foreground">{d.oem || 'Not an equipment (OEM) request'}</p>
          <div className="space-y-0.5 text-muted-foreground">
            {d.service && <div>Service: <strong className="text-foreground">{d.service}</strong></div>}
            <div>Category: <strong className="text-foreground">{[d.category, d.subCategory].filter(Boolean).join(' › ') || '-'}</strong></div>
            <div>Group / technician: <strong className="text-foreground">{d.group} / {d.technician}</strong></div>
          </div>
        </div>
        <div className={`space-y-2 rounded-lg border p-4 text-xs ${life.breached ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5'}`}>
          <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-foreground" />SLA telemetry</span>
            <span className={`font-bold ${life.breached ? 'text-destructive' : 'text-success'}`}>{life.breached ? 'Breached' : 'Within SLA'}</span>
          </p>
          <p className="text-sm font-bold text-foreground">{capitalize(d.priority)} priority · {statusLabel(d.status)}</p>
          <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] tabular-nums">
            <div className="rounded border border-border bg-card/80 p-1.5">
              <span className="block text-muted-foreground">First response{life.responseTargetH !== null ? ` (target ${humanHours(life.responseTargetH)})` : ''}</span>
              <strong className="text-xs text-foreground">{firstResp !== null ? humanHours(firstResp) : 'none yet'}</strong>
            </div>
            <div className="rounded border border-border bg-card/80 p-1.5">
              <span className="block text-muted-foreground">{d.resolved ? 'Resolution' : 'Open for'}{life.resolutionTargetH !== null ? ` (target ${humanHours(life.resolutionTargetH)})` : ''}</span>
              <strong className="text-xs text-foreground">{humanHours(life.takenH)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">End-to-end ticket lifecycle audit</h3>
            <p className="text-xs text-muted-foreground">Store intake, approval or assignment, first response, resolution and store sign-off, with the real dates</p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">Current owner: <strong className="text-foreground">{d.technician}</strong> ({d.group})</span>
        </div>
        <div className="space-y-3">
          {life.steps.map((s) => (
            <div key={s.n} className={`flex items-start gap-3.5 rounded-lg border p-3.5 text-xs ${STEP_CARD[s.state]}`}>
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${STEP_BADGE[s.state]}`}>{s.n}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-foreground">{s.title}</span>
                  <span className="flex items-center gap-2 text-[11px] tabular-nums">
                    <span className="text-muted-foreground">{s.at ? dateTimeLabel(s.at) : 'Not yet'}</span><span aria-hidden>·</span>
                    <span className={`font-semibold ${STEP_DURATION[s.state]}`}>{s.duration}</span>
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">Owner: <strong className="text-foreground">{s.actor}</strong> · Role: {s.role}</div>
                <p className="mt-1 leading-relaxed text-muted-foreground">{s.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {d.events.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-bold text-foreground">Activity log</h3>
          <ol className="ml-2 mt-3 space-y-2.5 border-l-2 border-border pl-4">
            {d.events.map((e, i) => (
              <li key={i} className="relative text-[13px]">
                <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                {e.label}
                <span className="block text-[11.5px] text-muted-foreground">{dateTimeLabel(e.at)} · {e.by}{e.note ? ` · “${e.note}”` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {d.canNudge && <NudgeBox id={d.id} who={d.technician === 'Unassigned' ? `the ${d.group} group leads` : d.technician} />}

      <Link href={`/requests/${d.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline underline-offset-2">Open the full ticket page ▸</Link>
    </div>
  )
}
