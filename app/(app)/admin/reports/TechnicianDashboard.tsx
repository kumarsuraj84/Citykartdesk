import { Clock } from 'lucide-react'
import { AgingBar } from '@/components/analytics/Charts'
import { TechnicianWorkloadCard } from '@/components/home/TechnicianWorkloadCard'
import { ACTIVE_TECH_STATUSES, type TechnicianWorkloadRow } from '@/lib/queries/technicianWorkloadShared'
import type { DailyActivity, BacklogAging } from '@/lib/queries/analytics'

/**
 * The Technician-tier view of "Dashboards" — intentionally NOT the full
 * AnalyticsDashboard. That page's other widgets (SLA breach detail, every
 * agent's workload/leaderboard, approval analytics, Export, Scheduled
 * reports) are Manager+ information; a plain technician gets just their own
 * activity pulse (org-wide counts, no names attached) and their own row of
 * the workload table. See app/(app)/admin/reports/page.tsx for how the two
 * views are chosen, and lib/reporting/access.ts for the scope that already
 * narrows `rows` down to this viewer's own requests before it ever reaches
 * this component.
 */
export function TechnicianDashboard({ dailyActivity, backlogAging, rows }: {
  dailyActivity: DailyActivity
  backlogAging: BacklogAging
  rows: TechnicianWorkloadRow[]
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your activity today, and what&apos;s on your plate.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Daily Activity</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pending Now</p>
            <p className="text-xl font-bold text-foreground mt-0.5">{dailyActivity.pendingNow}</p>
          </div>
          {([
            { label: 'Created', stat: dailyActivity.created },
            { label: 'Closed', stat: dailyActivity.closed },
            { label: 'Assigned', stat: dailyActivity.assigned },
          ]).map(({ label, stat }) => (
            <div key={label} className="rounded-lg border border-border p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">{label}</p>
              <div className="flex items-center justify-around">
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{stat.today}</p>
                  <p className="text-[10px] text-muted-foreground">Today</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-muted-foreground">{stat.yesterday}</p>
                  <p className="text-[10px] text-muted-foreground">Yesterday</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <TechnicianWorkloadCard rows={rows} statuses={ACTIVE_TECH_STATUSES} />
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Backlog Aging (Open Tickets)</h2>
        </div>
        <AgingBar aging={backlogAging} />
      </div>
    </div>
  )
}
