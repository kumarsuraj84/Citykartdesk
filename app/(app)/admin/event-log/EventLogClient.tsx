'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { listEvents, exportEventsCsv, type EventRow, type EventFilters } from '@/lib/actions/admin/events'
import { downloadCSV } from '@/lib/export/csv'

const KIND_STYLES: Record<string, string> = {
  pageview: 'bg-slate-50 text-slate-600 border-slate-200',
  click: 'bg-blue-50 text-blue-700 border-blue-200',
  js_error: 'bg-red-50 text-red-700 border-red-200',
  render_error: 'bg-red-50 text-red-700 border-red-200',
  server_error: 'bg-red-50 text-red-700 border-red-200',
  system: 'bg-amber-50 text-amber-700 border-amber-200',
}

const inputCls = 'rounded-lg border border-[#E2E8F4] bg-white py-1.5 px-2 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#1B2559]/20'

export function EventLogClient({ users }: { users: { id: string; full_name: string }[] }) {
  const [days, setDays] = useState(15)
  const [kind, setKind] = useState('')
  const [userId, setUserId] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<EventRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, startLoad] = useTransition()
  const [exporting, startExport] = useTransition()

  const filters = useCallback((): EventFilters => ({ days, kind: kind || undefined, userId: userId || undefined, q }), [days, kind, userId, q])

  const load = useCallback(() => {
    startLoad(async () => {
      const res = await listEvents(filters())
      setRows(res.rows)
      setError(res.error ?? null)
    })
  }, [filters])

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  function download() {
    startExport(async () => {
      try {
        const csv = await exportEventsCsv(filters())
        downloadCSV(`event-log-last-${days}-days-${new Date().toISOString().slice(0, 10)}.csv`, csv)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Export failed.')
      }
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Time range" value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
          {[1, 3, 7, 15, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} {d === 1 ? 'day' : 'days'}</option>)}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
          <option value="">All events</option>
          <option value="pageview">Page views</option>
          <option value="click">Clicks</option>
          <option value="js_error">Browser errors</option>
          <option value="render_error">Page crashes</option>
          <option value="server_error">Server errors</option>
          <option value="system">System</option>
        </select>
        <select aria-label="User" value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
          <option value="">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <input
          type="search"
          placeholder="Search page, button or message…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${inputCls} min-w-[220px] flex-1 max-w-sm`}
        />
        <button
          onClick={download}
          disabled={exporting}
          className="btn-gradient flex items-center gap-1.5 disabled:opacity-60"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download CSV
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <p className="text-xs text-muted-foreground">
        {loading ? 'Loading…' : `Showing the latest ${rows.length} matching events (the download includes up to 50,000).`}
      </p>

      <div className="overflow-x-auto rounded-xl border border-[#E2E8F4] bg-white">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#E2E8F4] bg-[#F8FAFD] text-[10px] font-bold uppercase tracking-wider text-[#7B8DB0]">
              {['Time', 'User', 'Kind', 'Page', 'Clicked / Target', 'Message'].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No events match.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-[#EEF2F8] last:border-0 align-top hover:bg-[#FAFBFF]">
                <td className="px-3 py-2 whitespace-nowrap text-[#1A1F36]">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.user_name || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${KIND_STYLES[r.kind] ?? ''}`}>{r.kind}</span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.path ?? '—'}</td>
                <td className="px-3 py-2">{r.target ?? '—'}</td>
                <td className="px-3 py-2 max-w-[420px] break-words">{r.message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
