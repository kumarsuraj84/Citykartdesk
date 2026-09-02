import Link from 'next/link'
import { Search, Plus } from 'lucide-react'
import { Suspense } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportRequests } from '@/lib/actions/export'
import { redirect } from 'next/navigation'
import { getCurrentProfile, hasSubordinates } from '@/lib/queries/profiles'
import { getRequests } from '@/lib/queries/requests'
import { getActiveServicesForReclassify, getServiceCategories, getServiceSubCategoriesForFilter } from '@/lib/queries/services'
import { RequestsTable } from '@/components/requests/RequestsTable'
import { ColumnFilterSelect } from '@/components/requests/ColumnFilterSelect'
import { StatusFilterSelect } from '@/components/requests/StatusFilterSelect'
import { Pagination } from '@/components/ui/Pagination'
import type { RequestStatus, RequestPriority } from '@/types'

// ── Requests — purely "what did I raise / what am I cc'd on" ───────────────────
// Deliberately separate from /requests/queue (the agent's work page — tickets
// assigned to them and their team's queue). This page never shows a ticket just
// because the viewer happens to also be an agent working it elsewhere — only
// what they personally submitted or were added to as a collaborator.

interface PageProps {
  searchParams: Promise<{
    view?: string
    status?: string
    q?: string
    priority?: string
    service?: string
    category?: string
    subcategory?: string
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
  // Every status option is written to the URL explicitly (never by deleting
  // the param) — 'all' is its own distinct value, not an empty/absent one, so
  // selecting it can't be confused with "no status param yet" (which defaults
  // to 'active' below) the way the old pill row's value:'' briefly was.
  { label: 'All',             value: 'all' },
]

const PRIORITY_OPTIONS: { value: RequestPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
]

const SORT_COLUMNS = ['updated_at', 'created_at', 'priority', 'status', 'request_no']

export default async function RequestsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const params = await searchParams

  const rawView: 'mine' | 'collaborated' | 'subordinates' =
    params.view === 'collaborated' ? 'collaborated' : params.view === 'subordinates' ? 'subordinates' : 'mine'
  const rawStatus     = params.status as string | undefined
  const q             = params.q
  const rawPriority   = params.priority
  const rawService    = params.service
  const rawCategory   = params.category
  const rawSubCategory = params.subcategory
  const page          = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const pageSize      = [25, 50, 100].includes(parseInt(params.pageSize ?? '50', 10))
    ? parseInt(params.pageSize ?? '50', 10)
    : 50

  const sortCol = SORT_COLUMNS.includes(params.sort ?? '') ? params.sort! : 'updated_at'
  const sortDir: 'asc' | 'desc' = params.dir === 'asc' ? 'asc' : 'desc'

  // 'all' means "no status filter" (getRequests skips its status clause on
  // undefined) — a distinct explicit value, not the same as an absent param
  // (which defaults to 'active' below).
  const statusFilter: RequestStatus | 'active' | undefined =
    rawStatus === 'all' ? undefined : !rawStatus ? 'active' : (rawStatus as RequestStatus | 'active')

  const priorityFilter = PRIORITY_OPTIONS.some((p) => p.value === rawPriority) ? (rawPriority as RequestPriority) : undefined
  const serviceFilter = rawService || undefined
  const categoryFilter = rawCategory || undefined
  const subCategoryFilter = rawSubCategory || undefined

  const [result, serviceOptions, categoryOptions, subCategoryOptions, showTeamView] = await Promise.all([
    getRequests({
      view: rawView,
      userId: profile.id,
      status: statusFilter,
      q: q || undefined,
      priority: priorityFilter,
      serviceId: serviceFilter,
      categoryId: categoryFilter,
      subCategoryId: subCategoryFilter,
      page,
      pageSize,
      sort: sortCol,
      dir: sortDir,
    }),
    getActiveServicesForReclassify(),
    getServiceCategories(),
    getServiceSubCategoriesForFilter(),
    hasSubordinates(profile.id),
  ])
  const requests = result.data

  // ── URL builders ─────────────────────────────────────────────────────────────
  // currentSearch carries every filter currently in the URL (minus `page`) so
  // client components (ColumnFilterSelect, RequestsTable's sort headers) can
  // add/remove exactly one param locally without a server-passed closure and
  // without silently dropping the others.

  function currentParams(): URLSearchParams {
    const p = new URLSearchParams()
    if (rawView !== 'mine') p.set('view', rawView)
    if (rawStatus && rawStatus !== 'active') p.set('status', rawStatus)
    if (q) p.set('q', q)
    if (priorityFilter) p.set('priority', priorityFilter)
    if (serviceFilter) p.set('service', serviceFilter)
    if (categoryFilter) p.set('category', categoryFilter)
    if (subCategoryFilter) p.set('subcategory', subCategoryFilter)
    if (params.sort) p.set('sort', params.sort)
    if (params.dir) p.set('dir', params.dir)
    return p
  }
  const currentSearch = currentParams().toString()

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <PageHeader
        title="Requests"
        description={
          rawView === 'collaborated' ? 'Tickets you have been added to as a collaborator'
          : rawView === 'subordinates' ? 'Tickets your direct reports raised or are working'
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
          { value: 'collaborated', label: 'Collaborated' },
          // Org-chart based (profiles.manager_id) — only shown to someone
          // who actually has direct reports.
          ...(showTeamView ? [{ value: 'subordinates', label: 'My Team' } as const] : []),
        ] as { value: 'mine' | 'collaborated' | 'subordinates'; label: string }[]).map(({ value: v, label }) => {
          const href = `/requests?view=${v}${rawStatus && rawStatus !== 'active' ? `&status=${rawStatus}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`
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

      {/* ── Search + column filters row ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Global search — matches title, request #, and any comment on the request */}
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <form>
            {rawView !== 'mine' && <input type="hidden" name="view" value={rawView} />}
            {rawStatus && rawStatus !== 'active' && (
              <input type="hidden" name="status" value={rawStatus} />
            )}
            {priorityFilter && <input type="hidden" name="priority" value={priorityFilter} />}
            {serviceFilter && <input type="hidden" name="service" value={serviceFilter} />}
            {categoryFilter && <input type="hidden" name="category" value={categoryFilter} />}
            {subCategoryFilter && <input type="hidden" name="subcategory" value={subCategoryFilter} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search requests + comments…"
              className="w-full rounded-lg border border-[#E0E0EC] bg-white py-1.5 pl-8 pr-3 text-[12px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
        </div>

        {/* Status filter — dropdown instead of a pill row to save horizontal space */}
        <StatusFilterSelect
          value={rawStatus && rawStatus !== 'active' ? rawStatus : 'active'}
          options={FILTER_TABS}
          pathname="/requests"
          currentSearch={currentSearch}
        />

        {/* Per-column filters: Priority / Category / Sub Category / Service */}
        <ColumnFilterSelect
          paramName="priority"
          value={priorityFilter ?? ''}
          options={PRIORITY_OPTIONS}
          placeholder="Any priority…"
          pathname="/requests"
          currentSearch={currentSearch}
        />
        <ColumnFilterSelect
          paramName="category"
          value={categoryFilter ?? ''}
          options={categoryOptions.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Any category…"
          pathname="/requests"
          currentSearch={currentSearch}
        />
        <ColumnFilterSelect
          paramName="subcategory"
          value={subCategoryFilter ?? ''}
          options={subCategoryOptions.map((s) => ({ value: s.id, label: `${s.name} (${s.category_name})` }))}
          placeholder="Any sub category…"
          pathname="/requests"
          currentSearch={currentSearch}
        />
        <ColumnFilterSelect
          paramName="service"
          value={serviceFilter ?? ''}
          options={serviceOptions.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Any service…"
          pathname="/requests"
          currentSearch={currentSearch}
        />
      </div>

      {/* ── Request list ── */}
      <RequestsTable
        requests={requests}
        emptyTitle="No requests found"
        emptyDescription={q ? 'Try adjusting your search or filters.' : 'No requests match the selected filters.'}
        viewerId={profile.id}
        teamMembers={[]}
        showAssignAction={false}
        sortCol={sortCol}
        sortDir={sortDir}
        pathname="/requests"
        currentSearch={currentSearch}
      />

      <Suspense>
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={result.pageSize}
          basePath="/requests"
        />
      </Suspense>
    </div>
  )
}
