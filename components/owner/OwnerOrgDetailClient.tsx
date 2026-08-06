'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Edit2, Save, X, CheckCircle2, Ban, AlertTriangle,
  ToggleLeft, ToggleRight, ShieldCheck, UserPlus, Eye, EyeOff,
  RefreshCw, Trash2, Award,
} from 'lucide-react'
import { toast } from 'sonner'

/* ── types ─────────────────────────────────────────────────────────────────── */
interface OrgDetail {
  id: string; name: string; slug: string; status: string
  seat_limit: number | null; trial_ends_at: string | null
  created_at: string; user_count: number; active_user_count: number
  billing_email: string | null; per_employee_rate: number | null; per_seat_rate?: number; plan: string
}
interface BillingSnapshot {
  id: string; snapshot_month: string; user_count: number
  per_seat_rate: number; amount_due: number; plan: string; notes: string | null; created_at: string
}
interface OrgUser {
  id: string; full_name: string; email?: string | null; role: string
  job_title: string | null; is_active: boolean; created_at: string
}
interface ModuleAccess { id: string; module: string; enabled: boolean; valid_until: string | null }
interface LicenseKey   { id: string; key_hash: string; issued_at: string | null; expires_at: string | null; revoked_at: string | null }

interface OrgData {
  org:       OrgDetail
  users:     OrgUser[]
  snapshots: BillingSnapshot[]
  modules:   ModuleAccess[]
  licenses:  LicenseKey[]
}

/* ── helpers ───────────────────────────────────────────────────────────────── */
function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}
function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(n)
}

const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-600', trial: 'text-amber-600', suspended: 'text-red-600', cancelled: 'text-muted-foreground',
}
const ROLE_COLOR: Record<string, string> = {
  admin: 'border-red-500/30 text-red-600 bg-red-500/15',
  manager: 'border-amber-500/30 text-amber-600 bg-amber-500/15',
  agent: 'border-indigo-500/30 text-indigo-600 bg-indigo-500/15',
  platform_owner: 'border-emerald-500/30 text-emerald-600 bg-emerald-500/15',
}

/* ── component ─────────────────────────────────────────────────────────────── */
export function OwnerOrgDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [data, setData]     = useState<OrgData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const [editing, setEditing]           = useState(false)
  const [editForm, setEditForm]         = useState({ name:'', seat_limit:'', billing_email:'', per_seat_rate:'', plan:'standard' })
  const [licenseMonths, setLicenseMonths] = useState('12')
  const [suspendConfirm, setSuspendConfirm] = useState(false)
  const [delConfirm, setDelConfirm]     = useState(false)
  const [addUserOpen, setAddUserOpen]   = useState(false)
  const [addUserForm, setAddUserForm]   = useState({ name:'', email:'', password:'', role:'agent' })
  const [showPwd, setShowPwd]           = useState(false)
  const [showResetPwd, setShowResetPwd] = useState(false)
  const [resetUserId, setResetUserId]   = useState<string | null>(null)
  const [resetPwd, setResetPwd]         = useState('')
  const [billOpen, setBillOpen]         = useState(false)
  const [billForm, setBillForm]         = useState({ month:'', user_count:'', per_seat_rate:'', amount_due:'', plan:'standard', notes:'' })
  const [saving, setSaving]             = useState(false)

  const base = `/api/owner/organizations/${id}`

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(base)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
      const d = await res.json() as OrgData
      setData(d)
      if (!editing) {
        setEditForm({
          name:          d.org.name,
          seat_limit:    String(d.org.seat_limit ?? ''),
          billing_email: d.org.billing_email ?? '',
          per_seat_rate: String(d.org.per_employee_rate ?? d.org.per_seat_rate ?? ''),
          plan:          d.org.plan ?? 'standard',
        })
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally     { setLoading(false) }
  }, [base, editing])

  useEffect(() => { load() }, [load])

  async function handleUpdateOrg() {
    setSaving(true)
    try {
      const [r1, r2] = await Promise.all([
        fetch(base, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: editForm.name, seat_limit: parseInt(editForm.seat_limit) || null }) }),
        fetch(`${base}/billing`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ billing_email: editForm.billing_email || null, per_employee_rate: parseFloat(editForm.per_seat_rate) || 0, plan: editForm.plan }) }),
      ])
      if (!r1.ok || !r2.ok) throw new Error('Update failed')
      toast.success('Organization updated'); setEditing(false); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  async function handleStatus(status: string) {
    try {
      const res = await fetch(`${base}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success(`Status → ${status}`); setSuspendConfirm(false); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  async function handleDelete() {
    try {
      const res = await fetch(base, { method:'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      toast.success('Organization deleted')
      router.push('/owner/orgs')
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  async function handleIssueLicense() {
    try {
      const res = await fetch(`${base}/licenses`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ months: parseInt(licenseMonths) || 12 }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      toast.success(`License issued: ${d.key_hint}`); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  async function handleToggleModule(module_id: string, current: boolean) {
    try {
      const res = await fetch(`${base}/modules`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ module_id, enabled: !current }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success('Module updated'); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  async function handleAddUser() {
    if (!addUserForm.name || !addUserForm.email || !addUserForm.password) return
    setSaving(true)
    try {
      const res = await fetch(`${base}/users`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(addUserForm) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success('User created'); setAddUserOpen(false); setAddUserForm({ name:'', email:'', password:'', role:'agent' }); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  async function handleToggleUser(user_id: string, is_active: boolean) {
    try {
      const res = await fetch(`${base}/users`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id, action:'toggle', is_active: !is_active }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success(`User ${is_active ? 'disabled' : 'enabled'}`); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  async function handleResetPassword() {
    if (!resetUserId || !resetPwd) return
    try {
      const res = await fetch(`${base}/users`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: resetUserId, action:'reset_password', new_password: resetPwd }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success('Password reset'); setResetUserId(null); setResetPwd('')
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  async function handleBillSnapshot() {
    try {
      const res = await fetch(`${base}/billing`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ month: billForm.month, user_count: parseInt(billForm.user_count)||0, per_seat_rate: parseFloat(billForm.per_seat_rate)||0, amount_due: parseFloat(billForm.amount_due)||0, plan: billForm.plan, notes: billForm.notes||null }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success('Snapshot saved'); setBillOpen(false); setBillForm({ month:'', user_count:'', per_seat_rate:'', amount_due:'', plan:'standard', notes:'' }); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  if (loading) return (
    <div className="flex h-96 items-center justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  )
  if (error || !data) return (
    <div className="p-8 text-center text-red-500">{error ?? 'Failed to load'} <button onClick={load} className="underline ml-2">Retry</button></div>
  )

  const { org, users, snapshots, modules, licenses } = data

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="grid h-8 w-8 place-items-center rounded-xl text-muted-foreground hover:bg-muted transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-mono text-muted-foreground">{org.slug}</span>
              <span className={`text-xs font-semibold capitalize ${STATUS_COLOR[org.status] ?? ''}`}>· {org.status}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {org.status !== 'active'    && <button onClick={() => handleStatus('active')}    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 transition-colors flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5"/>Activate</button>}
          {org.status !== 'suspended' && <button onClick={() => setSuspendConfirm(true)}   className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 transition-colors flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5"/>Suspend</button>}
          {org.status !== 'cancelled' && <button onClick={() => handleStatus('cancelled')} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted/80 transition-colors flex items-center gap-1"><Ban className="h-3.5 w-3.5"/>Cancel</button>}
          <button onClick={() => setDelConfirm(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 text-red-600 hover:bg-red-500/25 transition-colors flex items-center gap-1"><Trash2 className="h-3.5 w-3.5"/>Delete</button>
        </div>
      </div>

      {/* Suspend confirm */}
      {suspendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <p className="font-semibold">Suspend <span className="text-amber-600">{org.name}</span>?</p>
            <p className="text-sm text-muted-foreground">Users will be locked out until reactivated.</p>
            <div className="flex gap-3">
              <button onClick={() => setSuspendConfirm(false)} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={() => handleStatus('suspended')} className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600">Suspend</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <p className="font-semibold text-red-600">Permanently delete <span className="italic">{org.name}</span>?</p>
            <p className="text-sm text-muted-foreground">All users, billing snapshots, licenses and module access will be removed. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(false)} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleDelete} className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600">Delete forever</button>
            </div>
          </div>
        </div>
      )}

      {/* Overview card */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overview</h2>
          {!editing
            ? <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"><Edit2 className="h-3.5 w-3.5"/>Edit</button>
            : <div className="flex gap-2">
                <button onClick={() => { setEditing(false); load() }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5"/>Cancel</button>
                <button onClick={handleUpdateOrg} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"><Save className="h-3.5 w-3.5"/>{saving?'Saving…':'Save'}</button>
              </div>
          }
        </div>

        {editing ? (
          <div className="grid grid-cols-2 gap-4">
            {[
              { label:'Name', key:'name' },
              { label:'Seat Limit', key:'seat_limit' },
              { label:'Billing Email', key:'billing_email' },
              { label:'Per-Seat Rate (₹)', key:'per_seat_rate' },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</label>
                <input value={editForm[key as keyof typeof editForm]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Plan</label>
              <select value={editForm.plan} onChange={e => setEditForm(f => ({ ...f, plan: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none">
                <option value="standard">Standard</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
            {[
              { label:'Status',    value: <span className={`font-semibold capitalize ${STATUS_COLOR[org.status]??''}`}>{org.status}</span> },
              { label:'Plan',      value: org.plan },
              { label:'Users',     value: `${org.user_count} total · ${org.active_user_count} active` },
              { label:'Seat Limit', value: org.seat_limit ?? '—' },
              { label:'Per-Seat',  value: org.per_employee_rate != null ? fmtINR(org.per_employee_rate) : '—' },
              { label:'Billing',   value: org.billing_email ?? '—' },
              { label:'Trial Ends', value: fmtDate(org.trial_ends_at) },
              { label:'Created',   value: fmtDate(org.created_at) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-0.5">{label}</p>
                <p className="text-sm font-medium text-foreground">{value}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* License */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">License Keys</h2>
          <div className="flex items-center gap-2">
            <input type="number" min="1" max="60" value={licenseMonths} onChange={e => setLicenseMonths(e.target.value)} className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs text-center focus:outline-none" placeholder="12" />
            <span className="text-xs text-muted-foreground">months</span>
            <button onClick={handleIssueLicense} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-500/15 text-indigo-600 hover:bg-indigo-500/25 transition-colors">
              <Award className="h-3.5 w-3.5" /> Issue License
            </button>
          </div>
        </div>
        {licenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No license keys issued.</p>
        ) : (
          <div className="divide-y divide-border">
            {licenses.map(lk => (
              <div key={lk.id} className="py-2.5 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-foreground">{lk.key_hash}</span>
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span>Issued {fmtDate(lk.issued_at)}</span>
                  <span>Expires {fmtDate(lk.expires_at)}</span>
                  {lk.revoked_at && <span className="text-red-500">Revoked {fmtDate(lk.revoked_at)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Module Access */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Module Access</h2>
        {modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No modules configured.</p>
        ) : (
          <div className="divide-y divide-border">
            {modules.map(m => (
              <div key={m.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium capitalize text-foreground">{m.module.replace(/_/g, ' ')}</p>
                  {m.valid_until && <p className="text-[11px] text-muted-foreground">Valid until {fmtDate(m.valid_until)}</p>}
                </div>
                <button onClick={() => handleToggleModule(m.id, m.enabled)} className={`transition-colors ${m.enabled ? 'text-emerald-500' : 'text-muted-foreground'}`} title={m.enabled ? 'Disable' : 'Enable'}>
                  {m.enabled ? <ToggleRight className="h-7 w-7" /> : <ToggleLeft className="h-7 w-7" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Billing Snapshots */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Billing Snapshots</h2>
          <button onClick={() => setBillOpen(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 transition-colors">+ Add Snapshot</button>
        </div>
        {billOpen && (
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label:'Month (YYYY-MM)', key:'month', placeholder:'2025-01' },
                { label:'User Count',     key:'user_count', placeholder:'15' },
                { label:'Per-Seat Rate',  key:'per_seat_rate', placeholder:'299' },
                { label:'Amount Due',     key:'amount_due', placeholder:'4485' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</label>
                  <input value={billForm[key as keyof typeof billForm]} onChange={e => setBillForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes</label>
              <input value={billForm.notes} onChange={e => setBillForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBillOpen(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleBillSnapshot} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600">Save Snapshot</button>
            </div>
          </div>
        )}
        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No billing snapshots yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border">
                {['Month', 'Users', 'Rate', 'Amount Due', 'Plan', 'Notes'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-2 py-2">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {snapshots.map(s => (
                  <tr key={s.id}>
                    <td className="px-2 py-2 text-[12px] font-mono">{s.snapshot_month}</td>
                    <td className="px-2 py-2 text-[13px]">{s.user_count}</td>
                    <td className="px-2 py-2 text-[13px]">{fmtINR(s.per_seat_rate)}</td>
                    <td className="px-2 py-2 text-[13px] font-semibold">{fmtINR(s.amount_due)}</td>
                    <td className="px-2 py-2 text-[12px] capitalize">{s.plan}</td>
                    <td className="px-2 py-2 text-[12px] text-muted-foreground">{s.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Users */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Users ({users.length})</h2>
          <button onClick={() => setAddUserOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-500/15 text-indigo-600 hover:bg-indigo-500/25 transition-colors">
            <UserPlus className="h-3.5 w-3.5" /> Add User
          </button>
        </div>

        {addUserOpen && (
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            {[
              { label:'Full Name',  key:'name', placeholder:'John Smith', type:'text' },
              { label:'Email',      key:'email', placeholder:'user@org.com', type:'email' },
              { label:'Password',   key:'password', placeholder:'Min 8 chars', type: showPwd ? 'text' : 'password' },
            ].map(({ label, key, placeholder, type }) => (
              <div key={key}>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</label>
                <div className="relative">
                  <input type={type} placeholder={placeholder} value={addUserForm[key as keyof typeof addUserForm]} onChange={e => setAddUserForm(f => ({ ...f, [key]: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                  {key === 'password' && (
                    <button type="button" onClick={() => setShowPwd(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Role</label>
              <select value={addUserForm.role} onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none">
                <option value="agent">Agent</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAddUserOpen(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleAddUser} disabled={saving || !addUserForm.name || !addUserForm.email || !addUserForm.password} className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold hover:bg-indigo-600 disabled:opacity-50">
                {saving ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        )}

        {/* Reset password modal */}
        {resetUserId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
              <p className="font-semibold">Reset Password</p>
              <div className="relative">
                <input type={showResetPwd ? 'text' : 'password'} value={resetPwd} onChange={e => setResetPwd(e.target.value)} placeholder="New password" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                <button type="button" onClick={() => setShowResetPwd(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showResetPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setResetUserId(null); setResetPwd('') }} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={handleResetPassword} disabled={!resetPwd} className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50">Reset</button>
              </div>
            </div>
          </div>
        )}

        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users in this organization.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border">
                {['Name', 'Role', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-2 py-2">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="px-2 py-2.5">
                      <p className="text-[13px] font-medium text-foreground">{u.full_name}</p>
                      {u.email && <p className="text-[11px] text-muted-foreground">{u.email}</p>}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded-md border text-[11px] font-medium ${ROLE_COLOR[u.role] ?? 'border-border text-muted-foreground bg-muted'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={`text-[12px] font-medium ${u.is_active ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {u.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleToggleUser(u.id, u.is_active)} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title={u.is_active ? 'Disable' : 'Enable'}>
                          {u.is_active ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4" />}
                        </button>
                        <button onClick={() => { setResetUserId(u.id); setResetPwd('') }} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors" title="Reset password">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
