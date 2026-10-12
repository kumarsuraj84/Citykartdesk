import Link from 'next/link'
import { Flag, Store } from 'lucide-react'
import { getStoreSnapshot } from '@/lib/queries/store-snapshot'
import type { ReportViewerScope } from '@/lib/reporting/access'

/** Home card for managers and admins: where open tickets are by region, red-flag AC stores and new stores. Streams in after the rest of Home. */
export async function StoreSnapshotCard({ orgId, scope }: { orgId: string; scope: ReportViewerScope }) {
  const s = await getStoreSnapshot(orgId, scope).catch(() => null)
  // nothing to show before the Store Master has been uploaded
  if (!s || (s.openFromStores === 0 && s.nsoTickets30d === 0)) return null
  const maxOpen = Math.max(1, ...s.byRegion.map((r) => r.open))

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Stores and regions">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Store className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[12px] font-semibold text-foreground">Stores &amp; regions</span>
        </div>
        <Link href="/dashboards/executive" className="text-[11px] font-medium text-primary hover:underline">Open Smart Dashboard</Link>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Open tickets by region</p>
          {s.byRegion.length === 0 && <p className="text-xs text-muted-foreground">No open tickets from stores.</p>}
          {s.byRegion.map((r) => (
            <div key={r.name} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{r.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">{r.open}</span> open{r.breached > 0 && <span className="text-destructive"> · {r.breached} breached</span>}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.open / maxOpen) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/40 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">Red flag stores</p>
              <p className={`mt-0.5 text-base font-bold tabular-nums ${s.redFlagCount > 0 ? 'text-destructive' : 'text-foreground'}`}>{s.redFlagCount}</p>
              <p className="text-[10px] text-muted-foreground">AC not working above 30%</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">New store tickets</p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">{s.nsoTickets30d}</p>
              <p className="text-[10px] text-muted-foreground">last 30 days · {s.nsoStores30d} store{s.nsoStores30d === 1 ? '' : 's'}</p>
            </div>
          </div>
          {s.redFlagStores.length > 0 && (
            <ul className="space-y-1">
              {s.redFlagStores.map((r) => (
                <li key={r.code} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5"><Flag className="h-3 w-3 shrink-0 text-destructive" /><span className="font-semibold">{r.code}</span><span className="truncate text-muted-foreground">{r.cluster} · {r.region}</span></span>
                  <span className="shrink-0 tabular-nums font-semibold text-destructive">{Math.round(r.acPct ?? 0)}% <span className="font-normal text-muted-foreground">({r.acOpen}/{r.acTotal})</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
