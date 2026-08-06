'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Building2, CheckCircle2, Clock, Ban, Users, Plus, X, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface CognixOrg {
  id: string
  name: string
  slug: string
  status: string
  seat_limit: number | null
  trial_ends_at: string | null
  created_at: string
  user_count: number
}

const STATUS_COLOR: Record<string, string> = {
  active:    'border-emerald-500/30 text-emerald-600 bg-emerald-500/15',
  trial:     'border-amber-500/30 text-amber-600 bg-amber-500/15',
  suspended: 'border-red-500/30 text-red-600 bg-red-500/15',
  cancelled: 'border-border text-muted-foreground bg-muted',
}
const STATUS_ICON: Record<string, React.ReactNode> = {
  active:    <CheckCircle2 className="h-3 w-3" />,
  trial:     <Clock className="h-3 w-3" />,
  suspended: <Ban className="h-3 w-3" />,
  cancelled: <Ban className="h-3 w-3" />,
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

const STATUS_FILTERS = ['all', 'active', 'trial', 'suspended', 'cancelled']

export function OwnerOrgsClient() {
  const router = useRouter()
  const [orgs, setOrgs]         = useState<CognixOrg[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [statusFilt, setStatusFilt] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)  // org id pending delete
  const [form, setForm]         = useState({
    name: '', billing_email: '', per_employee_rate: '299',
    plan: 'standard', country: 'IN', seat_limit: '10',
    admin_name: '', admin_email: '', admin_password: '',
  })
  const [saving, setSaving]     = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/owner/organizations')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
      setOrgs(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const res = await fetch('/api/owner/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, slug, seat_limit: parseInt(form.seat_limit) || 10, per_employee_rate: parseInt(form.per_employee_rate) || 299 }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create')
      toast.success('Organization created')
      setShowCreate(false)
      setForm({ name:'', billing_email:'', per_employee_rate:'299', plan:'standard', country:'IN', seat_limit:'10', admin_name:'', admin_email:'', admin_password:'' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/owner/organizations/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      const data = await res.json()
      toast.success(`Deleted ${data.deleted ?? 'organization'}`)
      setDelConfirm(null)
      setOrgs(o => o.filter(x => x.id !== id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const filtered = orgs.filter(o => {
    const ms = o.name.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilt === 'all' || o.status === statusFilt
    return ms && mf
  })

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CognixDesk Organizations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{orgs.length} total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 text-white text-sm font-semibold shadow-lg shadow-emerald-500/20 hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" /> New Organization
        </button>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold">Create Organization</h2>
              <button onClick={() => setShowCreate(false)} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 max-h-[65vh] overflow-y-auto">
              {[
                { label: 'Company Name *', key: 'name', placeholder: 'Acme Corp' },
                { label: 'Billing Email', key: 'billing_email', placeholder: 'billing@acme.com' },
                { label: 'Per-Employee Rate (₹)', key: 'per_employee_rate', placeholder: '299' },
                { label: 'Seat Limit', key: 'seat_limit', placeholder: '10' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{label}</label>
                  <input
                    type={key.includes('rate') || key === 'seat_limit' ? 'number' : 'text'}
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Plan</label>
                  <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none">
                    <option value="standard">Standard</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Country</label>
                  <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none" />
                </div>
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Initial Admin (optional)</p>
              {[
                { label: 'Admin Name', key: 'admin_name', placeholder: 'John Smith' },
                { label: 'Admin Email', key: 'admin_email', placeholder: 'admin@acme.com' },
                { label: 'Temp Password', key: 'admin_password', placeholder: 'Min 8 chars' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{label}</label>
                  <input
                    type={key === 'admin_password' ? 'password' : 'text'}
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name.trim() || saving} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity">
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      {delConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-red-500/15">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Delete organization?</p>
                <p className="text-xs text-muted-foreground">This permanently removes all data. Cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={() => handleDelete(delConfirm)} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map(s => (
            <button key={s} onClick={() => setStatusFilt(s)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${statusFilt === s ? 'bg-gradient-to-r from-emerald-500 to-indigo-600 text-white shadow' : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted shadow-sm'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-card border-b border-border">
              <tr>
                {['Organization', 'Slug', 'Status', 'Users', 'Seats', 'Created', ''].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 w-full bg-muted animate-pulse rounded" /></td></tr>
              ))}
              {!loading && error && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm">
                  <span className="text-red-500">{error}</span>{' '}
                  <button onClick={load} className="font-semibold underline">Retry</button>
                </td></tr>
              )}
              {!loading && !error && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No organizations found</td></tr>
              )}
              {filtered.map(org => (
                <tr key={org.id} className="hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => router.push(`/owner/orgs/${org.id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-border flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-3.5 w-3.5 text-indigo-500" />
                      </div>
                      <p className="font-semibold text-[13px]">{org.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground font-mono">{org.slug}</td>
                  <td className="px-4 py-3">
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_COLOR[org.status] ?? 'border-border text-muted-foreground bg-muted'}`}>
                      {STATUS_ICON[org.status]} {org.status}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-[13px]">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" /> {org.user_count}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px]">{org.seat_limit ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{fmtDate(org.created_at)}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setDelConfirm(org.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title="Delete organization"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
