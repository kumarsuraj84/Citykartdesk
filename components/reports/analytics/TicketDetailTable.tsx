import Link from 'next/link'
import type { DetailRow } from '@/lib/reporting/analytics/ticket-detail'
import { createdDate, detailBuckets, bucketTotals } from '@/lib/reporting/analytics/ticket-detail-xlsx'
import { STATUS_LABELS } from '@/lib/constants/requests'

// Same columns as the summary (Responsible, Category, Sub Category, one column per age bucket, Grand Total)
// with the ticket details added in between: one line per ticket, a 1 in the bucket the ticket falls in.
// The heading row stays on top while the lines scroll, and Responsible / Category / Sub Category stay at the
// left while the rest scrolls sideways (as in the summary). Frozen cells are solid so nothing shows through,
// and widths are fixed so the left offsets of the frozen columns are exact. Tailwind classes must be literal.
const LEAD_W = [150, 190, 210, 170, 300, 112, 170, 130, 90, 110, 90] // Responsible … Age (days)
const BUCKET_W = 84
const TOTAL_W = 96
const TH = 'sticky top-0 z-10 bg-primary px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap'
const LEAD_HEADINGS = ['Responsible', 'Category', 'Sub Category', 'Requester', 'Subject', 'Ticket No', 'Service', 'Status', 'Priority', 'Created', 'Age (days)']

const FROZEN_TH = [
  'md:z-30 md:left-0',
  'md:z-30 md:left-[150px]',
  'md:z-30 md:left-[340px] border-r border-primary-foreground/30',
]
const FROZEN_TD = [
  'md:sticky md:z-[5] md:left-0',
  'md:sticky md:z-[5] md:left-[150px]',
  'md:sticky md:z-[5] md:left-[340px] border-r border-border/70',
]

export function TicketDetailTable({ rows }: { rows: DetailRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No tickets match these filters</p>
        <p className="mt-1 text-xs text-muted-foreground">Try a wider date range, include more statuses or services.</p>
      </div>
    )
  }
  const buckets = detailBuckets(rows)
  const totals = bucketTotals(rows, buckets)
  const statusLabel = (s: string) => (STATUS_LABELS as Record<string, string>)[s] ?? s
  const width = LEAD_W.reduce((a, b) => a + b, 0) + buckets.length * BUCKET_W + TOTAL_W
  const td = 'px-3 py-2 text-[12px] align-top break-words'
  const frozen = 'bg-card group-hover:bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]'
  const center = 'text-center tabular-nums'

  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
      <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width, minWidth: '100%' }}>
        <colgroup>
          {LEAD_W.map((w, i) => <col key={i} style={{ width: w }} />)}
          {buckets.map((b) => <col key={b} style={{ width: BUCKET_W }} />)}
          <col style={{ width: TOTAL_W }} />
        </colgroup>
        <thead>
          <tr className="text-primary-foreground">
            {LEAD_HEADINGS.map((c, i) => <th key={c} className={`${TH} ${FROZEN_TH[i] ?? ''}`}>{c}</th>)}
            {buckets.map((b) => <th key={b} className={`${TH} text-center`}>{b}</th>)}
            <th className={`${TH} text-center`}>Grand Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="group border-t border-border/60 hover:bg-muted/30">
              <td className={`${td} ${frozen} ${FROZEN_TD[0]} font-semibold`}>{r.technician}</td>
              <td className={`${td} ${frozen} ${FROZEN_TD[1]}`}>{r.category}</td>
              <td className={`${td} ${frozen} ${FROZEN_TD[2]} text-muted-foreground`}>{r.subCategory}</td>
              <td className={td}>{r.requester}</td>
              <td className={td}>{r.subject}</td>
              <td className={`${td} font-mono text-[11px]`}>
                <Link href={`/requests/${r.id}?from=%2Frequests%2Fqueue`} className="font-semibold text-primary hover:underline">{r.ticketNo}</Link>
              </td>
              <td className={td}>{r.service}</td>
              <td className={td}>{statusLabel(r.status)}</td>
              <td className={`${td} capitalize`}>{r.priority}</td>
              <td className={`${td} whitespace-nowrap`}>{createdDate(r.createdAt)}</td>
              <td className={`${td} ${center}`}>{r.ageDays}</td>
              {buckets.map((b) => <td key={b} className={`${td} ${center}`}>{r.ageBucket === b ? 1 : ''}</td>)}
              <td className={`${td} ${center} font-semibold`}>1</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted font-semibold">
            <td className={`${td} bg-muted ${FROZEN_TD[0]}`}>Grand Total</td>
            <td className={`${td} bg-muted ${FROZEN_TD[1]}`} />
            <td className={`${td} bg-muted ${FROZEN_TD[2]}`} />
            {LEAD_W.slice(3).map((_, i) => <td key={i} className={td} />)}
            {buckets.map((b) => <td key={b} className={`${td} ${center}`}>{totals[b] || ''}</td>)}
            <td className={`${td} ${center}`}>{rows.length}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
