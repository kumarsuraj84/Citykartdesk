import { Users } from 'lucide-react'
import { KpiCard } from '@/components/analytics/Charts'
import type { WorkloadRow } from '@/lib/queries/workload'

export function WorkloadDashboard({ rows, threshold }: { rows: WorkloadRow[]; threshold: number }) {
  const totalOpen = rows.reduce((s, r) => s + r.totalOpen, 0)
  const totalOverdue = rows.reduce((s, r) => s + r.overdueRequests + r.overdueTasks, 0)
  const overloadedCount = rows.filter((r) => r.totalOpen > threshold).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Technicians with Open Work" value={rows.length} accent="#6366F1" />
        <KpiCard label="Total Open Items" value={totalOpen} sub="Requests + tasks" accent="#06B6D4" />
        <KpiCard label="Overdue Items" value={totalOverdue} accent="var(--warning)" />
        <KpiCard label="Over Threshold" value={overloadedCount} sub={`> ${threshold} open`} danger={overloadedCount > 0} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Technician Workload</h2>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open work assigned to anyone right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Technician</th>
                  <th className="py-2 pr-3 text-right">Open Requests</th>
                  <th className="py-2 pr-3 text-right">Overdue Requests</th>
                  <th className="py-2 pr-3 text-right">Open Tasks</th>
                  <th className="py-2 pr-3 text-right">Overdue Tasks</th>
                  <th className="py-2 pr-3 text-right">Total Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const overloaded = r.totalOpen > threshold
                  return (
                    <tr key={r.agentId} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3 font-medium text-foreground">{r.agentName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.openRequests}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${r.overdueRequests > 0 ? 'text-destructive font-semibold' : ''}`}>{r.overdueRequests}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.openTasks}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${r.overdueTasks > 0 ? 'text-destructive font-semibold' : ''}`}>{r.overdueTasks}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <span className={`rounded-full px-2 py-0.5 font-bold ${overloaded ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'text-foreground'}`}>
                          {r.totalOpen}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
