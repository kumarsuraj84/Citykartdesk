import { PageHeader } from '@/components/ui/PageHeader'
import { zohoDbStatus } from '@/lib/zoho/db'
import { getStoreAcReport } from '@/lib/zoho/queries'
import { AGE_BUCKETS, RED_FLAG_SHARE } from '@/lib/zoho/report-shapes'
import { NotConnected } from '../_components/NotConnected'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Zoho reports' }

const fmt = (x: number) => x.toLocaleString('en-IN')
const pct = (share: number | null) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`)

export default async function ZohoReportsPage() {
  const status = zohoDbStatus()
  const header = (
    <PageHeader
      title="Zoho reports"
      description="Ready-made reports over the old Zoho tickets. Worked out entirely inside the Zoho database - no CK Desk figure is mixed in."
    />
  )
  if (!status.ready) return <div className="space-y-4">{header}<NotConnected reason={status.reason} /></div>

  let report: Awaited<ReturnType<typeof getStoreAcReport>>
  try {
    report = await getStoreAcReport()
  } catch (e) {
    return <div className="space-y-4">{header}<NotConnected reason={e instanceof Error ? e.message : 'The Zoho database could not be read.'} /></div>
  }

  const { rows, totals } = report

  return (
    <div className="space-y-4">
      {header}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Stores with AC tickets still open</h2>
          <p className="text-[11px] text-muted-foreground">as on {new Date(report.asOn).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          One row per store that has an AC ticket still open in Zoho. &ldquo;Of its ACs&rdquo; compares the open tickets with how many ACs the store has in the AC Google Sheet,
          and a store is marked <span className="font-semibold text-red-600 dark:text-red-400">RED</span> once that reaches {Math.round(RED_FLAG_SHARE * 100)}%.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">Open AC tickets</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{fmt(totals.tickets)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">Stores affected</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{fmt(totals.stores)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">Red stores</p>
            <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{fmt(totals.redFlagStores)}</p>
            <p className="text-[11px] text-muted-foreground">{Math.round(RED_FLAG_SHARE * 100)}% or more of their ACs</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">Waiting over 20 days</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{fmt(totals.buckets['20+'])}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Store</th>
                <th className="px-3 py-2 font-medium">City</th>
                <th className="px-3 py-2 font-medium">Cluster</th>
                <th className="px-3 py-2 font-medium">AMC brand</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">ACs</th>
                <th className="px-3 py-2 text-right font-medium">Of its ACs</th>
                {AGE_BUCKETS.map((b) => <th key={b.key} className="px-3 py-2 text-right font-medium whitespace-nowrap">{b.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.storeCode} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="font-mono font-semibold text-foreground">{r.storeCode}</span>
                    {!r.inStoreMaster && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">not in the sheet</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.city ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.cluster ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.amcBrand ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{fmt(r.tickets)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.acTotal ?? '—'}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.redFlag ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                    {pct(r.share)}{r.redFlag && <span className="ml-1 text-[10px] font-bold">RED</span>}
                  </td>
                  {AGE_BUCKETS.map((b) => (
                    <td key={b.key} className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.buckets[b.key] || '—'}</td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7 + AGE_BUCKETS.length} className="px-3 py-6 text-center text-sm text-muted-foreground">No AC ticket is open in Zoho.</td></tr>
              )}
            </tbody>
            <tfoot className="border-t border-border bg-muted/30 text-xs">
              <tr>
                <td className="px-3 py-2 font-semibold text-foreground" colSpan={4}>All {fmt(totals.stores)} stores</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">{fmt(totals.tickets)}</td>
                <td className="px-3 py-2" colSpan={2} />
                {AGE_BUCKETS.map((b) => <td key={b.key} className="px-3 py-2 text-right font-bold tabular-nums text-foreground">{fmt(totals.buckets[b.key])}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>

        {report.storesNotInMaster.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{report.storesNotInMaster.length} code(s) are not in the AC sheet</span> and are shown exactly as the Zoho ticket has
            them (closed stores, and head-office people who raised an AC ticket under their own name): {report.storesNotInMaster.join(', ')}. They have no city, cluster or AC
            total, so no share can be worked out for them.
          </p>
        )}
      </section>
    </div>
  )
}
