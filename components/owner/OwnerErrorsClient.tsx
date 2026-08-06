'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface ErrorReport {
  id: string; app: string; error_type: string; message: string
  status: 'new' | 'triaged' | 'resolved' | 'dismissed'
  created_at: string; org_id: string | null; org_name: string | null; url: string | null
}

const STATUS_COLOR: Record<string, string> = {
  new:       'border-red-500/30 text-red-600 bg-red-500/15',
  triaged:   'border-amber-500/30 text-amber-600 bg-amber-500/15',
  resolved:  'border-emerald-500/30 text-emerald-600 bg-emerald-500/15',
  dismissed: 'border-border text-muted-foreground bg-muted',
}

const APP_COLOR: Record<string, string> = {
  cognixdesk: 'border-indigo-500/30 text-indigo-600 bg-indigo-500/15',
  hrms:       'border-teal-500/30 text-teal-600 bg-teal-500/15',
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diff < 1)    return 'just now'
  if (diff < 60)   return `${diff}m ago`
  const h = Math.floor(diff / 60)
  if (h < 24)      return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)      return `${d}d ago`
  const dt = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

const STATUS_FILTERS = ['all', 'new', 'triaged', 'resolved', 'dismissed']
const NEXT_STATUS: Record<string, string> = { new: 'triaged', triaged: 'resolved', resolved: 'dismissed', dismissed: 'new' }
const NEXT_LABEL:  Record<string, string> = { new: 'Triage', triaged: 'Resolve', resolved: 'Dismiss', dismissed: 'Reopen' }

export function OwnerErrorsClient() {
  const [errors, setErrors]   = useState<ErrorReport[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilt, setStatusFilt] = useState('all')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/owner/errors')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      setErrors(await res.json())
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleStatusChange(id: string, current: string) {
    const next = NEXT_STATUS[current] ?? 'triaged'
    try {
      const res = await fetch('/api/owner/errors', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, status: next }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success(`Marked as ${next}`)
      setErrors(prev => prev.map(e => e.id === id ? { ...e, status: next as ErrorReport['status'] } : e))
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const filtered = errors.filter(e => statusFilt === 'all' || e.status === statusFilt)

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">CognixDesk Error Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{errors.length} recent reports</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(s => (
          <button key={s} onClick={() => setStatusFilt(s)} className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${statusFilt === s ? 'bg-gradient-to-r from-emerald-500 to-indigo-600 text-white shadow' : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted shadow-sm'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="border-b border-border bg-card">
              <tr>
                {['App', 'Type', 'Message', 'Org', 'Time', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td></tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No error reports</td></tr>
              )}
              {!loading && filtered.map(e => (
                <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-medium ${APP_COLOR[e.app] ?? 'border-border text-muted-foreground bg-muted'}`}>
                      {e.app}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] font-mono text-foreground">{e.error_type}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground max-w-xs truncate" title={e.message}>{e.message}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{e.org_name ?? '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">{timeAgo(e.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_COLOR[e.status]}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleStatusChange(e.id, e.status)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">
                      {NEXT_LABEL[e.status] ?? 'Update'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
