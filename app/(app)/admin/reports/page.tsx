import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileBarChart2, ListTodo, Download, Clock, AlertCircle, ShieldCheck, Users, FolderKanban } from 'lucide-react'
import { AnalyticsDashboard } from './AnalyticsDashboard'
import { SLADashboard } from './SLADashboard'
import { WorkloadDashboard } from './WorkloadDashboard'
import { ProjectsDashboard } from './ProjectsDashboard'
import { TaskDashboard } from '@/components/analytics/TaskDashboard'
import { ReportsClient } from './ReportsClient'
import { ScheduledReportsClient } from './ScheduledReportsClient'
import { CapacityBanner } from '@/components/analytics/CapacityBanner'
import { getScheduledReports } from '@/lib/actions/admin/reports'
import { getAnalytics } from '@/lib/queries/analytics'
import { getTaskAnalytics } from '@/lib/queries/taskAnalytics'
import { getWorkloadReport, WORKLOAD_THRESHOLD } from '@/lib/queries/workload'
import { getProjectAnalytics } from '@/lib/queries/projectAnalytics'
import { getEnabledModules, getCurrentProfile } from '@/lib/queries/profiles'
import type { Period, PeriodParam } from '@/lib/queries/analytics'

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d',  label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
]

type Tab = 'requests' | 'sla' | 'tasks' | 'workload' | 'projects' | 'export' | 'scheduled'

function isValidISODate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime())
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')
  if (!profile.org_id) redirect('/home')

  // Projects is Admin/Owner-only for now (see components/layout/Sidebar.tsx) —
  // a plain manager can still see this Projects tab (module-gated, not
  // role-gated), but /projects and /projects/[id] redirect anyone else to
  // /home, so ProjectsDashboard needs to know not to link there for them.
  const isAdmin = profile.role === 'admin' || profile.role === 'platform_owner'

  const sp           = await searchParams
  const period       = (['7d','30d','90d'].includes(sp.period) ? sp.period : '30d') as Period
  const hasCustomRange = isValidISODate(sp.from) && isValidISODate(sp.to) && sp.from <= sp.to
  const periodParam: PeriodParam = hasCustomRange ? { from: sp.from, to: sp.to } : period
  // Preserves whichever date-window is active (preset or custom) across tab/period links.
  const periodQS = hasCustomRange ? `&from=${sp.from}&to=${sp.to}` : `&period=${period}`
  const enabledMods  = await getEnabledModules()
  const hasRequests  = enabledMods.includes('requests')
  const hasTasks     = enabledMods.includes('tasks')
  const hasProjects  = enabledMods.includes('projects')

  // Determine default tab based on what's enabled
  const defaultTab: Tab = hasRequests ? 'requests' : hasTasks ? 'tasks' : 'export'
  const rawTab = sp.tab as Tab | undefined
  const tab: Tab = rawTab && ['requests','sla','tasks','workload','projects','export','scheduled'].includes(rawTab)
    ? rawTab
    : defaultTab

  // Tabs config — only include enabled modules
  const TABS: { id: Tab; label: string; icon: React.ElementType; show: boolean }[] = [
    { id: 'requests',  label: 'Requests',  icon: FileBarChart2, show: hasRequests },
    { id: 'sla',       label: 'SLA',       icon: ShieldCheck,   show: hasRequests },
    { id: 'tasks',     label: 'Tasks',     icon: ListTodo,      show: hasTasks },
    { id: 'workload',  label: 'Workload',  icon: Users,         show: hasRequests || hasTasks },
    { id: 'projects',  label: 'Projects',  icon: FolderKanban,  show: hasProjects },
    { id: 'export',    label: 'Export',    icon: Download,      show: true },
    { id: 'scheduled', label: 'Scheduled', icon: Clock,         show: true },
  ]

  // Parallel data fetching — only fetch what the active tab needs. Workload is
  // fetched unconditionally (when either module is enabled) since the capacity
  // banner surfaces on every tab, not just the Workload tab itself.
  const [
    requestData,
    taskData,
    workloadRows,
    projectData,
    { data: scheduledReports = [] },
  ] = await Promise.all([
    (tab === 'requests' || tab === 'sla') && hasRequests ? getAnalytics(profile.org_id, periodParam) : Promise.resolve(null),
    tab === 'tasks'    && hasTasks    ? getTaskAnalytics(profile.org_id, periodParam) : Promise.resolve(null),
    hasRequests || hasTasks ? getWorkloadReport(profile.org_id) : Promise.resolve([]),
    tab === 'projects' && hasProjects ? getProjectAnalytics(profile.org_id) : Promise.resolve(null),
    getScheduledReports(),
  ])

  const overloadedAgents = workloadRows.filter((r) => r.totalOpen > WORKLOAD_THRESHOLD)
  const showPeriod = tab === 'requests' || tab === 'sla' || tab === 'tasks'

  return (
    <div className="space-y-5">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Analytics & Reports</h1>
          <p className="text-sm text-muted-foreground">
            {hasRequests && hasTasks
              ? 'KPIs, SLA, TAT, team performance — per module'
              : hasRequests
              ? 'Request KPIs, SLA compliance, TAT, team performance'
              : hasTasks
              ? 'Task KPIs, completion rates, team and agent performance'
              : 'Export and scheduled report management'}
          </p>
        </div>

        {/* Period toggle */}
        {showPeriod && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
              {PERIODS.map((p) => (
                <Link
                  key={p.value}
                  href={`?tab=${tab}&period=${p.value}`}
                  className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                    !hasCustomRange && period === p.value
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </Link>
              ))}
            </div>

            {/* Custom date range */}
            <form className={`flex items-center gap-1.5 rounded-lg border p-0.5 pl-2.5 ${hasCustomRange ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/40'}`}>
              <input type="hidden" name="tab" value={tab} />
              <input
                type="date"
                name="from"
                defaultValue={hasCustomRange ? sp.from : undefined}
                className="bg-transparent text-xs text-foreground outline-none"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <input
                type="date"
                name="to"
                defaultValue={hasCustomRange ? sp.to : undefined}
                className="bg-transparent text-xs text-foreground outline-none"
              />
              <button type="submit" className="rounded-md bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm hover:bg-card transition-colors">
                Apply
              </button>
            </form>
            {hasCustomRange && (
              <Link href={`?tab=${tab}&period=30d`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Clear
              </Link>
            )}
          </div>
        )}
      </div>

      {overloadedAgents.length > 0 && (
        <CapacityBanner overloaded={overloadedAgents} threshold={WORKLOAD_THRESHOLD} />
      )}

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-border gap-1">
        {TABS.filter((t) => t.show).map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <Link
              key={t.id}
              href={`?tab=${t.id}${showPeriod || t.id === 'requests' || t.id === 'tasks' ? periodQS : ''}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </Link>
          )
        })}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────────── */}

      {tab === 'requests' && !hasRequests && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-5 py-4 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">The <strong>Requests</strong> module is not enabled for your organisation. Enable it in Admin → Modules.</p>
        </div>
      )}

      {tab === 'tasks' && !hasTasks && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-5 py-4 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">The <strong>Tasks</strong> module is not enabled for your organisation. Enable it in Admin → Modules.</p>
        </div>
      )}

      {tab === 'requests' && hasRequests && requestData && (
        <AnalyticsDashboard data={requestData} />
      )}

      {tab === 'sla' && hasRequests && requestData && (
        <SLADashboard data={requestData} />
      )}

      {tab === 'tasks' && hasTasks && taskData && (
        <TaskDashboard data={taskData} />
      )}

      {tab === 'workload' && (
        <WorkloadDashboard rows={workloadRows} threshold={WORKLOAD_THRESHOLD} />
      )}

      {tab === 'projects' && !hasProjects && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-5 py-4 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">The <strong>Projects</strong> module is not enabled for your organisation. Enable it in Admin → Modules.</p>
        </div>
      )}

      {tab === 'projects' && hasProjects && projectData && (
        <ProjectsDashboard data={projectData} isAdmin={isAdmin} />
      )}

      {tab === 'export' && <ReportsClient />}

      {tab === 'scheduled' && <ScheduledReportsClient reports={scheduledReports} />}

    </div>
  )
}
