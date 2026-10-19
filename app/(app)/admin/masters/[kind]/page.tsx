import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import {
  countBy, distinct, filterFleet, isFleetKind, loadFleet, stateOf, type AcMasterRow, type FleetFilters, type GensetMasterRow,
} from '@/lib/masters/fleet'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AC and Genset master' }

const SHOW_ROWS = 500
const input = 'h-9 rounded-lg border border-border bg-background px-3 text-sm'
const cell = 'px-3 py-2'

function Breakdown({ title, rows }: { title: string; rows: { value: string; count: number }[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.slice(0, 8).map((r) => (
          <li key={r.value} className="flex items-center justify-between gap-3"><span className="truncate text-foreground">{r.value}</span><span className="tabular-nums text-muted-foreground">{r.count}</span></li>
        ))}
        {rows.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
      </ul>
    </section>
  )
}

function StateBadge({ state }: { state: 'active' | 'inactive' | 'removed' }) {
  const tone = state === 'active' ? 'bg-emerald-50 text-emerald-700' : state === 'inactive' ? 'bg-amber-50 text-amber-700' : 'bg-muted text-muted-foreground'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{state === 'active' ? 'Active' : state === 'inactive' ? 'Inactive' : 'Removed'}</span>
}

export default async function FleetMasterPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { kind } = await params
  if (!isFleetKind(kind)) notFound()
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner', 'manager'].includes(profile.role)) redirect('/home')
  if (!profile.org_id) redirect('/home')
  const sp = await searchParams
  const status = (['active', 'inactive', 'removed', 'all'] as const).find((s) => s === sp.status) ?? 'active'
  const filters: FleetFilters = { q: sp.q, status, brand: sp.brand, region: sp.region, vendor: sp.vendor }

  const db = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const all: (AcMasterRow | GensetMasterRow)[] = kind === 'ac' ? await loadFleet(db, profile.org_id, 'ac') : await loadFleet(db, profile.org_id, 'genset')
  const rows = filterFleet(all, filters)
  const brands = distinct(all, (r) => r.brand)
  const regions = kind === 'ac' ? distinct(all as AcMasterRow[], (r) => r.region) : []
  const vendors = kind === 'ac' ? distinct(all as AcMasterRow[], (r) => r.amc_vendor) : []
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()
  const isAc = kind === 'ac'

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={isAc ? 'AC master' : 'Genset master'}
        description={`A copy of the ${isAc ? 'AC' : 'Genset'} Google Sheet, refreshed at 11:00, 15:00 and 19:00. To change anything, change the sheet. Dashboards and reports use these same columns.`}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/masters/ac" className={isAc ? 'font-semibold text-foreground' : 'text-primary underline'}>AC master</Link>
        <span className="text-muted-foreground">|</span>
        <Link href="/admin/masters/genset" className={!isAc ? 'font-semibold text-foreground' : 'text-primary underline'}>Genset master</Link>
        {profile.role !== 'manager' && (
          <>
            <span className="text-muted-foreground">|</span>
            <Link href="/admin/masters" className="text-primary underline">Sheet Masters (connection, update, e-mail wording)</Link>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Breakdown title="Rows" rows={[{ value: 'Matching your filters', count: rows.length }, { value: 'All in the master', count: all.length }]} />
        <Breakdown title="By brand" rows={countBy(rows, (r) => r.brand)} />
        {isAc ? <Breakdown title="By tonnage" rows={countBy(rows as AcMasterRow[], (r) => r.tonnage)} /> : <Breakdown title="By KVA" rows={countBy(rows as GensetMasterRow[], (r) => r.kva)} />}
        {isAc ? <Breakdown title="By region" rows={countBy(rows as AcMasterRow[], (r) => r.region)} /> : <Breakdown title="By CPCB group" rows={countBy(rows as GensetMasterRow[], (r) => r.cpcb_group)} />}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
        <label className="text-xs text-muted-foreground">Search<input name="q" defaultValue={sp.q ?? ''} placeholder="store, serial, city, e-mail" className={`${input} mt-1 block w-56`} /></label>
        <label className="text-xs text-muted-foreground">Status
          <select name="status" defaultValue={status} className={`${input} mt-1 block`}>
            <option value="active">Active</option>
            {isAc && <option value="inactive">Inactive</option>}
            <option value="removed">Removed from sheet</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">Brand
          <select name="brand" defaultValue={sp.brand ?? ''} className={`${input} mt-1 block`}><option value="">All</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
        </label>
        {isAc && (
          <>
            <label className="text-xs text-muted-foreground">Region
              <select name="region" defaultValue={sp.region ?? ''} className={`${input} mt-1 block`}><option value="">All</option>{regions.map((b) => <option key={b}>{b}</option>)}</select>
            </label>
            <label className="text-xs text-muted-foreground">AMC vendor
              <select name="vendor" defaultValue={sp.vendor ?? ''} className={`${input} mt-1 block`}><option value="">All</option>{vendors.map((b) => <option key={b}>{b}</option>)}</select>
            </label>
          </>
        )}
        <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Apply</button>
        <Link href={`/admin/masters/${kind}`} className="h-9 px-2 text-sm leading-9 text-primary underline">Clear</Link>
        <a href={`/api/masters/export?kind=${kind}${qs ? `&${qs}` : ''}`} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-foreground"><Download className="h-4 w-4" />Download Excel (CSV)</a>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            {isAc ? (
              <tr>{['Store', 'CKDESK no', 'Serial', 'Floor', 'Type', 'Tonnage', 'Brand', 'AMC vendor', 'Region', 'Status'].map((h) => <th key={h} className={cell}>{h}</th>)}</tr>
            ) : (
              <tr>{['Store', 'Brand', 'KVA', 'Serial', 'CPCB group', 'OEM mail', 'Status'].map((h) => <th key={h} className={cell}>{h}</th>)}</tr>
            )}
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, SHOW_ROWS).map((r) => {
              const s = stateOf(r as AcMasterRow)
              if (isAc) {
                const a = r as AcMasterRow
                return (
                  <tr key={a.id}>
                    <td className={`${cell} font-medium text-foreground`}>{a.store_code}</td><td className={cell}>{a.ckdesk_no}</td><td className={cell}>{a.serial ?? '-'}</td><td className={cell}>{a.floor ?? '-'}</td>
                    <td className={cell}>{a.ac_type ?? '-'}</td><td className={cell}>{a.tonnage ?? '-'}</td><td className={cell}>{a.brand ?? '-'}</td><td className={cell}>{a.amc_vendor ?? '-'}</td>
                    <td className={cell}>{a.region ?? '-'}</td><td className={cell}><StateBadge state={s} /></td>
                  </tr>
                )
              }
              const g = r as GensetMasterRow
              return (
                <tr key={g.id}>
                  <td className={`${cell} font-medium text-foreground`}>{g.store_code}</td><td className={cell}>{g.brand ?? '-'}</td><td className={cell}>{g.kva ?? '-'}</td><td className={cell}>{g.serial ?? '-'}</td>
                  <td className={cell}>{g.cpcb_group ?? '-'}</td><td className={`${cell} text-xs`}>{g.emails.join(', ') || '-'}</td><td className={cell}><StateBadge state={s} /></td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Nothing matches. If the master is empty, connect Google Sheets and press &quot;Update from sheets now&quot; on the Sheet Masters page.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > SHOW_ROWS && <p className="text-xs text-muted-foreground">Showing the first {SHOW_ROWS} of {rows.length}. Narrow the filters, or download the full list.</p>}
    </div>
  )
}
