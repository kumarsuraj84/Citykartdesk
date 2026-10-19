'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Clock, KeyRound, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { confirmVisit } from '@/lib/actions/visits'
import { OUTCOME_LABEL, REASON_LABEL, PO_STATUS_LABEL, type VisitOutcome, type NotResolvedReason, type PoStatus } from '@/lib/visits/constants'

export type VisitCard = {
  id: string; ckdeskNo: string; acDetails: string | null; engineerName: string; engineerMobile: string; visitDate: string
  engineerStatus: 'resolved' | 'not_resolved'; reason: string | null; parts: { name: string; qty: number }[]; engineerRemarks: string | null
  fsr: { attachmentId: string; fileName: string }[]; autoResolveAt: string | null; outcome: string; poStatus: string | null; poNumber: string | null; ticketCount: number
}
export type WaitingAc = { ckdeskNo: string; details: string; tickets: { requestNo: string; title: string; loggedOn: string }[] }
export type DoneCard = { id: string; ckdeskNo: string; outcome: string; engineerName: string; visitDate: string; storeRemarks: string | null; decidedOn: string }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

function Card({ v, autoResolveHours }: { v: VisitCard; autoResolveHours: number }) {
  const [decision, setDecision] = useState<'resolved' | 'not_resolved' | ''>('')
  const [remarks, setRemarks] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const resolvedByEngineer = v.engineerStatus === 'resolved'
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={`AC ${v.ckdeskNo}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">AC {v.ckdeskNo}{v.acDetails ? <span className="font-normal text-muted-foreground"> - {v.acDetails}</span> : null}</h2>
          <p className="text-xs text-muted-foreground">{v.ticketCount > 1 ? `${v.ticketCount} tickets for this AC are` : '1 ticket for this AC is'} covered by the answer below.</p>
        </div>
        <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium', resolvedByEngineer ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
          Engineer says: {resolvedByEngineer ? 'Resolved' : 'Not resolved'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Engineer</dt><dd className="text-foreground">{v.engineerName}</dd></div>
        <div><dt className="text-muted-foreground">Mobile</dt><dd className="text-foreground">{v.engineerMobile}</dd></div>
        <div><dt className="text-muted-foreground">Visit date</dt><dd className="text-foreground">{v.visitDate}</dd></div>
        <div><dt className="text-muted-foreground">FSR photos</dt><dd className="flex flex-wrap gap-2">
          {v.fsr.length === 0 ? <span className="text-foreground">-</span> : v.fsr.map((f) => (
            <a key={f.attachmentId} href={`/api/storage/attachment/request/${f.attachmentId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline"><Paperclip className="h-3 w-3" />{f.fileName}</a>
          ))}
        </dd></div>
      </dl>
      {!resolvedByEngineer && v.reason && <p className="mt-2 text-xs text-foreground"><b>Reason:</b> {REASON_LABEL[v.reason as NotResolvedReason] ?? v.reason}</p>}
      {v.parts.length > 0 && <p className="mt-1 text-xs text-foreground"><b>Parts the engineer listed:</b> {v.parts.map((p) => `${p.name} x ${p.qty}`).join(', ')}</p>}
      {v.poStatus && <p className="mt-1 text-xs text-foreground"><b>PO:</b> {PO_STATUS_LABEL[v.poStatus as PoStatus] ?? v.poStatus}{v.poNumber ? ` (${v.poNumber})` : ''}</p>}
      {v.engineerRemarks && <p className="mt-1 text-xs text-foreground"><b>Engineer&apos;s remarks:</b> {v.engineerRemarks}</p>}

      {resolvedByEngineer && v.autoResolveAt && (
        <p className="mt-2 flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800"><Clock className="h-3.5 w-3.5" />
          Please answer by {when(v.autoResolveAt)}. If there is no answer within {autoResolveHours} hours of the report, the ticket is resolved automatically.
        </p>
      )}

      <fieldset className="mt-3 space-y-2">
        <legend className="text-xs font-medium text-foreground">Is the issue of this AC resolved?</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" name={`d-${v.id}`} checked={decision === 'resolved'} onChange={() => setDecision('resolved')} /> Yes, resolved</label>
          <label className="flex items-center gap-1.5"><input type="radio" name={`d-${v.id}`} checked={decision === 'not_resolved'} onChange={() => setDecision('not_resolved')} /> No, not resolved</label>
        </div>
        <label htmlFor={`rem-${v.id}`} className="block text-xs text-muted-foreground">Remarks {decision === 'not_resolved' ? '(required: what is still wrong)' : '(optional)'}</label>
        <textarea id={`rem-${v.id}`} value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} maxLength={500} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        {decision === 'not_resolved' && resolvedByEngineer && <p className="text-[11px] text-muted-foreground">The OEM will be e-mailed that its engineer said resolved but you say it is not, and asked to send an engineer again.</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending || !decision}
            onClick={() => start(async () => { const r = await confirmVisit(v.id, decision, remarks); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' }); if (!r.error) setTimeout(() => window.location.reload(), 1200) })}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Saving...' : 'Submit my answer'}
          </button>
          {msg && <span className={cn('text-xs', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</span>}
        </div>
      </fieldset>
    </section>
  )
}

export function AcVisitsClient({ storeCode, visitCode, autoResolveHours, actionable, waiting, done }: {
  storeCode: string; visitCode: string | null; autoResolveHours: number; actionable: VisitCard[]; waiting: WaitingAc[]; done: DoneCard[]
}) {
  return (
    <div className="space-y-4">
      {visitCode && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <KeyRound className="h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Today&apos;s visit code for the OEM engineer</p>
            <p className="text-xs text-muted-foreground">Give this code to the engineer when he arrives. He needs it, with the store code <b className="text-foreground">{storeCode}</b>, to report his visit. It changes every day.</p>
          </div>
          <span className="rounded-lg bg-muted px-4 py-2 font-mono text-xl font-semibold tracking-widest text-foreground" aria-label="Visit code">{visitCode}</span>
        </section>
      )}

      <h2 className="text-sm font-semibold text-foreground">Waiting for your answer ({actionable.length})</h2>
      {actionable.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No engineer report is waiting for your answer.</p>
      ) : actionable.map((v) => <Card key={v.id} v={v} autoResolveHours={autoResolveHours} />)}

      {waiting.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-semibold text-foreground">Waiting for the OEM engineer&apos;s visit report ({waiting.length})</h2>
          <p className="text-xs text-muted-foreground">There is nothing for you to confirm yet. When the engineer reports his visit, the AC appears above.</p>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {waiting.map((w) => (
              <li key={w.ckdeskNo} className="px-4 py-2.5">
                <p className="font-medium text-foreground">AC {w.ckdeskNo}{w.details ? <span className="font-normal text-muted-foreground"> - {w.details}</span> : null}</p>
                <p className="text-xs text-muted-foreground">{w.tickets.map((t) => `${t.requestNo} (${t.title}, logged ${t.loggedOn})`).join('; ')}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {done.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-semibold text-foreground">Recent answers</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {done.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <CheckCircle2 className={cn('h-4 w-4', d.outcome.startsWith('resolved') ? 'text-emerald-600' : 'text-amber-600')} />
                <span className="font-medium text-foreground">AC {d.ckdeskNo}</span>
                <span className="text-muted-foreground">{OUTCOME_LABEL[d.outcome as VisitOutcome] ?? d.outcome}</span>
                <span className="text-xs text-muted-foreground">Engineer {d.engineerName}, visit {d.visitDate}{d.storeRemarks ? ` - your remarks: ${d.storeRemarks}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
