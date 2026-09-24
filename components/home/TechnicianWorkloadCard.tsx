import Link from 'next/link'
import { Users } from 'lucide-react'
import { STATUS_LABELS } from '@/lib/constants/requests'
import type { TechnicianWorkloadRow } from '@/lib/queries/technicianWorkloadShared'
import type { RequestStatus } from '@/types'

function countHref(technicianId: string | null, status: RequestStatus | 'unresolved'): string {
  const assigned = technicianId ?? 'unassigned'
  return `/requests/queue?assigned=${assigned}&status=${status}`
}

function CountCell({ value, href }: { value: number; href: string }) {
  if (value === 0) {
    return <td className="px-3 py-2 text-right text-[12px] tabular-nums text-muted-foreground/40">0</td>
  }
  return (
    <td className="px-3 py-2 text-right">
      <Link href={href} className="text-[12px] font-semibold tabular-nums text-primary hover:underline">
        {value}
      </Link>
    </td>
  )
}

/** Home-dashboard widget for any agent-tier viewer — each technician's active
 *  workload broken down by status, with every count linking to the
 *  pre-filtered Team Queue view for that technician + status. A plain
 *  technician sees only their own team(s) here (RLS-scoped in
 *  getTechnicianWorkloadBoard()); managers/admins see every team. See
 *  lib/queries/requests.ts for the data shape and status set. */
export function TechnicianWorkloadCard({
  rows,
  statuses,
}: {
  rows: TechnicianWorkloadRow[]
  statuses: RequestStatus[]
}) {
  const columnTotals = statuses.map((status) => rows.reduce((sum, r) => sum + (r.counts[status] ?? 0), 0))
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[12px] font-bold text-foreground">Requests by Technician</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Technician</th>
              {statuses.map((status) => (
                <th key={status} className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  {STATUS_LABELS[status]}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.technicianId ?? 'unassigned'} className={row.technicianId === null ? 'bg-muted/20' : undefined}>
                <td className="px-3 py-2 text-[12px] font-medium text-foreground whitespace-nowrap">{row.technicianName}</td>
                {statuses.map((status) => (
                  <CountCell key={status} value={row.counts[status] ?? 0} href={countHref(row.technicianId, status)} />
                ))}
                <td className="px-3 py-2 text-right">
                  <Link href={countHref(row.technicianId, 'unresolved')} className="text-[12px] font-bold tabular-nums text-foreground hover:underline">
                    {row.total}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/30">
              <td className="px-3 py-2 text-[12px] font-bold text-foreground">Total</td>
              {columnTotals.map((total, i) => (
                <td key={statuses[i]} className="px-3 py-2 text-right text-[12px] font-bold tabular-nums text-foreground">{total}</td>
              ))}
              <td className="px-3 py-2 text-right text-[12px] font-bold tabular-nums text-foreground">{grandTotal}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
