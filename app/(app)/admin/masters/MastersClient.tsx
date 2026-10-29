'use client'

import { useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, XCircle, Link2, Unplug } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { saveMasterSource, saveMasterTemplate, resetMasterTemplate, disconnectGoogleSheets, updateMastersNow } from '@/lib/actions/admin/masters'
import { MASTER_SYNC_TIMES, nextMasterSyncLabel } from '@/lib/masters/schedule'
import { MASTER_PLACEHOLDERS, MASTER_SAMPLE_VALUES, DEFAULT_MASTER_BODY } from '@/lib/masters/mail-constants'

const RichEmailEditor = dynamic(() => import('@/components/admin/RichEmailEditor'), {
  ssr: false,
  loading: () => <div className="min-h-[300px] rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">Loading editor…</div>,
})

export type SourceView = {
  kind: 'ac' | 'genset' | 'cvm' | 'pms'
  spreadsheet_id: string
  tab_name: string | null
  last_checked_at: string | null
  last_applied_at: string | null
  last_status: 'ok' | 'error' | null
  last_error: string | null
  row_count: number | null
}
export type IssueView = { kind: 'ac' | 'genset' | 'cvm' | 'pms'; severity: 'error' | 'warning'; code: string; store_code: string | null; sheet_row: number | null; message: string }
export type TemplateView = { kind: 'ac' | 'genset'; subject: string; body: string; custom: boolean }
export type CountsView = { acActive: number; acInactive: number; acRemoved: number; gensetActive: number; gensetRemoved: number; cvmStores: number }
/** The latest AC PMS tickets (or reasons why none was made) and how many PMS dates are still to come in the sheet. */
export type PmsView = { upcoming: number; log: { store_code: string; pms_date: string; status: 'creating' | 'created' | 'skipped' | 'failed'; note: string | null; request_no: string | null }[] }
type Connection = { account_email: string | null; status: 'connected' | 'broken'; last_error: string | null; connected_at: string } | null

export const SHEETS: { kind: 'ac' | 'genset' | 'cvm' | 'pms'; title: string; hint: string }[] = [
  { kind: 'ac', title: 'AC DETAILS MASTER SHEET-ADMIN', hint: 'One row per AC. Gives the AC choices in the ticket form, the OEM e-mail addresses, and the store address and opening date.' },
  { kind: 'genset', title: 'GENSET Detail MASTER SHEET-ADMIN', hint: 'One row per genset. Gives the OEM e-mail addresses for genset tickets.' },
  { kind: 'cvm', title: 'CVM Detail MASTER SHEET-ADMIN (for Approval)', hint: 'One row per store with its CVM e-mail. The approval goes to that person.' },
  { kind: 'pms', title: 'AC PMS MASTER SHEET', hint: 'One row per store and PMS date (columns Store Code and AC PMS Date). On that date, from 09:00, one AC PMS ticket is made for the store, in the AC PMS service and category.' },
]

const GOOGLE_MESSAGE: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Google Sheets is connected. Press "Update from sheets now" to copy them straight away; after that it happens at 11:00, 15:00 and 19:00.' },
  exchangefailed: { ok: false, text: 'Google did not give access. Try again and press Allow.' },
  vaultfailed: { ok: false, text: 'The connection could not be saved safely. Try again.' },
  savefailed: { ok: false, text: 'The connection could not be saved. Try again.' },
  unconfigured: { ok: false, text: 'The Google sign-in is not set up on the server yet.' },
  forbidden: { ok: false, text: 'Only an administrator can connect Google Sheets.' },
}

export function ago(iso: string | null): string {
  if (!iso) return 'not yet'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return formatDateTime(iso)
}

export function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export function SourceCard({ source, spec, issueCount }: { source: SourceView | undefined; spec: (typeof SHEETS)[number]; issueCount: { errors: number; warnings: number } }) {
  const [link, setLink] = useState(source ? `https://docs.google.com/spreadsheets/d/${source.spreadsheet_id}/edit` : '')
  const [tab, setTab] = useState(source?.tab_name ?? '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const state = !source ? 'none' : source.last_status === 'error' ? 'error' : source.last_status === 'ok' ? 'ok' : 'waiting'
  return (
    <Card
      title={spec.title}
      right={
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
          state === 'ok' && 'bg-emerald-50 text-emerald-700', state === 'error' && 'bg-red-50 text-red-700', state === 'waiting' && 'bg-amber-50 text-amber-700', state === 'none' && 'bg-muted text-muted-foreground')}>
          {state === 'ok' && <CheckCircle2 className="h-3 w-3" />}
          {state === 'error' && <XCircle className="h-3 w-3" />}
          {state === 'waiting' && <AlertTriangle className="h-3 w-3" />}
          {state === 'ok' ? 'Reading fine' : state === 'error' ? 'Cannot read' : state === 'waiting' ? 'Waiting for first check' : 'Not set'}
        </span>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">{spec.hint}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <input id={`sheet-link-${spec.kind}`} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the Google Sheet address" className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <input id={`sheet-tab-${spec.kind}`} value={tab} onChange={(e) => setTab(e.target.value)} placeholder="Tab name (optional)" className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <button
          type="button"
          disabled={pending || !link.trim()}
          onClick={() => start(async () => { const r = await saveMasterSource(spec.kind, link, tab); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved. It is copied at the next update (or press "Update from sheets now" at the top).' }) })}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {msg && <p className={cn('mt-2 text-xs', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</p>}
      {source && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
          <div><dt>Last checked</dt><dd className="text-foreground">{ago(source.last_checked_at)}</dd></div>
          <div><dt>Last updated in CK Desk</dt><dd className="text-foreground">{ago(source.last_applied_at)}</dd></div>
          <div><dt>Rows read</dt><dd className="text-foreground">{source.row_count ?? '-'}</dd></div>
          <div><dt>Problems found</dt><dd className="text-foreground">{issueCount.errors} to fix, {issueCount.warnings} to look at</dd></div>
        </dl>
      )}
      {source?.last_status === 'error' && source.last_error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {source.last_error} CK Desk keeps working with the last good copy.
        </p>
      )}
    </Card>
  )
}

export function TemplateCard({ t }: { t: TemplateView }) {
  const [subject, setSubject] = useState(t.subject)
  const [body, setBody] = useState(t.body)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const label = t.kind === 'ac' ? 'AC' : t.kind === 'genset' ? 'Genset' : 'Send an engineer again'
  return (
    <Card title={`${label} OEM e-mail`} right={t.custom ? <span className="text-[11px] text-muted-foreground">Your own wording</span> : <span className="text-[11px] text-muted-foreground">Standard wording</span>}>
      <p className="mb-3 text-xs text-muted-foreground">
        One e-mail goes to every address the sheet lists for the store. OEM addresses are in To, company addresses (@citykartstores.com, @citykart.org) are copied in CC.
        Click a detail below the box to put it into the message.
      </p>
      <label htmlFor={`tpl-subject-${t.kind}`} className="mb-1 block text-xs font-medium text-foreground">Subject</label>
      <input id={`tpl-subject-${t.kind}`} value={subject} onChange={(e) => setSubject(e.target.value)} className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
      <RichEmailEditor
        label="Message"
        value={body}
        onChange={setBody}
        placeholders={MASTER_PLACEHOLDERS[t.kind]}
        sampleValues={MASTER_SAMPLE_VALUES[t.kind]}
        starterHtml={DEFAULT_MASTER_BODY[t.kind]}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => start(async () => { const r = await saveMasterTemplate(t.kind, subject, body); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          Save {label} e-mail
        </button>
        {t.custom && (
          <button type="button" disabled={pending} onClick={() => start(async () => { const r = await resetMasterTemplate(t.kind); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Back to the standard wording. Reload the page to see it.' }) })} className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground">
            Use the standard wording
          </button>
        )}
        {msg && <span className={cn('text-xs', msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</span>}
      </div>
    </Card>
  )
}

export function MastersClient({ googleResult, connection, sources, issues, counts, pms = { upcoming: 0, log: [] } }: {
  googleResult: string | null
  connection: Connection
  sources: SourceView[]
  issues: IssueView[]
  counts: CountsView
  pms?: PmsView
}) {
  const [pending, start] = useTransition()
  const [updateMsg, setUpdateMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [filter, setFilter] = useState<'all' | 'ac' | 'genset' | 'cvm' | 'pms'>('all')
  const flash = googleResult ? GOOGLE_MESSAGE[googleResult] : null
  const connected = connection?.status === 'connected'
  const issueCount = (kind: string) => ({
    errors: issues.filter((i) => i.kind === kind && i.severity === 'error').length,
    warnings: issues.filter((i) => i.kind === kind && i.severity === 'warning').length,
  })
  const shown = issues.filter((i) => filter === 'all' || i.kind === filter)

  return (
    <div className="space-y-4">
      {flash && <p className={cn('rounded-lg px-3 py-2 text-sm', flash.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{flash.text}</p>}

      <Card title="Google connection">
        {connection ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-foreground">
                {connected ? 'Connected as' : 'Connection lost for'} <b>{connection.account_email ?? 'the Google account'}</b>
                {connected ? ' (view only).' : '.'}
              </p>
              {!connected && <p className="mt-1 text-xs text-red-600">{connection.last_error ?? 'Google no longer accepts the saved connection.'} Connect again.</p>}
            </div>
            <div className="flex gap-2">
              <a href="/api/masters/oauth/start" className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Link2 className="h-3.5 w-3.5" />{connected ? 'Use another Google account' : 'Connect again'}</a>
              <button type="button" disabled={pending} onClick={() => start(async () => { await disconnectGoogleSheets(); window.location.reload() })} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground"><Unplug className="h-3.5 w-3.5" />Disconnect</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-muted-foreground">
              Sign in with <b className="text-foreground">citykartdesk@citykartstores.com</b> (the account the three sheets are shared with) and press Allow. CK Desk only gets permission to <b className="text-foreground">view</b> spreadsheets.
            </p>
            <a href="/api/masters/oauth/start" className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Link2 className="h-3.5 w-3.5" />Connect Google Sheets</a>
          </div>
        )}
      </Card>

      <Card
        title="Updates from the sheets"
        right={
          <button
            type="button"
            disabled={pending || !connected}
            onClick={() => start(async () => { setUpdateMsg(null); const r = await updateMastersNow(); setUpdateMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.summary ?? 'Updated.' }); if (!r.error) window.location.reload() })}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
          >
            {pending ? 'Updating...' : 'Update from sheets now'}
          </button>
        }
      >
        <p className="text-sm text-muted-foreground">
          The sheets are copied into the CK Desk database at <b className="text-foreground">{MASTER_SYNC_TIMES.join(', ')}</b> every day. The ticket form, the OEM e-mails, the approvals and the reports all use that copy, so a change made in a sheet shows in CK Desk at the next update (next: <b className="text-foreground">{nextMasterSyncLabel()}</b>).
        </p>
        {updateMsg && <p className={cn('mt-2 text-xs', updateMsg.ok ? 'text-emerald-700' : 'text-red-600')}>{updateMsg.text}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Active ACs', counts.acActive], ['Inactive ACs', counts.acInactive], ['Gensets', counts.gensetActive], ['Stores with a CVM', counts.cvmStores], ['Removed from sheets', counts.acRemoved + counts.gensetRemoved],
        ].map(([label, n]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-card px-3 py-2">
            <div className="text-lg font-semibold text-foreground">{n}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <Card title="AC and Genset">
        <p className="text-sm text-muted-foreground">
          The AC and Genset sheets, their categories and their OEM e-mail wording are set up in <Link href="/admin/programs" className="font-medium text-primary underline">Admin &gt; Vendor Programs</Link>, together with every other vendor line.
          This page keeps the Google connection, the update button, the CVM and AC PMS sheets, and the health list of all sheets.
        </p>
      </Card>

      {SHEETS.filter((s) => s.kind === 'cvm' || s.kind === 'pms').map((s) => <SourceCard key={s.kind} source={sources.find((x) => x.kind === s.kind)} spec={s} issueCount={issueCount(s.kind)} />)}

      {sources.some((x) => x.kind === 'pms') && (
        <Card title={`AC PMS tickets (${pms.upcoming} PMS date${pms.upcoming === 1 ? '' : 's'} still to come in the sheet)`}>
          {pms.log.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PMS ticket has been made yet. Tickets are made from 09:00 on the PMS date of each store.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {pms.log.map((l) => (
                <li key={`${l.store_code}-${l.pms_date}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-foreground">{l.store_code} - {l.pms_date}</span>
                  <span className={cn('text-xs', l.status === 'created' ? 'text-emerald-700' : l.status === 'creating' ? 'text-amber-700' : 'text-red-600')}>
                    {l.status === 'created' ? `Ticket ${l.request_no ?? 'made'}` : l.status === 'creating' ? 'Being made' : (l.note ?? 'No ticket made')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card
        title={`Master data health (${issues.length})`}
        right={
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1 text-muted-foreground">Checked {ago(sources.reduce<string | null>((m, s) => (s.last_checked_at && (!m || s.last_checked_at > m) ? s.last_checked_at : m), null))}</span>
            {(['all', 'ac', 'genset', 'cvm', 'pms'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-full border px-2.5 py-0.5', filter === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                {k === 'all' ? 'All' : k === 'ac' ? 'AC' : k === 'genset' ? 'Genset' : k === 'pms' ? 'AC PMS' : 'CVM'}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No problems found in the sheets.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {shown.map((i, n) => (
              <li key={n} className="flex items-start gap-2 py-2">
                {i.severity === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <div className="min-w-0">
                  <p className="text-foreground">{i.message}</p>
                  <p className="text-[11px] text-muted-foreground">{i.kind.toUpperCase()} sheet{i.store_code ? ` - store ${i.store_code}` : ''}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
