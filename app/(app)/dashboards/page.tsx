import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AnalyticsDashboard } from '@/app/(app)/admin/reports/AnalyticsDashboard'
import { GroupFilter } from '@/components/analytics/GroupFilter'
import { CapacityBanner } from '@/components/analytics/CapacityBanner'
import { highestOpenAgents } from '@/lib/analytics/highest-open'
import { getWorkloadReport } from '@/lib/queries/workload'
import { getAnalytics, isPeriod, PERIOD_OPTIONS, type Period } from '@/lib/queries/analytics'
import { getTechnicianWorkloadBoard } from '@/lib/queries/requests'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { getSelectableGroups } from '@/lib/queries/dashboardGroups'
import { resolveReportAccess } from '@/lib/reporting/access'
import { parseGroupsParam, narrowScopeToGroups, teamIdsForScope } from '@/lib/analytics/group-filter'


// The Technician-tier "Dashboards" page: the same widgets as the admin analytics
// dashboard, limited to the technician's own technician groups. It lives outside
// /admin because app/(app)/admin/layout.tsx redirects every role but
// admin/manager/platform_owner to /home — which is what made the sidebar's
// Dashboards link bounce technicians.
export default async function TechnicianDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/admin/reports')
  if (profile.role !== 'agent') redirect('/home')

  const access = resolveReportAccess(profile, 'requests')
  if ('error' in access) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  const sp = await searchParams
  const period = isPeriod(sp.period) ? (sp.period as Period) : '30d'

  // A technician in several groups can pick which of them the dashboard shows.
  const groups = await getSelectableGroups(profile, access.scope)
  const { scope, selected } = narrowScopeToGroups(access.scope, parseGroupsParam(sp.groups), groups.map((g) => g.id))
  const groupsQS = selected.length ? `&groups=${selected.join(',')}` : ''

  const [analytics, workload, workloadRows] = await Promise.all([
    getAnalytics(profile.org_id, period, scope),
    getTechnicianWorkloadBoard(profile.org_id, scope),
    // Who carries the biggest backlog in the technician's own groups — same banner managers see.
    getWorkloadReport(profile.org_id, teamIdsForScope(scope)),
  ])
  const topOpenAgents = highestOpenAgents(workloadRows)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Activity and performance for your technician groups.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GroupFilter groups={groups} selected={selected} />
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
            {PERIOD_OPTIONS.map((o) => (
              <Link
                key={o.value}
                href={`?period=${o.value}${groupsQS}`}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  period === o.value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {o.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
      {topOpenAgents.length > 0 && <CapacityBanner agents={topOpenAgents} />}
      <AnalyticsDashboard data={analytics} technicianWorkload={workload} userId={profile.id} groupIds={selected} />
    </div>
  )
}
