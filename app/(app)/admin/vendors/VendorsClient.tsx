'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import { createVendorCompany, inviteVendorPerson, setPoApprover, setVendorCompanyActive, updateVendorPerson } from '@/lib/actions/admin/vendors'

export type VendorCompanyRow = { id: string; name: string; is_active: boolean; technicians: number; managers: number }
export type StaffOption = { id: string; full_name: string; role: string }
export type VendorPersonRow = { id: string; full_name: string; is_active: boolean; vendor_company_id: string; vendor_role: 'technician' | 'manager' }

const inputCls = 'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20'
const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60'

export function VendorsClient({ companies, people, staff, approverId }: { companies: VendorCompanyRow[]; people: VendorPersonRow[]; staff: StaffOption[]; approverId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [kind, setKind] = useState<'technician' | 'manager'>('technician')
  const companyName_ = new Map(companies.map((c) => [c.id, c.name]))

  const run = (fn: () => Promise<{ error?: string; warning?: string }>, ok: string, after?: () => void) => startTransition(async () => {
    const res = await fn()
    if (res.error) { toast.error(res.error); return }
    if (res.warning) toast.warning(res.warning); else toast.success(ok)
    after?.()
    router.refresh()
  })

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Vendor companies</h2>
        <ul className="mt-3 divide-y divide-border">
          {companies.length === 0 && <li className="py-3 text-sm text-muted-foreground">No vendor company yet. Add the first one below.</li>}
          {companies.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <span className="font-medium">{c.name}</span>
                {!c.is_active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">switched off</span>}
                <span className="ml-3 text-xs text-muted-foreground">{c.technicians} technician{c.technicians === 1 ? '' : 's'}, {c.managers} manager{c.managers === 1 ? '' : 's'}</span>
              </div>
              <button type="button" className="text-xs text-primary hover:underline" disabled={pending}
                onClick={() => run(() => setVendorCompanyActive(c.id, !c.is_active), c.is_active ? 'Switched off.' : 'Switched on.')}>
                {c.is_active ? 'Switch off' : 'Switch on'}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-xs text-muted-foreground">New vendor company
            <input className={`${inputCls} mt-1`} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="For example Voltas" maxLength={120} />
          </label>
          <button type="button" className={btn} disabled={pending || companyName.trim().length < 2}
            onClick={() => run(() => createVendorCompany(companyName), 'Company added.', () => setCompanyName(''))}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Default PO approver (AC)</h2>
        <p className="mt-1 text-xs text-muted-foreground">Used for AC only, when the AC sheet names nobody for an AC. Every Vendor Program has its own default approvers (on its program screen, Admin &gt; Vendor Programs). The PO approvers of each AC are written in the AC sheet, column &ldquo;Quote Approver Mail To&rdquo; (one or several addresses): the quote goes to all of them and any one can decide. The approver enters the PO number, date and document. Krishan is the default.</p>
        <select aria-label="Default PO approver" className={`${inputCls} mt-2 max-w-sm`} value={approverId} disabled={pending}
          onChange={(e) => run(() => setPoApprover(e.target.value), 'PO approver changed.')}>
          {!approverId && <option value="">Not set - choose a person</option>}
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </section>

      <section className="rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">Vendor logins</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-3 font-medium">Name</th><th className="py-1 pr-3 font-medium">Company</th><th className="py-1 pr-3 font-medium">Kind</th><th className="py-1 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {people.length === 0 && <tr><td colSpan={4} className="py-3 text-muted-foreground">No vendor login yet.</td></tr>}
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3">{p.full_name}</td>
                  <td className="py-2 pr-3">
                    <select aria-label={`Company of ${p.full_name}`} className="h-8 rounded border border-border bg-background px-2 text-sm" value={p.vendor_company_id} disabled={pending}
                      onChange={(e) => run(() => updateVendorPerson(p.id, { company_id: e.target.value }), 'Company changed.')}>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <select aria-label={`Kind of ${p.full_name}`} className="h-8 rounded border border-border bg-background px-2 text-sm" value={p.vendor_role} disabled={pending}
                      onChange={(e) => run(() => updateVendorPerson(p.id, { vendor_role: e.target.value as 'technician' | 'manager' }), 'Changed.')}>
                      <option value="technician">Technician</option>
                      <option value="manager">Manager (view only)</option>
                    </select>
                  </td>
                  <td className="py-2">{p.is_active ? 'Active' : 'Switched off'}{!companyName_.has(p.vendor_company_id) && ' (company missing)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">To switch a login off, or to e-mail a new password link, use <a className="text-primary hover:underline" href="/admin/users">Users</a>.</p>

        <h3 className="mt-5 text-sm font-semibold">Add a vendor login</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-muted-foreground">Name<input className={`${inputCls} mt-1`} value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">E-mail<input type="email" className={`${inputCls} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Company
            <select className={`${inputCls} mt-1`} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Choose…</option>
              {companies.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Kind
            <select className={`${inputCls} mt-1`} value={kind} onChange={(e) => setKind(e.target.value as 'technician' | 'manager')}>
              <option value="technician">Technician</option>
              <option value="manager">Manager (view only)</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <button type="button" className={btn} disabled={pending || !email.trim() || !fullName.trim() || !companyId}
            onClick={() => run(() => inviteVendorPerson({ email, full_name: fullName, company_id: companyId, vendor_role: kind }), 'Login created and invitation sent.', () => { setEmail(''); setFullName('') })}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create login
          </button>
        </div>
      </section>
    </div>
  )
}
