import { PageHeader } from '@/components/ui/PageHeader'
import { getZohoDashboard } from '@/lib/zoho/queries'
import { zohoDbStatus } from '@/lib/zoho/db'
import { NotConnected } from './_components/NotConnected'
import type { Counted } from '@/lib/zoho/report-shapes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Zoho data' }

const fmt = (x: number) => x.toLocaleString('en-IN')

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  )
}

/** A plain bar list: every row shows its share of the biggest row, so the shape is readable without a chart library. */
function BarList({ title, rows, note, limit = 10 }: { title: string; rows: Counted[]; note?: string; limit?: number }) {
  const shown = rows.slice(0, limit)
  const max = Math.max(1, ...shown.map((r) => r.total))
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {rows.length > limit && <span className="text-[11px] text-muted-foreground">top {limit} of {rows.length}</span>}
      </div>
      {note && <p className="mb-2 text-[11px] text-muted-foreground">{note}</p>}
      <ul className="space-y-1.5">
        {shown.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-foreground" title={r.label}>{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {fmt(r.total)} tickets
                {r.open > 0 && <span className="font-semibold text-amber-600 dark:text-amber-500">{' · '}{fmt(r.open)} open</span>}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.round((r.total / max) * 100)}%` }} />
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="text-xs text-muted-foreground">Nothing to show.</li>}
      </ul>
    </div>
  )
}

export default async function ZohoOverviewPage() {
  const status = zohoDbStatus()
  if (!status.ready) {
    return (
      <div className="space-y-4">
        <PageHeader title="Zoho data" description="The old Zoho (ManageEngine) tickets, kept in their own database." />
        <NotConnected reason={status.reason} />
      </div>
    )
  }

  let data: Awaited<ReturnType<typeof getZohoDashboard>>
  try {
    data = await getZohoDashboard()
  } catch (e) {
    return (
      <div className="space-y-4">
        <PageHeader title="Zoho data" description="The old Zoho (ManageEngine) tickets, kept in their own database." />
        <NotConnected reason={e instanceof Error ? e.message : 'The Zoho database could not be read.'} />
      </div>
    )
  }

  const { totals, months } = data
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(m.raised, m.finished)))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Zoho data"
        description={
          totals.oldest
            ? `${fmt(totals.tickets)} tickets from the old Zoho system, ${totals.oldest} to ${totals.newest}.`
            : 'The old Zoho (ManageEngine) tickets, kept in their own database.'
        }
      />

      {data.lastSync.ok === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          The last copy from Zoho did not finish cleanly, so the newest tickets may be missing. Last attempt: {data.lastSync.at ?? 'unknown'}.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="All tickets" value={fmt(totals.tickets)} note={totals.oldest ? `${totals.oldest} to ${totals.newest}` : undefined} />
        <Stat label="Still open" value={fmt(totals.open)} note="Zoho's own open statuses" />
        <Stat label="Finished" value={fmt(totals.finished)} note={`${fmt(data.finishedWithoutResolvedDate)} of them have no finish date`} />
        <Stat
          label="Copied up to"
          value={data.lastSync.at ? new Date(data.lastSync.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown'}
          note="the copy runs every 15 minutes"
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="mb-2 text-sm font-semibold text-foreground">How long the open tickets have been waiting</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          {data.openByAge.map((b) => (
            <div key={b.bucket} className="rounded-md border border-border bg-muted/30 p-2">
              <p className="text-[11px] text-muted-foreground">{b.label}</p>
              <p className="text-xl font-bold tabular-nums text-foreground">{fmt(b.tickets)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Raised and finished, month by month</h2>
        <div className="flex items-end gap-1 overflow-x-auto pb-1">
          {months.map((m) => (
            <div key={m.month} className="flex min-w-[42px] flex-1 flex-col items-center gap-1" title={`${m.month}: ${fmt(m.raised)} raised, ${fmt(m.finished)} finished`}>
              <div className="flex h-28 w-full items-end justify-center gap-0.5">
                <div className="w-2.5 rounded-t bg-primary/70" style={{ height: `${Math.max(2, (m.raised / maxMonth) * 100)}%` }} />
                <div className="w-2.5 rounded-t bg-emerald-500/70" style={{ height: `${Math.max(2, (m.finished / maxMonth) * 100)}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{m.month.slice(2)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-primary/70" /> raised</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/70" /> finished</span>
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <BarList title="Services" rows={data.services} limit={20} />
        <BarList title="Statuses" rows={data.statuses} note={'"Reject" and "Rejected" are counted as one.'} limit={12} />
        <BarList title="Technicians" rows={data.technicians} note="Zoho's own technician names, kept as they were." limit={12} />
        <BarList title="Who raises the most" rows={data.stores} note="Store codes and head-office mailboxes, as the Zoho ticket has them." limit={12} />
        <BarList title="Priorities" rows={data.priorities} limit={8} />
      </div>
    </div>
  )
}
