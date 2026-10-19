'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { savePartsPo, voidVisitReport, saveVisitSettings, lookupVisitCode } from '@/lib/actions/visits'
import { OUTCOME_LABEL, REASON_LABEL, PO_STATUS_LABEL, type VisitOutcome, type NotResolvedReason, type PoStatus } from '@/lib/visits/constants'

export type ReportRow = {
  id: string; reportId: string; storeCode: string; ckdeskNo: string; acDetails: string | null; tickets: string[]; engineerName: string; engineerMobile: string; visitDate: string; submittedAt: string
  isVoid: boolean; engineerStatus: string; reason: string | null; parts: { name: string; qty: number }[]; engineerRemarks: string | null; fsr: { attachmentId: string; fileName: string }[]
  storeStatus: string | null; storeRemarks: string | null; outcome: string; autoResolveAt: string | null
}
export type PartsRow = {
  id: string; storeCode: string; ckdeskNo: string; acDetails: string | null; tickets: string[]; engineerName: string; visitDate: string; parts: { name: string; qty: number }[]
  oemPartsNote: string | null; poNumber: string | null; poDate: string | null; poVendor: string | null; poStatus: string
}

type Tab = 'reports' | 'parts' | 'settings'
const shortDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function ReportCard({ r }: { r: ReportRow }) {
  const [why, setWhy] = useState('')
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{r.storeCode} - AC {r.ckdeskNo}</span>
        <span className="text-xs text-muted-foreground">{r.tickets.join(', ')}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', r.engineerStatus === 'resolved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>Engineer: {r.engineerStatus === 'resolved' ? 'Resolved' : 'Not resolved'}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">{OUTCOME_LABEL[r.outcome as VisitOutcome] ?? r.outcome}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Engineer {r.engineerName} ({r.engineerMobile}), visit {r.visitDate}, reported {shortDate(r.submittedAt)}.
        {r.reason ? ` ${REASON_LABEL[r.reason as NotResolvedReason] ?? r.reason}.` : ''}
        {r.parts.length ? ` Parts: ${r.parts.map((p) => `${p.name} x ${p.qty}`).join(', ')}.` : ''}
        {r.engineerRemarks ? ` Remarks: ${r.engineerRemarks}` : ''}
      </p>
      {r.storeStatus && <p className="text-xs text-foreground">Store says: <b>{r.storeStatus === 'resolved' ? 'Resolved' : 'Not resolved'}</b>{r.storeRemarks ? ` - ${r.storeRemarks}` : ''}</p>}
      {r.outcome === 'pending_store' && r.autoResolveAt && <p className="text-xs text-amber-700">Resolves automatically at {shortDate(r.autoResolveAt)} if the store does not answer.</p>}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
        {r.fsr.map((f) => <a key={f.attachmentId} href={`/api/storage/attachment/request/${f.attachmentId}`} target="_blank" rel="noreferrer" className="text-primary underline">{f.fileName}</a>)}
        {!r.isVoid && r.outcome !== 'void' && <button type="button" onClick={() => setOpen((v) => !v)} className="text-muted-foreground underline">Mark this report wrong</button>}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input id={`void-${r.id}`} aria-label="Why is it wrong" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is it wrong?" className="min-w-[16rem] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          <button type="button" disabled={pending} onClick={() => start(async () => { const x = await voidVisitReport(r.reportId, why); setMsg(x.error ?? x.message ?? ''); if (!x.error) setTimeout(() => window.location.reload(), 900) })} className="rounded-lg border border-border px-3 py-1.5 text-sm">Mark wrong</button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      )}
    </li>
  )
}

function PartsCard({ p }: { p: PartsRow }) {
  const [note, setNote] = useState(p.oemPartsNote ?? '')
  const [po, setPo] = useState(p.poNumber ?? '')
  const [date, setDate] = useState(p.poDate ?? '')
  const [vendor, setVendor] = useState(p.poVendor ?? '')
  const [status, setStatus] = useState(p.poStatus)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-foreground">{p.storeCode} - AC {p.ckdeskNo}</span>
        <span className="text-xs text-muted-foreground">{p.tickets.join(', ')}</span>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{PO_STATUS_LABEL[p.poStatus as PoStatus] ?? p.poStatus}</span>
      </div>
      <p className="text-xs text-foreground"><b>Parts the engineer {p.engineerName} listed on {p.visitDate}:</b> {p.parts.map((x) => `${x.name} x ${x.qty}`).join(', ')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground">The OEM&apos;s own parts list (from their e-mail; use this if the handwriting was unclear)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1500} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted-foreground">PO number<input value={po} onChange={(e) => setPo(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground" /></label>
          <label className="block text-xs text-muted-foreground">PO date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground" /></label>
          <label className="block text-xs text-muted-foreground">Vendor (OEM)<input value={vendor} onChange={(e) => setVendor(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground" /></label>
          <label className="block text-xs text-muted-foreground">Progress
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground">
              {(Object.keys(PO_STATUS_LABEL) as PoStatus[]).map((k) => <option key={k} value={k}>{PO_STATUS_LABEL[k]}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => start(async () => { const x = await savePartsPo(p.id, { oemPartsNote: note, poNumber: po, poDate: date, poVendor: vendor, poStatus: status }); setMsg(x.error ? { ok: false, text: x.error } : { ok: true, text: x.message ?? 'Saved.' }) })} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Save</button>
        {msg && <span className={cn('text-xs', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</span>}
      </div>
    </li>
  )
}

export function VisitsClient({ reports, parts, settings, isAdmin }: { reports: ReportRow[]; parts: PartsRow[]; settings: { autoResolveHours: number; reminderHours: number }; isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>('reports')
  const [filter, setFilter] = useState<'all' | 'waiting' | 'disputed' | 'resolved'>('all')
  const [auto, setAuto] = useState(String(settings.autoResolveHours))
  const [rem, setRem] = useState(String(settings.reminderHours))
  const [settingsMsg, setSettingsMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [storeCode, setStoreCode] = useState('')
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const shown = reports.filter((r) => filter === 'all' || (filter === 'waiting' && r.outcome === 'pending_store') || (filter === 'disputed' && r.outcome === 'disputed') || (filter === 'resolved' && r.outcome.startsWith('resolved')))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 text-sm" role="tablist">
        {([['reports', `Visit reports (${reports.length})`], ['parts', `Parts to order (${parts.length})`], ['settings', 'Visit code and settings']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={cn('rounded-lg border px-3 py-1.5', tab === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{label}</button>
        ))}
      </div>

      {tab === 'reports' && (
        <>
          <div className="flex flex-wrap gap-1 text-xs">
            {([['all', 'All'], ['waiting', 'Waiting for the store'], ['disputed', 'Store disagrees'], ['resolved', 'Resolved']] as ['all' | 'waiting' | 'disputed' | 'resolved', string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-full border px-2.5 py-0.5', filter === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{label}</button>
            ))}
          </div>
          {shown.length === 0 ? <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No visit reports here.</p>
            : <ul className="divide-y divide-border rounded-xl border border-border bg-card">{shown.map((r) => <ReportCard key={r.id} r={r} />)}</ul>}
        </>
      )}

      {tab === 'parts' && (
        parts.length === 0 ? <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No parts are waiting for a PO.</p>
          : <ul className="divide-y divide-border rounded-xl border border-border bg-card">{parts.map((p) => <PartsCard key={p.id} p={p} />)}</ul>
      )}

      {tab === 'settings' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Today&apos;s visit code of a store</h2>
            <p className="mb-2 text-xs text-muted-foreground">The store sees its code on its own AC visits page. Use this if the store cannot be reached when the engineer is there.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Store code" value={storeCode} onChange={(e) => setStoreCode(e.target.value)} placeholder="Store code" className="w-40 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
              <button type="button" disabled={pending || !storeCode.trim()} onClick={() => start(async () => { const x = await lookupVisitCode(storeCode); setCodeMsg(x.error ? { ok: false, text: x.error } : { ok: true, text: x.code ?? '' }) })} className="rounded-lg border border-border px-3 py-1.5 text-sm">Show code</button>
              {codeMsg && <span className={cn('font-mono text-lg tracking-widest', codeMsg.ok ? 'text-foreground' : 'text-xs text-red-600')}>{codeMsg.text}</span>}
            </div>
          </section>
          {isAdmin && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Hours</h2>
              <p className="mb-2 text-xs text-muted-foreground">When an engineer reports an AC resolved and the store does not answer, the tickets are resolved automatically after the first number of hours. The store is reminded after the second.</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-muted-foreground">Resolve automatically after (hours)<input value={auto} onChange={(e) => setAuto(e.target.value)} className="mt-1 block w-32 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground" /></label>
                <label className="text-xs text-muted-foreground">Remind the store after (hours)<input value={rem} onChange={(e) => setRem(e.target.value)} className="mt-1 block w-32 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground" /></label>
                <button type="button" disabled={pending} onClick={() => start(async () => { const x = await saveVisitSettings(Number(auto), Number(rem)); setSettingsMsg(x.error ? { ok: false, text: x.error } : { ok: true, text: x.message ?? 'Saved.' }) })} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Save</button>
                {settingsMsg && <span className={cn('text-xs', settingsMsg.ok ? 'text-emerald-700' : 'text-red-600')}>{settingsMsg.text}</span>}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
