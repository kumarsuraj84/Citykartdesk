'use client'

import { Fragment, useCallback, useEffect, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, ClipboardCopy, Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  buildErrorBundle, exportSystemLog, listErrorGroups, listSystemLog, verifyLogIntegrity,
  type IntegrityResult, type SystemLogEntry, type SystemLogFilters,
} from '@/lib/actions/admin/system-log'
import type { ErrorGroup } from '@/lib/syslog/bundle'

const CATEGORY_STYLES: Record<string, string> = {
  audit: 'bg-blue-50 text-blue-700 border-blue-200',
  security: 'bg-purple-50 text-purple-700 border-purple-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  event: 'bg-slate-50 text-slate-600 border-slate-200',
}
const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-slate-50 text-slate-600 border-slate-200',
  debug: 'bg-slate-50 text-slate-500 border-slate-200',
}
const SOURCE_LABELS: Record<string, string> = {
  browser: 'Browser', app_server: 'App server', server_action: 'Server action', api_route: 'API route', cron: 'Scheduled job', database: 'Database',
  storage: 'Storage', auth: 'Sign-in service', integration: 'Outside service', admin: 'Admin screen', process: 'Process', shipper: 'Log shipper',
}

const inputCls = 'rounded-lg border border-[#E2E8F4] bg-white py-1.5 px-2 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#1B2559]/20'
const btnCls = 'flex items-center gap-1.5 rounded-lg border border-[#E2E8F4] bg-white px-3 py-1.5 text-[13px] text-[#1A1F36] hover:bg-muted disabled:opacity-60'

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{text}</span>
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#F8FAFD] p-2 text-[11px]">{JSON.stringify(value, null, 1)}</pre>
}

function Details({ r }: { r: SystemLogEntry }) {
  const rows: [string, React.ReactNode][] = [
    ['Time', new Date(r.created_at).toLocaleString()],
    ['Actor', r.actor_name || r.actor_role ? `${r.actor_name || '—'}${r.actor_role ? ` (${r.actor_role})` : ''}` : '—'],
    ['Entity', [r.entity_type, r.entity_label, r.entity_id].filter(Boolean).join(' · ') || '—'],
    ['Error code', r.error_code ?? '—'],
    ['Page / request', [r.method, r.path].filter(Boolean).join(' ') || '—'],
    ['Request id', r.request_id ? <button key="rid" type="button" className="font-mono text-[11px] underline" data-request-id={r.request_id}>{r.request_id}</button> : '—'],
    ['After a click', r.from_click ? `Yes — ${r.click_target ?? ''}` : r.from_click === false ? 'No' : '—'],
    ['Address / browser', [r.ip, r.user_agent].filter(Boolean).join(' · ') || '—'],
    ['Integrity hash', r.row_hash ? <span key="h" className="font-mono text-[10px]">{r.row_hash}</span> : 'not chained'],
  ]
  return (
    <div className="grid gap-3 px-3 py-3 md:grid-cols-2">
      <dl className="space-y-1 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
        ))}
        {r.message && <div className="pt-1"><dt className="text-muted-foreground">Message</dt><dd className="break-words">{r.message}</dd></div>}
      </dl>
      <div className="space-y-2 text-[12px]">
        {(r.before_data !== null || r.after_data !== null) && (
          <div className="grid grid-cols-2 gap-2">
            <div><p className="mb-1 font-semibold">Before</p><Json value={r.before_data} /></div>
            <div><p className="mb-1 font-semibold">After</p><Json value={r.after_data} /></div>
          </div>
        )}
        {r.stack && <div><p className="mb-1 font-semibold">Stack</p><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#F8FAFD] p-2 text-[11px]">{r.stack}</pre></div>}
        {r.detail !== null && r.detail !== undefined && <div><p className="mb-1 font-semibold">Detail</p><Json value={r.detail} /></div>}
      </div>
    </div>
  )
}

export function SystemLogClient({ users }: { users: { id: string; full_name: string }[] }) {
  const [tab, setTab] = useState<'log' | 'groups'>('log')
  const [days, setDays] = useState(7)
  const [category, setCategory] = useState('')
  const [source, setSource] = useState('')
  const [minSeverity, setMinSeverity] = useState('')
  const [outcome, setOutcome] = useState('')
  const [userId, setUserId] = useState('')
  const [click, setClick] = useState('')
  const [q, setQ] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<SystemLogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [groups, setGroups] = useState<ErrorGroup[]>([])
  const [scanned, setScanned] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bundle, setBundle] = useState<string | null>(null)
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null)
  const [loading, startLoad] = useTransition()
  const [busy, startBusy] = useTransition()
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const filters = useCallback((): SystemLogFilters => ({
    days, category: category || undefined, source: source || undefined, minSeverity: minSeverity || undefined, outcome: outcome || undefined,
    userId: userId || undefined, click: click || undefined, q, fingerprint: fingerprint || undefined,
  }), [days, category, source, minSeverity, outcome, userId, click, q, fingerprint])

  const load = useCallback(() => {
    startLoad(async () => {
      if (tab === 'log') {
        const res = await listSystemLog(filters(), page)
        setRows(res.rows); setHasMore(res.hasMore); setError(res.error ?? null)
      } else {
        const res = await listErrorGroups(filters())
        setGroups(res.groups); setScanned(res.scanned); setError(res.error ?? null)
      }
      setUpdatedAt(new Date())
    })
  }, [tab, filters, page])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, 10_000)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  function download(format: 'csv' | 'json') {
    startBusy(async () => {
      try {
        const text = await exportSystemLog(filters(), format)
        const blob = new Blob([text], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `system-log-last-${days}-days-${new Date().toISOString().slice(0, 10)}.${format}`; a.click()
        URL.revokeObjectURL(url)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Export failed.')
      }
    })
  }

  function copyBundle() {
    startBusy(async () => {
      setNotice(null)
      const res = await buildErrorBundle({ ...filters(), category: category || undefined })
      if (res.error || !res.text) { setError(res.error ?? 'Nothing to copy.'); return }
      try {
        await navigator.clipboard.writeText(res.text)
        setNotice('Copied. Paste it into the conversation — personal data and secrets have been removed.')
        setBundle(null)
      } catch {
        setBundle(res.text)          // clipboard blocked (plain HTTP): show it to copy by hand
        setNotice('Your browser blocked the clipboard. Select the text below and copy it.')
      }
    })
  }

  function verify() {
    startBusy(async () => { setIntegrity(null); setIntegrity(await verifyLogIntegrity()) })
  }

  // changing any filter goes back to the first page and closes an open row
  const upd = (fn: () => void) => { fn(); setPage(0); setOpen(null) }
  const showGroup = (g: ErrorGroup) => upd(() => { setFingerprint(g.fingerprint); setCategory(''); setTab('log') })

  return (
    <section className="space-y-3">
      <div className="flex gap-1 border-b border-[#E2E8F4]" role="tablist">
        {([['log', 'Log'], ['groups', 'Grouped errors']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => upd(() => setTab(k))}
            className={`px-3 py-2 text-[13px] font-medium ${tab === k ? 'border-b-2 border-[#1B2559] text-[#1B2559]' : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Time range" value={days} onChange={(e) => upd(() => setDays(Number(e.target.value)))} className={inputCls}>
          {[1, 3, 7, 15, 30, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} {d === 1 ? 'day' : 'days'}</option>)}
        </select>
        {tab === 'log' && (
          <select aria-label="Category" value={category} onChange={(e) => upd(() => setCategory(e.target.value))} className={inputCls}>
            <option value="">All categories</option><option value="audit">Audit trail</option><option value="security">Security</option><option value="error">Errors</option><option value="event">Events</option>
          </select>
        )}
        <select aria-label="Source" value={source} onChange={(e) => upd(() => setSource(e.target.value))} className={inputCls}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Severity" value={minSeverity} onChange={(e) => upd(() => setMinSeverity(e.target.value))} className={inputCls}>
          <option value="">Any severity</option><option value="warning">Warnings and above</option><option value="error">Errors and above</option><option value="critical">Critical only</option>
        </select>
        {tab === 'log' && (
          <select aria-label="Outcome" value={outcome} onChange={(e) => upd(() => setOutcome(e.target.value))} className={inputCls}>
            <option value="">Any outcome</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option>
          </select>
        )}
        <select aria-label="User" value={userId} onChange={(e) => upd(() => setUserId(e.target.value))} className={inputCls}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select aria-label="Caused by a click" value={click} onChange={(e) => upd(() => setClick(e.target.value))} className={inputCls}>
          <option value="">Click or not</option><option value="click">After a click</option><option value="no_click">Not after a click</option>
        </select>
        <input type="search" aria-label="Search" placeholder="Search action, message, page, entity…" value={q} onChange={(e) => upd(() => setQ(e.target.value))} className={`${inputCls} min-w-[220px] flex-1 max-w-sm`} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={load} disabled={loading} className={btnCls}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
        <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Auto-refresh
        </label>
        <button type="button" onClick={copyBundle} disabled={busy} className="btn-gradient flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCopy className="h-3.5 w-3.5" />} Copy for Claude
        </button>
        <button type="button" onClick={() => download('csv')} disabled={busy} className={btnCls}><Download className="h-3.5 w-3.5" /> CSV</button>
        <button type="button" onClick={() => download('json')} disabled={busy} className={btnCls}><Download className="h-3.5 w-3.5" /> JSON</button>
        <button type="button" onClick={verify} disabled={busy} className={btnCls}><ShieldCheck className="h-3.5 w-3.5" /> Verify integrity</button>
        {fingerprint && (
          <button type="button" onClick={() => upd(() => setFingerprint(''))} className="rounded-full border border-[#E2E8F4] bg-[#F8FAFD] px-2.5 py-1 text-[12px]">
            Showing one problem only ✕
          </button>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
      {bundle && <textarea readOnly aria-label="Error report to copy" value={bundle} onFocus={(e) => e.currentTarget.select()} className="h-48 w-full rounded-lg border border-[#E2E8F4] bg-white p-2 font-mono text-[11px]" />}
      {integrity && (
        <p role="status" className={`rounded-lg border px-4 py-3 text-sm ${integrity.ok ? 'border-green-100 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {integrity.error
            ? integrity.error
            : integrity.ok
              ? `Integrity verified: ${integrity.checked.toLocaleString()} audit and security records form an unbroken chain.`
              : `The chain is broken at record ${integrity.brokenId} (${integrity.reason}). A record was changed or removed after it was written.`}
        </p>
      )}

      {tab === 'log' ? (
        <>
          <p className="text-xs text-muted-foreground">
            {loading && rows.length === 0 ? 'Loading…' : `Showing ${rows.length} record${rows.length === 1 ? '' : 's'} (page ${page + 1}).`}{updatedAt ? ` Updated ${updatedAt.toLocaleTimeString()}.` : ''}
          </p>
          <div className="overflow-x-auto rounded-xl border border-[#E2E8F4] bg-white">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#E2E8F4] bg-[#F8FAFD] text-[10px] font-bold uppercase tracking-wider text-[#7B8DB0]">
                  <th className="w-6 px-2 py-2.5"><span className="sr-only">Details</span></th>
                  {['Time', 'Category', 'Source', 'Severity', 'Actor', 'Action', 'What', 'Page'].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">No records match.</td></tr>
                ) : rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-[#EEF2F8] align-top hover:bg-[#FAFBFF]">
                      <td className="px-2 py-2">
                        <button type="button" aria-expanded={open === r.id} aria-label={open === r.id ? 'Hide details' : 'Show details'} onClick={() => setOpen(open === r.id ? null : r.id)} className="rounded p-0.5 hover:bg-muted">
                          {open === r.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2"><Badge text={r.category} cls={CATEGORY_STYLES[r.category] ?? ''} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{SOURCE_LABELS[r.source] ?? r.source}</td>
                      <td className="px-3 py-2"><Badge text={r.severity} cls={SEVERITY_STYLES[r.severity] ?? ''} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.actor_name || (r.actor_role ? `(${r.actor_role})` : '—')}</td>
                      <td className="px-3 py-2 font-mono text-[11px] break-all">{r.action}{r.outcome !== 'success' ? <span className="ml-1 text-muted-foreground">· {r.outcome}</span> : null}</td>
                      <td className="px-3 py-2 max-w-[360px] break-words">{r.entity_label || r.message || r.entity_type || '—'}</td>
                      <td className="px-3 py-2 font-mono text-[11px] break-all">{r.path ?? '—'}</td>
                    </tr>
                    {open === r.id && <tr className="border-b border-[#EEF2F8] bg-[#FBFCFF]"><td colSpan={9}><Details r={r} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={btnCls} disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Newer</button>
            <button type="button" className={btnCls} disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>Older</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {loading && groups.length === 0 ? 'Loading…' : `${groups.length} distinct problem${groups.length === 1 ? '' : 's'} found in ${scanned.toLocaleString()} error records.`}{updatedAt ? ` Updated ${updatedAt.toLocaleTimeString()}.` : ''}
          </p>
          <div className="overflow-x-auto rounded-xl border border-[#E2E8F4] bg-white">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#E2E8F4] bg-[#F8FAFD] text-[10px] font-bold uppercase tracking-wider text-[#7B8DB0]">
                  {['Severity', 'Source', 'Times', 'Problem', 'Where', 'Last seen', 'After a click', ''].map((h) => <th key={h || 'x'} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">No errors in this period.</td></tr>
                ) : groups.map((g) => (
                  <tr key={g.fingerprint} className="border-b border-[#EEF2F8] last:border-0 align-top hover:bg-[#FAFBFF]">
                    <td className="px-3 py-2"><Badge text={g.severity} cls={SEVERITY_STYLES[g.severity] ?? ''} /></td>
                    <td className="px-3 py-2 whitespace-nowrap">{SOURCE_LABELS[g.source] ?? g.source}</td>
                    <td className="px-3 py-2 font-semibold">{g.count}</td>
                    <td className="px-3 py-2 max-w-[420px] break-words">{g.message}{g.errorCode ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">({g.errorCode})</span> : null}</td>
                    <td className="px-3 py-2 font-mono text-[11px] break-all">{g.action}{g.paths.length ? ` · ${g.paths.join(', ')}` : ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(g.lastSeen).toLocaleString()}</td>
                    <td className="px-3 py-2">{g.clickCount ? `${g.clickCount} of ${g.count}` : 'No'}</td>
                    <td className="px-3 py-2"><button type="button" className={btnCls} onClick={() => showGroup(g)}>Show records</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
