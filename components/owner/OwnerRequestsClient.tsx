'use client'

import { useState, useEffect } from 'react'
import { Clock, CheckCircle2, XCircle, Building2, X } from 'lucide-react'
import { toast } from 'sonner'

interface SignupRequest {
  id: string
  full_name: string
  email: string
  company_name: string
  company_size: string | null
  use_case: string | null
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  created_at: string
}

const STATUS_COLOR: Record<string, string> = {
  pending:  'border-amber-500/30 text-amber-600 bg-amber-500/15',
  approved: 'border-emerald-500/30 text-emerald-600 bg-emerald-500/15',
  rejected: 'border-red-500/30 text-red-600 bg-red-500/15',
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diff < 1)  return 'just now'
  if (diff < 60) return `${diff}m ago`
  const h = Math.floor(diff / 60)
  if (h < 24)    return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)    return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
}

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected']

export function OwnerRequestsClient() {
  const [requests, setRequests]  = useState<SignupRequest[]>([])
  const [loading, setLoading]    = useState(true)
  const [statusFilt, setStatusFilt] = useState('all')
  const [approveId, setApproveId] = useState<string | null>(null)
  const [rejectId, setRejectId]   = useState<string | null>(null)
  const [approveForm, setApproveForm] = useState({ org_name: '', seat_limit: '10' })
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving]      = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/owner/requests')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      setRequests(await res.json())
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleApprove() {
    if (!approveId || !approveForm.org_name.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/owner/requests', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: approveId, action:'approve', org_name: approveForm.org_name, seat_limit: parseInt(approveForm.seat_limit)||10 }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success('Request approved — organization created')
      setApproveId(null); setApproveForm({ org_name:'', seat_limit:'10' }); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  async function handleReject() {
    if (!rejectId) return
    setSaving(true)
    try {
      const res = await fetch('/api/owner/requests', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: rejectId, action:'reject', rejection_reason: rejectReason }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success('Request rejected')
      setRejectId(null); setRejectReason(''); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  const filtered = requests.filter(r => statusFilt === 'all' || r.status === statusFilt)
  const pending = requests.filter(r => r.status === 'pending').length

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Signup Requests</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{requests.length} total · {pending} pending</p>
      </div>

      {/* Approve modal */}
      {approveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <h3 className="font-semibold text-foreground">Approve Request</h3>
            <p className="text-xs text-muted-foreground">Creating an organization for the requester. They'll receive login credentials.</p>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Organization Name</label>
              <input value={approveForm.org_name} onChange={e => setApproveForm(f => ({ ...f, org_name: e.target.value }))} placeholder="Acme Corp" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Seat Limit</label>
              <input type="number" value={approveForm.seat_limit} onChange={e => setApproveForm(f => ({ ...f, seat_limit: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setApproveId(null)} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleApprove} disabled={saving || !approveForm.org_name.trim()} className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50">
                {saving ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <h3 className="font-semibold text-foreground">Reject Request</h3>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Reason (optional)</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none resize-none" placeholder="We'll include this in the rejection email…" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRejectId(null)} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleReject} disabled={saving} className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50">
                {saving ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(s => (
          <button key={s} onClick={() => setStatusFilt(s)} className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${statusFilt === s ? 'bg-gradient-to-r from-emerald-500 to-indigo-600 text-white shadow' : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted shadow-sm'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No requests found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start gap-4">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 flex-shrink-0">
                  <Building2 className="h-4.5 w-4.5 text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground">{r.company_name}</p>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>
                      {r.status === 'pending' && <Clock className="h-3 w-3" />}
                      {r.status === 'approved' && <CheckCircle2 className="h-3 w-3" />}
                      {r.status === 'rejected' && <XCircle className="h-3 w-3" />}
                      {r.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{r.full_name} · {r.email}</p>
                  {r.use_case && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.use_case}</p>}
                  {r.rejection_reason && <p className="text-xs text-red-500 mt-1">Rejected: {r.rejection_reason}</p>}
                  <p className="text-[11px] text-muted-foreground mt-2">{timeAgo(r.created_at)}</p>
                </div>
                {r.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => { setApproveId(r.id); setApproveForm({ org_name: r.company_name, seat_limit: '10' }) }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 transition-colors">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button onClick={() => setRejectId(r.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 text-red-600 hover:bg-red-500/25 transition-colors">
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
