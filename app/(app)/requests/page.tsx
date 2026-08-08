import Link from 'next/link'
import { Search, Plus, Inbox, LayoutList, Columns3 } from 'lucide-react'
import { Suspense } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportRequests } from '@/lib/actions/export'
import { EmptyState } from '@/components/ui/EmptyState'
import { redirect } from 'next/navigation'
import { getCurrentProfile, getAllProfiles } from '@/lib/queries/profiles'
import { getRequests } from '@/lib/queries/requests'
import { SLABadge } from '@/components/requests/SLABadge'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { WorkbenchClient } from '@/components/requests/WorkbenchClient'
import { RequestBoardView } from '@/components/requests/RequestBoardView'
import { Pagination } from '@/components/ui/Pagination'
import { SourceCell } from '@/components/ui/SourceCell'
import { formatRelativeTime } from '@/lib/utils'
import type { RequestStatus, RequestWithRelations } from '@/types'
import type { AssignedToFilter } from '@/lib/queries/requests'

interface PageProps {
  searchParams: Promise<{
    view?: string
    layout?: string
    status?: string
    q?: string
    assigned?: string
    requester_id?: string
    page?: string
    pageSize?: string
    sort?: string
    dir?: string
  }>
}

const FILTER_TABS: { label: string; value: string }[] = [
  { label: 'Active',          value: 'active' },
  { label: 'Open',            value: 'open' },
  { label: 'In Progress',     value: 'in_progress' },
  { label: 'Waiting on User', value: 'waiting_user' },
  { label: 'Resolved',        value: 'resolved' },
  { label: 'Closed',          value: 'closed' },
  { label: 'All',             value: '' },
]

function SortLink({ col, label, current, dir, base }: { col: string; label: string; current: string; dir: string; base: string }) {
  const isActive = current === col
  const nextDir = isActive && dir === 'desc' ? 'asc' : 'desc'
  const url = `${base}&sort=${col}&dir=${nextDir}`
  return (
    <Link href={url} className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
      {label}
      <span className="text-[10px]">{isActive ? (dir === 'desc' ? '↓' : '↑') : ''}</span>
    </Link>
  )
}

function QueueRow({ request }: { request: RequestWithRelations }) {
  const source = (request as { source_metadata?: { created_via?: string } | null }).source_metadata?.created_via ?? null
  return (
    <Link
      href={`/requests/${request.id}`}
      className="group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
    >
      {/* Title + meta */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          {request.title}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">{request.request_no}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">{request.service.name}</span>
          {request.requester && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-xs text-muted-foreground">{request.requester.full_name}</span>
            </>
          )}
          {request.assignee && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                  {request.assignee.full_name.charAt(0).toUpperCase()}
                </span>
                {request.assignee.full_name.split(' ')[0]}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Source — editable dropdown */}
      <div className="hidden w-[84px] shrink-0 sm:flex sm:justify-start">
        <SourceCell entity="request" id={request.id} value={source} />
      </div>

      {/* Badges — visible on all screen sizes */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <StatusBadge status={request.status} size="sm" />
        <PriorityBadge priority={request.priority} size="sm" />
        <SLABadge
          resolutionDueAt={request.resolution_due_at}
          responseDueAt={request.response_due_at}
          status={request.status}
          showLabel
        />
      </div>

      {/* Updated time */}
      <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(request.updated_at)}
      </span>
    </Link>
  )
}

export default async function RequestsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const params = await searchParams
  const isAgent =
    profile.team_members.length > 0 ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  const rawView =
    params.view === 'queue' && isAgent ? 'queue'
    : params.view === 'collaborated' ? 'collaborated'
    : 'mine'
  const layout: 'table' | 'board' = params.layout === 'board' ? 'board' : 'table'
  const rawStatus   = params.status as string | undefined
  const q           = params.q
  const rawAssigned = params.assigned
  const requesterId = isAgent ? (params.requester_id ?? undefined) : undefined
  const page        = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const pageSize    = [25, 50, 100].includes(parseInt(params.pageSize ?? '50', 10))
    ? parseInt(params.pageSize ?? '50', 10)
    : 50

  const sortCol = ['updated_at', 'created_at', 'priority', 'status'].includes(params.sort ?? '') ? params.sort! : 'updated_at'
  const sortDir = params.dir === 'asc' ? 'asc' : 'desc'

  const statusFilter: RequestStatus | 'active' =
    !rawStatus ? 'active' : (rawStatus as RequestStatus | 'active')

  const assignedTo: AssignedToFilter | undefined =
    rawView === 'queue' && (rawAssigned === 'me' || rawAssigned === 'unassigned')
      ? (rawAssigned as AssignedToFilter)
      : undefined

  const showWorkbench = rawView === 'queue' && isAgent
  const isBoard = showWorkbench && layout === 'board'

  const [result, assignableUsers] = await Promise.all([
    getRequests({
      view: rawView,
      userId: profile.id,
      status: statusFilter,
      q: q || undefined,
      assignedTo,
      requesterId,
      page: isBoard ? 1 : page,
      pageSize: isBoard ? 200 : pageSize,
      sort: sortCol,
      dir: sortDir,
    }),
    showWorkbench ? getAllProfiles() : Promise.resolve([]),
  ])
  const requests = result.data

  // ── URL builders ─────────────────────────────────────────────────────────────

  function tabHref(status: string) {
    const p = new URLSearchParams()
    if (rawView !== 'mine') p.set('view', rawView)
    if (status) p.set('status', status)
    if (q) p.set('q', q)
    if (assignedTo) p.set('assigned', assignedTo)
    return `/requests?${p.toString()}`
  }

  function assignedHref(a: AssignedToFilter | '') {
    const p = new URLSearchParams()
    p.set('view', 'queue')
    if (statusFilter && statusFilter !== 'active') p.set('status', statusFilter)
    if (q) p.set('q', q)
    if (a) p.set('assigned', a)
    return `/requests?${p.toString()}`
  }

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <PageHeader
        title="Requests"
        description={
          rawView === 'queue' ? 'Team queue — all incoming requests'
          : rawView === 'collaborated' ? 'Tickets you have been added to as a collaborator'
          : 'Your submitted requests'
        }
        actions={
          <div className="flex items-center gap-2">
            <ExportButton action={exportRequests} filename="requests.csv" />
            <Link
              href="/services"
              className="btn-gradient text-white"
            >
              <Plus className="h-4 w-4" />
              New Request
            </Link>
          </div>
        }
      />

      {/* ── View toggle ── */}
      <div className="flex gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 w-fit">
        {([
          { value: 'mine', label: 'My Requests' },
          ...(isAgent ? [{ value: 'queue', label: 'Team Queue' }] : []),
          { value: 'collaborated', label: 'Collaborated' },
        ] as { value: string; label: string }[]).map(({ value: v, label }) => {
          const href = `/requests?view=${v}${statusFilter && statusFilter !== 'active' ? `&status=${statusFilter}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`
          return (
            <Link
              key={v}
              href={href}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                rawView === v
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {/* ── Table / Board layout toggle (queue view only) ── */}
      {showWorkbench && (
        <div className="flex gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 w-fit">
          {([
            { value: 'table', label: 'Table', Icon: LayoutList },
            { value: 'board', label: 'Board', Icon: Columns3 },
          ] as const).map(({ value: v, label, Icon }) => {
            const href = `/requests?view=queue&layout=${v}${statusFilter && statusFilter !== 'active' ? `&status=${statusFilter}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`
            return (
              <Link
                key={v}
                href={href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                  layout === v
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </Link>
            )
          })}
        </div>
      )}

      {/* ── Queue assignment quick-filters ── */}
      {rawView === 'queue' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Assigned:</span>
          {(
            [
              { label: 'All',            value: '' as const },
              { label: 'Unassigned',     value: 'unassigned' as const },
              { label: 'Assigned to Me', value: 'me' as const },
            ] as { label: string; value: AssignedToFilter | '' }[]
          ).map(({ label, value }) => (
            <Link
              key={value || 'all'}
              href={assignedHref(value)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                (assignedTo ?? '') === value
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      {/* ── Search + filters row ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <form>
            {rawView === 'queue' && <input type="hidden" name="view" value="queue" />}
            {statusFilter && statusFilter !== 'active' && (
              <input type="hidden" name="status" value={statusFilter} />
            )}
            {assignedTo && <input type="hidden" name="assigned" value={assignedTo} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search requests…"
              className="w-full rounded-lg border border-[#E0E0EC] bg-white py-1.5 pl-8 pr-3 text-[12px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map(({ label, value }) => (
            <Link
              key={value || 'all'}
              href={tabHref(value)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                statusFilter === value || (value === 'active' && statusFilter === 'active')
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Request list ── */}
      {showWorkbench && layout === 'board' ? (
        requests.length === 0 ? (
          <div className="rounded-lg border border-[#E8E8F0] bg-white">
            <EmptyState
              icon={q ? Search : Inbox}
              title="No requests found"
              description={q ? 'Try adjusting your search or filters.' : 'No requests match the selected filters.'}
            />
          </div>
        ) : (
          <RequestBoardView requests={requests} />
        )
      ) : showWorkbench ? (
        <WorkbenchClient
          requests={requests}
          teamMembers={assignableUsers}
          viewerId={profile.id}
          emptyTitle="No requests found"
          emptyDescription={q ? 'Try adjusting your search or filters.' : 'No requests match the selected filters.'}
          groupByStatus={statusFilter === 'active'}
        />
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-[#E8E8F0] bg-white">
          <EmptyState
            icon={q ? Search : Inbox}
            title="No requests found"
            description={q ? 'Try adjusting your search or filters.' : 'No requests match the selected filters.'}
            action={
              <Link
                href="/services"
                className="btn-gradient text-white"
              >
                Browse Services
              </Link>
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E8E8F0] bg-white">
          {/* Table header (queue view only, desktop) */}
          {rawView === 'queue' && (
            <div className="hidden border-b border-border bg-muted/20 px-3 py-2 sm:flex items-center gap-3">
              <div className="flex-1">
                <SortLink col="created_at" label="Request" current={sortCol} dir={sortDir} base={`/requests?view=${rawView}${statusFilter && statusFilter !== 'active' ? `&status=${statusFilter}` : ''}`} />
              </div>
              <div className="flex items-center gap-8 pr-2">
                <SortLink col="status" label="Status" current={sortCol} dir={sortDir} base={`/requests?view=${rawView}${statusFilter && statusFilter !== 'active' ? `&status=${statusFilter}` : ''}`} />
                <SortLink col="priority" label="Priority" current={sortCol} dir={sortDir} base={`/requests?view=${rawView}${statusFilter && statusFilter !== 'active' ? `&status=${statusFilter}` : ''}`} />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SLA</span>
                <SortLink col="updated_at" label="Updated" current={sortCol} dir={sortDir} base={`/requests?view=${rawView}${statusFilter && statusFilter !== 'active' ? `&status=${statusFilter}` : ''}`} />
              </div>
            </div>
          )}

          <div className="divide-y divide-border">
            {requests.map((req) => (
              <QueueRow key={req.id} request={req} />
            ))}
          </div>
        </div>
      )}

      {layout !== 'board' && (
        <Suspense>
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            total={result.total}
            pageSize={result.pageSize}
            basePath="/requests"
          />
        </Suspense>
      )}
    </div>
  )
}
