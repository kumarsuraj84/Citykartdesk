import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ShieldOff, ArrowRight, CheckCircle2 } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getApprovals } from '@/lib/queries/approvals'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import type { ApprovalStatus } from '@/types'
import { createClient } from '@/lib/supabase/server'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportApprovals } from '@/lib/actions/export'
import type { ExportFilters } from '@/lib/export/reports'
import { ApprovalRow } from '@/components/requests/ApprovalRow'

interface PageProps {
  searchParams: Promise<{ tab?: string; page?: string; pageSize?: string }>
}

const TABS: { value: ApprovalStatus | 'all'; label: string }[] = [
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all',      label: 'All' },
]

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
              <ApprovalRow key={approval.id} approval={approval} viewerId={profile.id} viewerRole={profile.role} />
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
