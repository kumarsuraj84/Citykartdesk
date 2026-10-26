import Link from 'next/link'
import { Download } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { formatMoney } from '@/lib/vendor/lines'
import { PO_STATUS_LABELS, type PoRegisterRow } from '@/lib/vendor/register'

// The PO register as a page: search, filters and the Excel download. Used by the vendor ("My POs") and by Citykart ("Purchase orders").

const field = 'h-9 rounded-lg border border-border bg-background px-3 text-sm'

export function PoRegisterView({ rows, basePath, filters, showVendor, ticketHref }: {
  rows: PoRegisterRow[]
  basePath: string
  filters: { q?: string; status?: string; from?: string; to?: string }
  showVendor: boolean
  ticketHref: (row: PoRegisterRow) => string
}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v)
  const total = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div className="space-y-3">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">Search<input name="q" defaultValue={filters.q ?? ''} placeholder="PO no., ticket, store, item…" className={`${field} mt-1 block w-64`} /></label>
        <label className="text-xs text-muted-foreground">Status
          <select name="status" defaultValue={filters.status || 'approved'} className={`${field} mt-1 block`}>
            <option value="approved">POs issued</option>
            <option value="all">All quotes and POs</option>
            {Object.entries(PO_STATUS_LABELS).filter(([v]) => v !== 'approved').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">From<input type="date" name="from" defaultValue={filters.from ?? ''} className={`${field} mt-1 block`} /></label>
        <label className="text-xs text-muted-foreground">To<input type="date" name="to" defaultValue={filters.to ?? ''} className={`${field} mt-1 block`} /></label>
        <button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">Filter</button>
        <Link href={basePath} className="h-9 content-center text-sm text-muted-foreground hover:text-foreground">Clear</Link>
        <a href={`/api/vendor/pos/export?${qs.toString()}`} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"><Download className="h-4 w-4" /> Download Excel</a>
      </form>

      <div className="text-xs text-muted-foreground">{rows.length} row{rows.length === 1 ? '' : 's'} · amount without GST {formatMoney(total)}</div>

      <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Purchase orders (scroll sideways on a small screen)">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">PO no.</th><th className="px-3 py-2 font-medium">PO date</th><th className="px-3 py-2 font-medium">Ticket</th><th className="px-3 py-2 font-medium">Store</th>
              {showVendor && <th className="px-3 py-2 font-medium">Vendor</th>}
              <th className="px-3 py-2 font-medium">Items</th><th className="px-3 py-2 text-right font-medium">Quote v</th><th className="px-3 py-2 text-right font-medium">Amount (no GST)</th><th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={showVendor ? 9 : 8} className="px-3 py-8 text-center text-muted-foreground">No purchase orders found.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{r.po_number ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.po_date ?? '—'}</td>
                <td className="px-3 py-2"><Link href={ticketHref(r)} className="text-primary hover:underline">{r.request_no}</Link></td>
                <td className="px-3 py-2">{r.store_name ?? '—'}{r.store_code && <span className="ml-1 text-xs text-muted-foreground">({r.store_code})</span>}</td>
                {showVendor && <td className="px-3 py-2">{r.vendor_name}{r.technician && <div className="text-xs text-muted-foreground">{r.technician}</div>}</td>}
                <td className="max-w-[18rem] px-3 py-2 text-xs">{r.items || '—'}</td>
                <td className="px-3 py-2 text-right">{r.version}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.total)}</td>
                <td className="px-3 py-2">{PO_STATUS_LABELS[r.status]}<div className="text-xs text-muted-foreground">{formatDateTime(r.decided_at ?? r.requested_at)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
