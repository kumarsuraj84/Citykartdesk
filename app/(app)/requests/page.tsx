import Link from 'next/link'
import { Search, Plus, LayoutList, Columns3 } from 'lucide-react'
import { Suspense } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportRequests } from '@/lib/actions/export'
import { redirect } from 'next/navigation'
import { getCurrentProfile, getTeamMembersForTeams, getAllProfiles, getAgentTierProfiles } from '@/lib/queries/profiles'
import { getRequests } from '@/lib/queries/requests'
import { getActiveServicesForReclassify, getServiceCategories, getServiceSubCategoriesForFilter } from '@/lib/queries/services'
import { RequestsTable } from '@/components/requests/RequestsTable'
import { ColumnFilterSelect } from '@/components/requests/ColumnFilterSelect'
import { StatusFilterSelect } from '@/components/requests/StatusFilterSelect'
import { RequestBoardView } from '@/components/requests/RequestBoardView'
import { Pagination } from '@/components/ui/Pagination'
import type { RequestStatus, RequestPriority } from '@/types'
import type { AssignedToFilter } from '@/lib/queries/requests'

interface PageProps {
  searchParams: Promise<{
    view?: string
    layout?: string
    status?: string
    q?: string
    assigned?: string
    priority?: string
    service?: string
    category?: string
    subcategory?: string
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
  const isAgent =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  const rawView =
    params.view === 'queue' && isAgent ? 'queue'
    : params.view === 'collaborated' ? 'collaborated'
    : 'mine'
  const layout: 'table' | 'board' = params.layout === 'board' ? 'board' : 'table'
  const rawStatus     = params.status as string | undefined
  const q             = params.q
  const rawAssigned   = params.assigned
  const rawPriority   = params.priority
  const rawService    = params.service
  const rawCategory   = params.category
  const rawSubCategory = params.subcategory
  const requesterId   = isAgent ? (params.requester_id ?? undefined) : undefined
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

  const assignedTo: AssignedToFilter | undefined = rawAssigned || undefined
  const priorityFilter = PRIORITY_OPTIONS.some((p) => p.value === rawPriority) ? (rawPriority as RequestPriority) : undefined
  const serviceFilter = rawService || undefined
  const categoryFilter = rawCategory || undefined
  const subCategoryFilter = rawSubCategory || undefined

  const showWorkbench = rawView === 'queue' && isAgent
  const isBoard = showWorkbench && layout === 'board'

  const [result, serviceOptions, categoryOptions, subCategoryOptions] = await Promise.all([
    getRequests({
      view: rawView,
      userId: profile.id,
      status: statusFilter,
      q: q || undefined,
      assignedTo,
      priority: priorityFilter,
      serviceId: serviceFilter,
      categoryId: categoryFilter,
      subCategoryId: subCategoryFilter,
      requesterId,
      page: isBoard ? 1 : page,
      pageSize: isBoard ? 200 : pageSize,
      sort: sortCol,
      dir: sortDir,
    }),
    getActiveServicesForReclassify(),
    getServiceCategories(),
    getServiceSubCategoriesForFilter(),
  ])
  const requests = result.data

  // Candidate agents for the Assignee column filter + bulk Assign-To picker —
  // teams actually present on this page's requests, UNION the viewer's own
  // team(s). Falls back to every org profile whenever that comes back empty —
  // not just when there were no team ids to query in the first place — since
  // an org with team_members rows not yet populated for the relevant team(s)
  // would otherwise silently lose the filter entirely even though real
  // candidate agents exist org-wide. assignRequest itself doesn't restrict
  // the target to the request's team, so this fallback isn't over-permissive.
  const relevantTeamIds = Array.from(new Set([
    ...requests.map((r) => r.team_id),
    ...profile.team_members.map((m) => m.team_id),
  ]))
  const assignableUsers = isAgent
    ? await (async () => {
        const scoped = relevantTeamIds.length > 0 ? await getTeamMembersForTeams(relevantTeamIds) : []
        return scoped.length > 0 ? scoped : await getAgentTierProfiles()
      })()
    : []

  // Requester column filter — agent-only (a regular user's requests are always
  // their own, so filtering by requester would be meaningless for them).
  const requesterOptions = isAgent ? await getAllProfiles() : []

  // ── URL builders ─────────────────────────────────────────────────────────────
  // currentSearch carries every filter currently in the URL (minus `page`) so
  // client components (ColumnFilterSelect, RequestsTable's sort headers) can
  // add/remove exactly one param locally without a server-passed closure and
  // without silently dropping the others.

  function currentParams(): URLSearchParams {
    const p = new URLSearchParams()
    if (rawView !== 'mine') p.set('view', rawView)
    if (layout !== 'table') p.set('layout', layout)
    if (rawStatus && rawStatus !== 'active') p.set('status', rawStatus)
    if (q) p.set('q', q)
    if (assignedTo) p.set('assigned', assignedTo)
    if (priorityFilter) p.set('priority', priorityFilter)
    if (serviceFilter) p.set('service', serviceFilter)
    if (categoryFilter) p.set('category', categoryFilter)
    if (subCategoryFilter) p.set('subcategory', subCategoryFilter)
    if (requesterId) p.set('requester_id', requesterId)
    if (params.sort) p.set('sort', params.sort)
    if (params.dir) p.set('dir', params.dir)
    return p
  }
  const currentSearch = currentParams().toString()

  function assignedHref(a: AssignedToFilter | '') {
    const p = currentParams()
    p.set('view', 'queue')
    if (a) p.set('assigned', a)
    else p.delete('assigned')
    p.delete('page')
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

      {/* ── Table / Board layout toggle (queue view only) ── */}
      {showWorkbench && (
        <div className="flex gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 w-fit">
          {([
            { value: 'table', label: 'Table', Icon: LayoutList },
            { value: 'board', label: 'Board', Icon: Columns3 },
          ] as const).map(({ value: v, label, Icon }) => {
            const href = `/requests?view=queue&layout=${v}${rawStatus && rawStatus !== 'active' ? `&status=${rawStatus}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`
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

      {/* ── Search + column filters row ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Global search — matches title, request #, and any comment on the request */}
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <form>
            {rawView === 'queue' && <input type="hidden" name="view" value="queue" />}
            {rawStatus && rawStatus !== 'active' && (
              <input type="hidden" name="status" value={rawStatus} />
            )}
            {assignedTo && <input type="hidden" name="assigned" value={assignedTo} />}
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

        {/* Per-column filters: Priority / Category / Sub Category / Service / Assignee */}
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
          options={serviceOptions.map((s) => ({ value: s.id, label: `${s.name} (${s.category_name})` }))}
          placeholder="Any service…"
          pathname="/requests"
          currentSearch={currentSearch}
        />
        {assignableUsers.length > 0 && (
          <ColumnFilterSelect
            paramName="assigned"
            value={assignedTo && assignedTo !== 'me' && assignedTo !== 'unassigned' ? assignedTo : ''}
            options={assignableUsers.map((a) => ({ value: a.id, label: a.full_name }))}
            placeholder="Any assignee…"
            pathname="/requests"
            currentSearch={currentSearch}
          />
        )}
        {requesterOptions.length > 0 && (
          <ColumnFilterSelect
            paramName="requester_id"
            value={requesterId ?? ''}
            options={requesterOptions.map((r) => ({ value: r.id, label: r.full_name }))}
            placeholder="Any requester…"
            pathname="/requests"
            currentSearch={currentSearch}
          />
        )}
      </div>

      {/* ── Request list ── */}
      {isBoard ? (
        requests.length === 0 ? (
          <div className="rounded-lg border border-[#E8E8F0] bg-white p-8 text-center text-sm text-muted-foreground">
            No requests found.
          </div>
        ) : (
          <RequestBoardView requests={requests} />
        )
      ) : (
        <RequestsTable
          requests={requests}
          emptyTitle="No requests found"
          emptyDescription={q ? 'Try adjusting your search or filters.' : 'No requests match the selected filters.'}
          viewerId={profile.id}
          teamMembers={assignableUsers}
          showAssignAction={rawView === 'queue'}
          sortCol={sortCol}
          sortDir={sortDir}
          pathname="/requests"
          currentSearch={currentSearch}
        />
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
