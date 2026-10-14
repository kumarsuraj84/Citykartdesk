import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AnalyticsDashboard } from '@/app/(app)/admin/reports/AnalyticsDashboard'
import { GroupFilter } from '@/components/analytics/GroupFilter'
import { StoreFilter } from '@/components/analytics/StoreFilter'
import { parseStoreFilter, storeFilterQS } from '@/lib/analytics/store-filter'
import { CapacityBanner } from '@/components/analytics/CapacityBanner'
import { highestOpenAgents } from '@/lib/analytics/highest-open'
import { getWorkloadReport } from '@/lib/queries/workload'
import { getAnalytics, isPeriod, PERIOD_OPTIONS, type Period } from '@/lib/queries/analytics'
import { getTechnicianWorkloadBoard } from '@/lib/queries/requests'
import { getCurrentProfile, getEnabledModules, getDirectReports } from '@/lib/queries/profiles'
import { PeopleFilter } from '@/components/analytics/PeopleFilter'
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
  // a normal user who has people reporting to them sees the Dashboard for those people's tickets; any other normal user has none
  const reports = profile.role === 'user' ? await getDirectReports(profile.id) : []
  const reportIds = reports.map((r) => r.id)
  const isTeamView = profile.role === 'user' && reportIds.length > 0
  if (profile.role !== 'agent' && !isTeamView) redirect('/home')

  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  const sp = await searchParams
  // a person with a team can narrow it to some of their technicians (tickets assigned to them) and / or requesters (tickets raised by them)
  const technicians = reports.filter((r) => r.role !== 'user').map((r) => ({ id: r.id, name: r.full_name }))
  const requesters = reports.filter((r) => r.role === 'user').map((r) => ({ id: r.id, name: r.full_name }))
  const pickedTech = parseGroupsParam(sp.tech).filter((id) => technicians.some((t) => t.id === id))
  const pickedRequesters = parseGroupsParam(sp.requester).filter((id) => requesters.some((r) => r.id === id))
  const peopleQS = `${pickedTech.length ? `&tech=${pickedTech.join(',')}` : ''}${pickedRequesters.length ? `&requester=${pickedRequesters.join(',')}` : ''}`
  const access = isTeamView
    ? { scope: { kind: 'reports' as const, userId: profile.id, reportIds, techIds: pickedTech, requesterIds: pickedRequesters } }
    : resolveReportAccess(profile, 'requests')
  if ('error' in access) redirect('/home')
  const period = isPeriod(sp.period) ? (sp.period as Period) : '30d'

  // A technician in several groups can pick which of them the dashboard shows.
  const groups = isTeamView ? [] : await getSelectableGroups(profile, access.scope)
  const { scope, selected } = isTeamView ? { scope: access.scope, selected: [] as string[] } : narrowScopeToGroups(access.scope, parseGroupsParam(sp.groups), groups.map((g) => g.id))
  const groupsQS = selected.length ? `&groups=${selected.join(',')}` : ''
  const storeFilter = parseStoreFilter(sp)
  const storeQS = storeFilterQS(storeFilter)

  const [analytics, workload, workloadRows] = await Promise.all([
    getAnalytics(profile.org_id, period, scope, storeFilter),
    // (a team view has no technician workload board or capacity banner: those are about technician groups)
    isTeamView ? Promise.resolve([]) : getTechnicianWorkloadBoard(profile.org_id, scope),
    // Who carries the biggest backlog in the technician's own groups — same banner managers see.
    isTeamView ? Promise.resolve([]) : getWorkloadReport(profile.org_id, teamIdsForScope(scope)),
  ])
  const topOpenAgents = highestOpenAgents(workloadRows)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{isTeamView ? 'Tickets raised by and assigned to the people who report to you.' : 'Activity and performance for your technician groups.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isTeamView && <GroupFilter groups={groups} selected={selected} />}
          {isTeamView && <PeopleFilter param="tech" noun="technicians" people={technicians} selected={pickedTech} />}
          {isTeamView && <PeopleFilter param="requester" noun="requesters" people={requesters} selected={pickedRequesters} />}
          <StoreFilter combos={analytics.stores.combos} selected={storeFilter} />
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
            {PERIOD_OPTIONS.map((o) => (
              <Link
                key={o.value}
                href={`?period=${o.value}${groupsQS}${peopleQS}${storeQS}`}
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
      <AnalyticsDashboard data={analytics} technicianWorkload={workload} userId={profile.id} groupIds={selected} groups={groups} people={isTeamView ? { techIds: pickedTech, requesterIds: pickedRequesters } : undefined} />
    </div>
  )
}
