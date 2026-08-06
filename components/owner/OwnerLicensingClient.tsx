'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'

interface OrgModuleAccess {
  id: string; org_id: string; org_name: string; module: string; enabled: boolean; valid_until: string | null
}
interface LicenseKey {
  id: string; org_id: string; org_name: string; key_hash: string; issued_at: string | null; expires_at: string | null; revoked_at: string | null
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

export function OwnerLicensingClient() {
  const [modules, setModules]   = useState<OrgModuleAccess[]>([])
  const [licenses, setLicenses] = useState<LicenseKey[]>([])
  const [loading, setLoading]   = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/owner/licensing')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const d = await res.json()
      setModules(d.modules ?? [])
      setLicenses(d.licenses ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleToggle(id: string, enabled: boolean) {
    try {
      const res = await fetch('/api/owner/licensing', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'toggle_module', id, enabled: !enabled }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      toast.success('Module access updated'); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  if (loading) return (
    <div className="p-8 space-y-4">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-xl" />)}
    </div>
  )

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">CognixDesk Licensing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage module access and license keys</p>
      </div>

      {/* Module Access */}
      <section className="space-y-4">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.16em]">Module Access</h2>
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="border-b border-border bg-card">
                <tr>
                  {['Organization', 'Module', 'Valid Until', 'Status', 'Toggle'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {modules.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No module access records</td></tr>
                )}
                {modules.map(m => (
                  <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-[13px] font-medium text-foreground">{m.org_name}</td>
                    <td className="px-4 py-3 text-[12px] capitalize text-foreground">{m.module.replace(/_/g,' ')}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{fmtDate(m.valid_until)}</td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${m.enabled ? 'border-emerald-500/30 text-emerald-600 bg-emerald-500/15' : 'border-border text-muted-foreground bg-muted'}`}>
                        {m.enabled ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {m.enabled ? 'Enabled' : 'Disabled'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleToggle(m.id, m.enabled)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${m.enabled ? 'bg-muted text-muted-foreground hover:bg-muted/80' : 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25'}`}>
                        {m.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* License Keys */}
      <section className="space-y-4">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.16em]">License Keys</h2>
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[650px]">
              <thead className="border-b border-border bg-card">
                <tr>
                  {['Organization', 'Key', 'Issued', 'Expires', 'Revoked'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {licenses.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No license keys issued</td></tr>
                )}
                {licenses.map(lk => (
                  <tr key={lk.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-[13px] font-medium text-foreground">{lk.org_name}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-foreground">{lk.key_hash}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{fmtDate(lk.issued_at)}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{fmtDate(lk.expires_at)}</td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{lk.revoked_at ? <span className="text-red-500">{fmtDate(lk.revoked_at)}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
