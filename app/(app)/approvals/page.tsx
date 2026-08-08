import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ShieldOff, ArrowRight, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getApprovals } from '@/lib/queries/approvals'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { formatRelativeTime } from '@/lib/utils'
import type { ApprovalStatus } from '@/types'
import type { ApprovalWithDetails } from '@/lib/queries/approvals'
import { createClient } from '@/lib/supabase/server'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportApprovals } from '@/lib/actions/export'
import type { ExportFilters } from '@/lib/export/reports'
import { InlineApprovalActions } from '@/components/requests/InlineApprovalActions'

interface PageProps {
  searchParams: Promise<{ tab?: string; page?: string; pageSize?: string }>
}

const TABS: { value: ApprovalStatus | 'all'; label: string }[] = [
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all',      label: 'All' },
]

const STATUS_ICONS: Record<ApprovalStatus, React.ElementType> = {
  pending:   Clock,
  approved:  CheckCircle2,
  rejected:  XCircle,
  cancelled: XCircle,
}

const STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending:   'text-amber-600 bg-amber-50 border-amber-200',
  approved:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  rejected:  'text-red-600 bg-red-50 border-red-200',
  cancelled: 'text-muted-foreground bg-muted border-border',
}

function ApprovalsExportButton({ activeTab }: { activeTab: ApprovalStatus | 'all' }) {
  const filters: ExportFilters | undefined =
    activeTab !== 'all' ? { status: activeTab } : undefined

  async function doExport() {
    'use server'
    return exportApprovals(filters)
  }

  return (
    <ExportButton
      action={doExport}
      filename={`approvals-${activeTab}`}
      label="Export CSV"
    />
  )
}

function ApprovalCard({
  approval,
  viewerId,
  viewerIsManager,
}: {
  approval: ApprovalWithDetails
  viewerId: string
  viewerIsManager: boolean
}) {
  const req = approval.request
  if (!req) return null

  const Icon = STATUS_ICONS[approval.status]
  const colorCls = STATUS_COLORS[approval.status]

  const currentStepInfo = approval.steps.find(
    (s) => s.step_order === (approval.current_step ?? 1)
  )

  const approverLabel =
    currentStepInfo?.approver_type === 'specific_user' && currentStepInfo.approver
      ? currentStepInfo.approver.full_name
      : 'Any Manager'

  const canAct =
    approval.status === 'pending' &&
    currentStepInfo &&
    (
      (currentStepInfo.approver_type === 'any_manager' && viewerIsManager) ||
      (currentStepInfo.approver_type === 'specific_user' && currentStepInfo.approver_user_id === viewerId)
    )

  return (
    <div className="group">
      <Link
        href={`/requests/${req.id}?tab=approvals`}
        className="flex items-center gap-4 px-4 py-3.5 hover:bg-muted/40 transition-colors"
      >
        {/* Status icon */}
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${colorCls}`}>
          <Icon className="h-4 w-4" />
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
            {req.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{req.request_no}</span>
            <span className="text-muted-foreground/40">·</span>
            {req.service && <span className="text-xs text-muted-foreground">{req.service.name}</span>}
            <span className="text-muted-foreground/40">·</span>
            {req.requester && (
              <span className="text-xs text-muted-foreground">{req.requester.full_name}</span>
            )}
            {approval.status === 'pending' && currentStepInfo && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-xs text-amber-600">Awaiting: {approverLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Badges */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <StatusBadge status={req.status} size="sm" />
          <PriorityBadge priority={req.priority} size="sm" />
        </div>

        {/* Time */}
        <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
          {formatRelativeTime(approval.updated_at)}
        </span>
      </Link>

      {canAct && (
        <InlineApprovalActions approvalId={approval.id} />
      )}
    </div>
  )
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const isManager = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'

  if (!isManager) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card px-8 py-16 text-center shadow-sm">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
            <ShieldOff className="h-10 w-10 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Approval Workflows</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              You do not have approval permissions. Approval workflows are managed by managers and administrators.
            </p>
          </div>
          <Link
            href="/requests"
            className="btn-gradient text-white"
          >
            View Requests
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  const params = await searchParams
  const activeTab = (
    TABS.find((t) => t.value === params.tab) ? params.tab : 'pending'
  ) as ApprovalStatus | 'all'

  const page     = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const pageSize = [25, 50, 100].includes(parseInt(params.pageSize ?? '50', 10))
    ? parseInt(params.pageSize ?? '50', 10)
    : 50

  // Fetch current page + per-tab counts in parallel
  const supabase = await createClient()
  const countStatuses: Array<ApprovalStatus | 'all'> = ['pending', 'approved', 'rejected', 'all']
  const [approvalResult, ...countResults] = await Promise.all([
    getApprovals(activeTab, { page, pageSize }),
    ...countStatuses.map((s) =>
      s === 'all'
        ? supabase.from('approvals').select('*', { count: 'exact', head: true })
        : supabase.from('approvals').select('*', { count: 'exact', head: true }).eq('status', s)
    ),
  ])

  const counts: Record<string, number> = Object.fromEntries(
    countStatuses.map((s, i) => [s, countResults[i].count ?? 0])
  )

  const approvals = approvalResult.data

  const emptyMessages: Record<string, { title: string; description: string }> = {
    pending:  { title: 'No pending approvals',  description: 'All requests have been reviewed.' },
    approved: { title: 'No approved requests',  description: 'Approved requests will appear here.' },
    rejected: { title: 'No rejected requests',  description: 'Rejected requests will appear here.' },
    all:      { title: 'No approval requests',  description: 'Requests with approval workflows will appear here.' },
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Approvals"
          description="Review and action approval requests from your team"
        />
        <ApprovalsExportButton activeTab={activeTab} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/50 p-1 w-fit">
        {TABS.map(({ value, label }) => (
          <Link
            key={value}
            href={`/approvals?tab=${value}`}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {counts[value] > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  activeTab === value
                    ? value === 'pending'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {counts[value]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* List */}
      {approvals.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <EmptyState
            icon={CheckCircle2}
            title={emptyMessages[activeTab]?.title ?? 'No approvals'}
            description={emptyMessages[activeTab]?.description ?? ''}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="divide-y divide-border">
            {approvals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} viewerId={profile.id} viewerIsManager={isManager} />
            ))}
          </div>
        </div>
      )}

      <Suspense>
        <Pagination
          page={approvalResult.page}
          totalPages={approvalResult.totalPages}
          total={approvalResult.total}
          pageSize={approvalResult.pageSize}
          basePath="/approvals"
        />
      </Suspense>
    </div>
  )
}
