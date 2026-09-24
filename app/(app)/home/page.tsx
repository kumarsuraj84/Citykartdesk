import Link from 'next/link'
import { Suspense } from 'react'
import {
  ArrowRight, Inbox, CheckCircle2, LayoutGrid, Plus,
  AlertTriangle, ListTodo, CalendarClock, Users, ShieldCheck,
  FileText, Zap, Bell, Circle, Star, FolderKanban, Flag,
} from 'lucide-react'
import { redirect } from 'next/navigation'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { autoCloseRequests } from '@/lib/actions/requests'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/requests/RequestBadges'
import { SLABadge } from '@/components/requests/SLABadge'
import { getHomeProjectsSummary, type HomeProjectsSummary } from '@/lib/queries/projects'
import { ProjectStatusBadge } from '@/components/projects/ProjectStatusBadge'
import type { RequestStatus, RequestPriority } from '@/types'

/* ── types ──────────────────────────────────────────────────────────────────── */

type MyRequest = {
  id: string; request_no: string; title: string
  status: RequestStatus; priority: RequestPriority
  created_at: string; updated_at: string
  resolution_due_at: string | null; response_due_at: string | null
  service: { name: string; icon: string | null } | null
}

type QueueRequest = {
  id: string; request_no: string; title: string
  status: RequestStatus; priority: RequestPriority
  created_at: string
  resolution_due_at: string | null; response_due_at: string | null
  requester: { full_name: string } | null
}

type MyTask = {
  id: string; title: string; status: string; priority: string
  due_date: string | null; task_type: string; request_id: string | null
  request: { request_no: string } | null
}

type NeedsAttentionRequest = {
  id: string; request_no: string; title: string
  status: RequestStatus; updated_at: string
  resolution_due_at: string | null; response_due_at: string | null
}

// Shape of the JSON payload returned by the get_home_dashboard RPC (see
// supabase/migrations/20240101000044_get_home_dashboard.sql). The RPC's
// generated return type is generic `Json`, so we narrow it to the fields
// this page actually reads.
interface HomeDashboardData {
  counts?: Record<string, number>
  my_requests?: MyRequest[]
  needs_attention?: NeedsAttentionRequest[]
  my_queue?: QueueRequest[]
  tasks_overdue?: MyTask[]
  tasks_today?: MyTask[]
  tasks_upcoming?: MyTask[]
  tasks_open?: MyTask[]
}

/* ── KPI card ────────────────────────────────────────────────────────────────── */

function KpiCard({ label, value, sublabel, accent, href, danger }: {
  label: string; value: number | string; sublabel: string
  accent: string; href?: string; danger?: boolean
}) {
  const numVal = typeof value === 'number' ? value : 0
  const isAlert = danger && numVal > 0
  const inner = (
    <div className={`relative flex flex-col gap-1 rounded-xl border overflow-hidden px-4 py-3.5 bg-card transition-all group-hover:shadow-md group-hover:-translate-y-0.5 ${isAlert ? 'border-destructive/30 bg-destructive/5' : 'border-border'}`}>
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: isAlert ? 'var(--destructive)' : accent }} />
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground pt-0.5">{label}</p>
      <p className={`font-extrabold leading-none tabular-nums ${isAlert ? 'text-destructive' : 'text-foreground'}`}
        style={{ fontSize: '28px', letterSpacing: '-1px' }}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{sublabel}</p>
    </div>
  )
  return href ? <Link href={href} className="block group">{inner}</Link> : <div className="group">{inner}</div>
}

/* ── compact empty state ─────────────────────────────────────────────────────── */

function InlineEmpty({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-5 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0 opacity-40" />
      <p className="text-[12px]">{text}</p>
    </div>
  )
}

/* ── section header ──────────────────────────────────────────────────────────── */

function SectionHeader({ icon: Icon, title, count, href, accentClass }: {
  icon: React.ElementType; title: string
  count?: number; href?: string; accentClass?: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${accentClass ?? 'text-muted-foreground'}`} />
        <span className="text-[12px] font-semibold text-foreground">{title}</span>
        {count != null && count > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{count}</span>
        )}
      </div>
      {href && (
        <Link href={href} className="text-[11px] font-medium text-primary hover:underline">View all</Link>
      )}
    </div>
  )
}

/* ── request row ─────────────────────────────────────────────────────────────── */

function RequestRow({ req, showRequester, showService }: {
  req: {
    id: string; request_no: string; title: string
    status: RequestStatus; priority?: RequestPriority
    resolution_due_at: string | null; response_due_at: string | null
    requester?: { full_name: string } | null
    service?: { name: string; icon: string | null } | null
  }
  showRequester?: boolean; showService?: boolean
}) {
  const priorityColor: Record<string, string> = {
    critical: 'bg-destructive', high: 'bg-warning', medium: 'bg-warning/60', low: 'bg-muted-foreground/40',
  }
  const icon = showService ? (req.service?.icon ?? '📋') : null
  return (
    <Link href={`/requests/${req.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group">
      {icon
        ? <span className="shrink-0 text-base leading-none w-5 text-center">{icon}</span>
        : <span className={`h-2 w-2 shrink-0 rounded-full mt-0.5 ${(req.priority && priorityColor[req.priority]) ?? 'bg-muted-foreground/40'}`} />
      }
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
          <span className="font-mono text-[11px] text-muted-foreground">{req.request_no}</span>
          <StatusBadge status={req.status} size="sm" />
          <SLABadge resolutionDueAt={req.resolution_due_at} responseDueAt={req.response_due_at} status={req.status} showLabel />
        </div>
        <p className="truncate text-[12px] font-medium text-foreground">{req.title}</p>
        {showRequester && req.requester && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{req.requester.full_name}</p>
        )}
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  )
}

/* ── task row ────────────────────────────────────────────────────────────────── */

function TaskRow({ task, bucket }: {
  task: MyTask
  bucket: 'overdue' | 'today' | 'upcoming' | 'open'
}) {
  const priorityColor: Record<string, string> = {
    critical: 'bg-destructive', high: 'bg-warning', medium: 'bg-warning/60', low: 'bg-muted-foreground/40',
  }
  const statusIcon: Record<string, { cls: string }> = {
    open:        { cls: 'text-muted-foreground' },
    in_progress: { cls: 'text-info' },
    on_hold:     { cls: 'text-warning' },
  }
  const dueLabel = task.due_date
    ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  const bucketChip = {
    overdue:  <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive shrink-0">Overdue</span>,
    today:    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold text-warning shrink-0">Due today</span>,
    upcoming: dueLabel ? <span className="text-[10px] text-info font-semibold shrink-0">{dueLabel}</span> : null,
    open:     null,
  }[bucket]

  return (
    <Link href={`/tasks/${task.id}`}
      className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group">
      <span className={`h-2 w-2 shrink-0 rounded-full mt-1.5 ${priorityColor[task.priority] ?? 'bg-muted-foreground/40'}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-foreground">{task.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <Circle className={`h-3 w-3 ${statusIcon[task.status]?.cls ?? 'text-muted-foreground'}`} />
          <span className="text-[10px] text-muted-foreground capitalize">{task.status.replace('_', ' ')}</span>
          {task.request && (
            <span className="font-mono text-[10px] text-muted-foreground">· {task.request.request_no}</span>
          )}
          {bucketChip}
        </div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
    </Link>
  )
}

/* ── task bucket group ───────────────────────────────────────────────────────── */

function TaskBucket({ label, count, accent, children }: {
  label: string; count: number; accent: string; children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/30 border-y border-border">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: accent }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{label}</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  )
}

/* ── quick action ────────────────────────────────────────────────────────────── */

function QuickAction({ href, icon: Icon, label, sublabel, dashed }: {
  href: string; icon: React.ElementType; label: string; sublabel: string; dashed?: boolean
}) {
  return (
    <Link href={href} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all hover:shadow-sm group ${dashed ? 'border-dashed border-border bg-card/60 hover:bg-card' : 'border-border bg-card hover:border-primary/30'}`}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
        <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-foreground">{label}</p>
        <p className="text-[10px] text-muted-foreground">{sublabel}</p>
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
    </Link>
  )
}

/* ── Dashboard skeleton shown while RPC resolves ─────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_264px] animate-pulse">
      <div className="min-w-0 space-y-4">
        <div className="flex gap-3 border-b border-border pb-0.5">
          <div className="h-7 w-20 rounded-md bg-muted" />
          <div className="h-7 w-16 rounded-md bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card px-4 py-3.5 space-y-2">
              <div className="h-2 w-16 rounded bg-muted" />
              <div className="h-7 w-10 rounded bg-muted" />
              <div className="h-2 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-3 w-12 rounded bg-muted" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
              <div className="h-2 w-2 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 rounded bg-muted" style={{ width: `${55 + i * 10}%` }} />
                <div className="h-2 w-32 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="h-2 w-20 rounded bg-muted mb-3" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="h-7 w-7 rounded-lg bg-muted shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-2 w-32 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── async component that resolves the RPC and renders dashboard ─────────── */

async function DashboardBody({
  dashPromise,
  projectsSummaryPromise,
  hasRequests,
  hasTasks,
  hasProjects,
  isAgent,
  isManager,
  tab,
}: {
  dashPromise: Promise<HomeDashboardData | null>
  projectsSummaryPromise: Promise<HomeProjectsSummary>
  hasRequests: boolean
  hasTasks: boolean
  hasProjects: boolean
  isAgent: boolean
  isManager: boolean
  tab: string
}) {
  const [dashData, projectsSummary] = await Promise.all([
    dashPromise,
    projectsSummaryPromise,
  ])

  const counts         = dashData?.counts ?? {}
  const myRequests     = dashData?.my_requests     ?? []
  const needsAttention = dashData?.needs_attention ?? []
  const myQueue        = dashData?.my_queue        ?? []

  const myOpenCount             = counts.my_open            ?? 0
  const resolvedCount           = counts.resolved           ?? 0
  const needsAttentionCount     = counts.needs_attention    ?? 0
  const pendingApprovalCount    = counts.pending_approvals  ?? 0
  const slaBreachedCount        = counts.sla_breached       ?? 0
  const teamRequestsOpen        = counts.team_open          ?? 0
  const teamRequestsSlaBreached = counts.team_sla           ?? 0
  const myTasksOpen             = counts.tasks_open         ?? 0
  const myTasksDueToday         = counts.tasks_today        ?? 0
  const myTasksOverdue          = counts.tasks_overdue      ?? 0
  const myTasksDoneWeek         = counts.tasks_done_week    ?? 0
  const teamTasksOpen           = counts.team_tasks_open    ?? 0
  const teamTasksOverdue        = counts.team_tasks_overdue ?? 0

  const overdueTaskItems  = dashData?.tasks_overdue  ?? []
  const todayTaskItems    = dashData?.tasks_today    ?? []
  const upcomingTaskItems = dashData?.tasks_upcoming ?? []
  const openTaskItems     = dashData?.tasks_open     ?? []

  const hasUrgentRequests = slaBreachedCount > 0 || pendingApprovalCount > 0 || needsAttentionCount > 0
  const hasUrgentTasks    = myTasksOverdue > 0 || myTasksDueToday > 0

  const totalTaskItems =
    overdueTaskItems.length + todayTaskItems.length +
    upcomingTaskItems.length + openTaskItems.length

  const projectsAtRiskCount = projectsSummary.atRiskCount

  const TABS = [
    { id: 'requests' as const, label: 'Requests', icon: FileText, show: hasRequests,
      badge: isAgent ? myQueue.length : myOpenCount },
    { id: 'tasks' as const, label: 'Tasks', icon: ListTodo, show: hasTasks && (isAgent || isManager),
      badge: myTasksOverdue + myTasksDueToday },
    { id: 'projects' as const, label: 'Projects', icon: FolderKanban, show: hasProjects,
      badge: projectsAtRiskCount },
  ].filter(t => t.show)

  const showTabs = TABS.length > 1

  return (
    <>
      {/* urgency pill — rendered inline above the tab bar */}
      {((tab === 'requests' && hasUrgentRequests) || (tab === 'tasks' && hasUrgentTasks) || (tab === 'projects' && projectsAtRiskCount > 0)) && (
        <div className="flex justify-end">
          <div className="flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-1 shrink-0">
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-[10px] font-semibold text-destructive">Action needed</span>
          </div>
        </div>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      {showTabs && (
        <div className="flex border-b border-border gap-0">
          {TABS.map((t) => {
            const Icon   = t.icon
            const active = tab === t.id
            return (
              <Link key={t.id} href={`?tab=${t.id}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px ${
                  active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}>
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.badge > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>{t.badge}</span>
                )}
              </Link>
            )
          })}
        </div>
      )}

      {/* ── Page body ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_264px]">

        {/* LEFT — tab content */}
        <div className="min-w-0 space-y-4">

          {/* REQUESTS TAB */}
          {tab === 'requests' && hasRequests && (() => {
            const showApprovalBanner  = isManager && pendingApprovalCount > 0
            const showSlaBanner       = isAgent && slaBreachedCount > 0
            const showAttentionBanner = !isAgent && needsAttentionCount > 0

            return (
              <div className="space-y-4">

                {(showSlaBanner || showApprovalBanner || showAttentionBanner) && (
                  <div className="space-y-2">
                    {showSlaBanner && (
                      <Link href="/requests?sla=breached"
                        className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 hover:bg-destructive/10 transition-colors">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        </div>
                        <div className="flex-1">
                          <p className="text-[12px] font-bold text-destructive">{slaBreachedCount} SLA breach{slaBreachedCount > 1 ? 'es' : ''} — resolution deadline passed</p>
                          <p className="text-[11px] text-destructive/80">These need immediate attention</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-destructive/60 shrink-0" />
                      </Link>
                    )}
                    {showApprovalBanner && (
                      <Link href="/approvals"
                        className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 hover:bg-warning/10 transition-colors">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10">
                          <ShieldCheck className="h-4 w-4 text-warning" />
                        </div>
                        <div className="flex-1">
                          <p className="text-[12px] font-bold text-warning">{pendingApprovalCount} request{pendingApprovalCount > 1 ? 's' : ''} pending your approval</p>
                          <p className="text-[11px] text-warning/80">Review and take action to unblock these requests</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-warning/60 shrink-0" />
                      </Link>
                    )}
                    {showAttentionBanner && (
                      <Link href="/requests?status=waiting_user"
                        className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 hover:bg-warning/10 transition-colors">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10">
                          <Bell className="h-4 w-4 text-warning" />
                        </div>
                        <div className="flex-1">
                          <p className="text-[12px] font-bold text-warning">{needsAttentionCount} request{needsAttentionCount > 1 ? 's' : ''} waiting for your response</p>
                          <p className="text-[11px] text-warning/80">The team is waiting on you to move these forward</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-warning/60 shrink-0" />
                      </Link>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {isAgent ? (<>
                    <KpiCard label="My Queue"     value={myQueue.length}      sublabel="Assigned to me"    accent="#1B2559" href="/requests?assigned=me" />
                    <KpiCard label="Currently Breached" value={slaBreachedCount}    sublabel="Overdue resolution" accent="#EF4444" href="/requests?sla=breached" danger />
                    <KpiCard label="Needs Reply"  value={needsAttentionCount} sublabel="Waiting on user"   accent="#F97316" href="/requests?status=waiting_user" />
                    <KpiCard label="Resolved"     value={resolvedCount}       sublabel="All time"          accent="#10B981" href="/requests?status=resolved" />
                  </>) : isManager ? (<>
                    <KpiCard label="Team Open"        value={teamRequestsOpen}        sublabel="Active tickets"    accent="#1B2559" href="/requests" />
                    <KpiCard label="Currently Breached"     value={teamRequestsSlaBreached} sublabel="Overdue resolution" accent="#EF4444" href="/requests?sla=breached" danger />
                    <KpiCard label="Pending Approval" value={pendingApprovalCount}    sublabel="Awaiting review"   accent="#8B5CF6" href="/approvals" />
                    <KpiCard label="My Open"          value={myOpenCount}             sublabel="My requests"       accent="#10B981" href="/requests?requester=me" />
                  </>) : (<>
                    <KpiCard label="Needs Attention"  value={needsAttentionCount}  sublabel="Waiting on you"   accent="#F97316" href="/requests?status=waiting_user" />
                    <KpiCard label="My Open"          value={myOpenCount}          sublabel="In progress"      accent="#1B2559" href="/requests" />
                    <KpiCard label="Resolved"         value={resolvedCount}        sublabel="All time"         accent="#10B981" href="/requests?status=resolved" />
                    <KpiCard label="Pending Approval" value={pendingApprovalCount} sublabel="Awaiting review"  accent="#8B5CF6" href="/approvals" />
                  </>)}
                </div>

                {isAgent && (myQueue.length > 0 || !isManager) && (
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <SectionHeader icon={Inbox} title="My Queue" count={myQueue.length} href="/requests?assigned=me" />
                    {myQueue.length > 0 ? (
                      <div className="divide-y divide-border">
                        {myQueue.map(r => <RequestRow key={r.id} req={r} showRequester />)}
                      </div>
                    ) : (
                      <InlineEmpty icon={CheckCircle2} text="Queue is clear — no requests assigned to you." />
                    )}
                  </div>
                )}

                {!isAgent && needsAttention.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <SectionHeader icon={Bell} title="Needs Your Attention" count={needsAttentionCount}
                      href="/requests?status=waiting_user" accentClass="text-warning" />
                    <div className="divide-y divide-border">
                      {needsAttention.map(r => <RequestRow key={r.id} req={r} showService />)}
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <SectionHeader icon={FileText} title="My Requests" count={myOpenCount} href="/requests" />
                  {myRequests.length > 0 ? (
                    <div className="divide-y divide-border">
                      {myRequests.map(r => <RequestRow key={r.id} req={r} showService />)}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <Inbox className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                      <p className="text-[13px] font-medium text-foreground">No open requests</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">Submit a request to get help from your team</p>
                      <Link href="/services"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
                        <LayoutGrid className="h-3.5 w-3.5" />
                        Browse Services
                      </Link>
                    </div>
                  )}
                </div>

              </div>
            )
          })()}

          {/* TASKS TAB */}
          {tab === 'tasks' && hasTasks && (isAgent || isManager) && (() => {
            const hasOverdue = myTasksOverdue > 0
            const hasToday   = myTasksDueToday > 0

            return (
              <div className="space-y-4">

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <KpiCard label="My Tasks"      value={myTasksOpen}     sublabel="Open tasks"        accent="#059669" href="/tasks" />
                  <KpiCard label="Due Today"      value={myTasksDueToday} sublabel="Due by end of day" accent="#F97316" href="/tasks?filter=due_today" danger={hasToday} />
                  <KpiCard label="Overdue"        value={myTasksOverdue}  sublabel="Past due date"     accent="#EF4444" href="/tasks?filter=overdue" danger />
                  <KpiCard label="Done This Week" value={myTasksDoneWeek} sublabel="Completed last 7d" accent="#059669" href="/tasks?filter=done_week" />
                </div>

                {(hasOverdue || hasToday) && (
                  <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 mt-0.5">
                      <Star className="h-4 w-4 text-warning" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[12px] font-bold text-warning">Today&apos;s Focus</p>
                      <p className="text-[11px] text-warning/80 mt-0.5">
                        {hasOverdue && `${myTasksOverdue} overdue task${myTasksOverdue > 1 ? 's' : ''}`}
                        {hasOverdue && hasToday && ' and '}
                        {hasToday && `${myTasksDueToday} task${myTasksDueToday > 1 ? 's' : ''} due today`}
                        {' — clear these before picking up new work.'}
                      </p>
                    </div>
                    <Link href="/tasks?filter=overdue" className="text-[11px] font-semibold text-warning hover:underline whitespace-nowrap mt-0.5">
                      View →
                    </Link>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <SectionHeader icon={ListTodo} title="My Tasks" count={myTasksOpen}
                    href="/tasks" accentClass="text-success" />

                  {totalTaskItems === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-success/60 mb-2" />
                      <p className="text-[13px] font-medium text-foreground">All clear!</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">No open tasks assigned to you right now.</p>
                    </div>
                  ) : (
                    <div>
                      <TaskBucket label="Overdue" count={overdueTaskItems.length} accent="#EF4444">
                        <div className="divide-y divide-border">
                          {overdueTaskItems.map(t => <TaskRow key={t.id} task={t} bucket="overdue" />)}
                        </div>
                      </TaskBucket>
                      <TaskBucket label="Due Today" count={todayTaskItems.length} accent="#F97316">
                        <div className="divide-y divide-border">
                          {todayTaskItems.map(t => <TaskRow key={t.id} task={t} bucket="today" />)}
                        </div>
                      </TaskBucket>
                      <TaskBucket label="Upcoming — next 7 days" count={upcomingTaskItems.length} accent="#3B82F6">
                        <div className="divide-y divide-border">
                          {upcomingTaskItems.map(t => <TaskRow key={t.id} task={t} bucket="upcoming" />)}
                        </div>
                      </TaskBucket>
                      <TaskBucket label="Open — no due date" count={openTaskItems.length} accent="#94A3B8">
                        <div className="divide-y divide-border">
                          {openTaskItems.map(t => <TaskRow key={t.id} task={t} bucket="open" />)}
                        </div>
                      </TaskBucket>
                    </div>
                  )}

                  {totalTaskItems > 0 && myTasksOpen > totalTaskItems && (
                    <div className="border-t border-border px-4 py-2.5">
                      <Link href="/tasks" className="text-[11px] font-medium text-primary hover:underline">
                        View all {myTasksOpen} tasks →
                      </Link>
                    </div>
                  )}
                </div>

                {isManager && (
                  <div className="grid grid-cols-2 gap-3">
                    <Link href="/tasks?filter=team"
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 hover:shadow-sm transition-all hover:border-primary/30 group">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-info/10 group-hover:bg-info/15 transition-colors">
                        <Users className="h-4 w-4 text-info" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Team Open Tasks</p>
                        <p className="text-[22px] font-extrabold text-foreground leading-tight tabular-nums">{teamTasksOpen}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </Link>
                    <Link href="/tasks?filter=team_overdue"
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 hover:shadow-sm transition-all group ${
                        teamTasksOverdue > 0 ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10' : 'border-border bg-card hover:border-primary/30'
                      }`}>
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${teamTasksOverdue > 0 ? 'bg-destructive/10' : 'bg-muted group-hover:bg-muted/70'}`}>
                        <AlertTriangle className={`h-4 w-4 ${teamTasksOverdue > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Team Overdue</p>
                        <p className={`text-[22px] font-extrabold leading-tight tabular-nums ${teamTasksOverdue > 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {teamTasksOverdue}
                        </p>
                      </div>
                      <ArrowRight className={`h-4 w-4 ${teamTasksOverdue > 0 ? 'text-destructive/60' : 'text-muted-foreground group-hover:text-primary'}`} />
                    </Link>
                  </div>
                )}

              </div>
            )
          })()}

          {/* PROJECTS TAB */}
          {tab === 'projects' && hasProjects && (
            <div className="space-y-4">

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiCard label="Active"          value={projectsSummary.activeCount}          sublabel="Projects in flight"    accent="#1B2559" href="/projects" />
                <KpiCard label="Blocked"         value={projectsSummary.blockedCount}          sublabel="Needs unblocking"      accent="#EF4444" href="/projects" danger />
                <KpiCard label="Milestones Due"  value={projectsSummary.milestonesDueSoon}      sublabel="Within 7 days"         accent="#F97316" href="/projects" />
                <KpiCard label="Milestones Overdue" value={projectsSummary.milestonesOverdue}   sublabel="Past target date"      accent="#EF4444" href="/projects" danger />
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <SectionHeader icon={Flag} title="At Risk" count={projectsSummary.atRiskCount}
                  href="/projects" accentClass="text-destructive" />
                {projectsSummary.atRisk.length > 0 ? (
                  <div className="divide-y divide-border">
                    {projectsSummary.atRisk.map((p) => (
                      <Link key={p.id} href={`/projects/${p.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium text-foreground">{p.name}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <ProjectStatusBadge status={p.status} size="sm" />
                            {p.target_date && (
                              <span className="text-[10px] text-destructive font-semibold">
                                Target {new Date(p.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — passed
                              </span>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <InlineEmpty icon={CheckCircle2} text="No projects blocked or past their target date." />
                )}
              </div>

            </div>
          )}

        </div>

        {/* RIGHT — tab-specific sidebar */}
        <div className="space-y-4">

          {tab === 'requests' && (
            <>
              {isManager && pendingApprovalCount > 0 && (
                <Link href="/approvals"
                  className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-4 hover:shadow-md transition-all group">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 group-hover:bg-warning/15 transition-colors">
                    <ShieldCheck className="h-4 w-4 text-warning" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-warning">
                      {pendingApprovalCount} pending approval{pendingApprovalCount > 1 ? 's' : ''}
                    </p>
                    <p className="text-[11px] text-warning/80">Review and take action</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-warning/70 group-hover:translate-x-0.5 transition-transform shrink-0" />
                </Link>
              )}

              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quick Actions</span>
                </div>
                <div className="space-y-1.5">
                  <QuickAction href="/services?action=new"   icon={Plus}        label="New Request"  sublabel="Raise a new request" />
                  <QuickAction href="/requests"              icon={FileText}    label="All Requests" sublabel="View all requests" />
                  {isAgent && (
                    <QuickAction href="/requests?assigned=me" icon={Inbox}      label="My Queue"     sublabel="Requests assigned to you" />
                  )}
                  {isManager && (
                    <QuickAction href="/approvals"           icon={ShieldCheck} label="Approvals"    sublabel="Review pending approvals" />
                  )}
                </div>
              </section>

              {isManager && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Request Health</span>
                  </div>
                  <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">Open tickets</span>
                      <span className="text-[12px] font-bold tabular-nums">{teamRequestsOpen}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">SLA breaches</span>
                      <span className={`text-[12px] font-bold tabular-nums ${teamRequestsSlaBreached > 0 ? 'text-destructive' : ''}`}>
                        {teamRequestsSlaBreached}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">Pending approval</span>
                      <span className={`text-[12px] font-bold tabular-nums ${pendingApprovalCount > 0 ? 'text-warning' : ''}`}>
                        {pendingApprovalCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">Needs reply</span>
                      <span className="text-[12px] font-bold tabular-nums">{needsAttentionCount}</span>
                    </div>
                    <div className="px-3 py-2.5">
                      <Link href="/admin/reports?tab=requests" className="text-[11px] font-semibold text-primary hover:underline">
                        Request analytics →
                      </Link>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {tab === 'tasks' && (
            <>
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quick Actions</span>
                </div>
                <div className="space-y-1.5">
                  <QuickAction href="/tasks"                  icon={ListTodo}      label="All My Tasks"  sublabel="View full task list" />
                  <QuickAction href="/tasks?filter=overdue"   icon={AlertTriangle} label="Overdue Tasks" sublabel="Tasks past due date" />
                  <QuickAction href="/tasks?filter=due_today" icon={CalendarClock} label="Due Today"     sublabel="Tasks due by end of day" />
                  {isManager && (
                    <QuickAction href="/tasks?filter=team"    icon={Users}         label="Team Tasks"    sublabel="All tasks across your team" />
                  )}
                </div>
              </section>

              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <ListTodo className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">My Stats</span>
                </div>
                <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Open tasks</span>
                    <span className="text-[12px] font-bold tabular-nums">{myTasksOpen}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Due today</span>
                    <span className={`text-[12px] font-bold tabular-nums ${myTasksDueToday > 0 ? 'text-warning' : ''}`}>
                      {myTasksDueToday}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Overdue</span>
                    <span className={`text-[12px] font-bold tabular-nums ${myTasksOverdue > 0 ? 'text-destructive' : ''}`}>
                      {myTasksOverdue}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Done this week</span>
                    <span className="text-[12px] font-bold tabular-nums text-success">{myTasksDoneWeek}</span>
                  </div>
                  <div className="px-3 py-2.5">
                    <Link href="/admin/reports?tab=tasks" className="text-[11px] font-semibold text-primary hover:underline">
                      Task analytics →
                    </Link>
                  </div>
                </div>
              </section>

              {isManager && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Team Tasks</span>
                  </div>
                  <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">Open tasks</span>
                      <span className="text-[12px] font-bold tabular-nums">{teamTasksOpen}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">Overdue</span>
                      <span className={`text-[12px] font-bold tabular-nums ${teamTasksOverdue > 0 ? 'text-destructive' : ''}`}>
                        {teamTasksOverdue}
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      <Link href="/tasks?filter=team" className="text-[11px] font-semibold text-primary hover:underline">
                        View team tasks →
                      </Link>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {tab === 'projects' && (
            <>
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quick Actions</span>
                </div>
                <div className="space-y-1.5">
                  <QuickAction href="/projects" icon={FolderKanban} label="All Projects" sublabel="View every project" />
                </div>
              </section>

              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <FolderKanban className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Portfolio Health</span>
                </div>
                <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Active projects</span>
                    <span className="text-[12px] font-bold tabular-nums">{projectsSummary.activeCount}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Blocked</span>
                    <span className={`text-[12px] font-bold tabular-nums ${projectsSummary.blockedCount > 0 ? 'text-destructive' : ''}`}>
                      {projectsSummary.blockedCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-[11px] text-muted-foreground">Milestones overdue</span>
                    <span className={`text-[12px] font-bold tabular-nums ${projectsSummary.milestonesOverdue > 0 ? 'text-destructive' : ''}`}>
                      {projectsSummary.milestonesOverdue}
                    </span>
                  </div>
                  <div className="px-3 py-2.5">
                    <Link href="/admin/reports" className="text-[11px] font-semibold text-primary hover:underline">
                      Project analytics →
                    </Link>
                  </div>
                </div>
              </section>
            </>
          )}

        </div>
      </div>
    </>
  )
}

/* ── page ────────────────────────────────────────────────────────────────────── */

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams

  // getCurrentProfile and getEnabledModules are React.cache'd — these resolve
  // immediately on the home page since the layout already called them.
  const [profile, enabledMods] = await Promise.all([getCurrentProfile(), getEnabledModules()])
  if (!profile) redirect('/login?retry=1')

  autoCloseRequests().catch(() => {})

  const isManager   = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'
  const isAgent     = profile.role === 'agent' || isManager
  const isAdmin     = profile.role === 'admin' || profile.role === 'platform_owner'

  const hasRequests = enabledMods.includes('requests')
  // Tasks/Projects aren't fully built out yet — Admin/Owner only until that
  // work ships, then reopened to everyone (same gate as Sidebar/MobileNav).
  const hasTasks    = enabledMods.includes('tasks') && isAdmin
  const hasProjects = enabledMods.includes('projects') && isAdmin
  const defaultTab  = hasRequests ? 'requests' : hasTasks ? 'tasks' : 'requests'
  const tab         = (sp.tab === 'tasks' && hasTasks) ? 'tasks'
                     : (sp.tab === 'projects' && hasProjects) ? 'projects'
                     : defaultTab

  // Compute greeting immediately — no DB call needed
  const now      = new Date()
  const firstName = profile.full_name.split(' ')[0]
  const hour      = now.getHours()
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dayLabel  = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Start the RPC without awaiting — it resolves while React streams the shell
  const supabase    = await createClient()
  const dashPromise: Promise<HomeDashboardData | null> = Promise.resolve(
    supabase
      .rpc('get_home_dashboard', {
        p_is_manager: isManager,
        p_is_agent:   isAgent,
        p_has_tasks:  hasTasks,
      })
      .then((r) => r.data as HomeDashboardData | null)
  )
  const projectsSummaryPromise: Promise<HomeProjectsSummary> = hasProjects
    ? getHomeProjectsSummary()
    : Promise.resolve({ activeCount: 0, blockedCount: 0, milestonesOverdue: 0, milestonesDueSoon: 0, atRiskCount: 0, atRisk: [] })

  return (
    <div className="space-y-4 pb-4">

      {/* Greeting renders before the RPC resolves */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{dayLabel}</p>
      </div>

      {/* Dashboard body streams in when the RPC resolves (~100ms) */}
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardBody
          dashPromise={dashPromise}
          projectsSummaryPromise={projectsSummaryPromise}
          hasRequests={hasRequests}
          hasTasks={hasTasks}
          hasProjects={hasProjects}
          isAgent={isAgent}
          isManager={isManager}
          tab={tab}
        />
      </Suspense>

    </div>
  )
}
