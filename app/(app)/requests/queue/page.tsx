import Link from 'next/link'
import { Search, LayoutList, Columns3 } from 'lucide-react'
import { Suspense } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { redirect } from 'next/navigation'
import { getCurrentProfile, getTeamMembersForTeams, getAgentTierProfiles } from '@/lib/queries/profiles'
import { getRequests } from '@/lib/queries/requests'
import { getActiveServicesForReclassify, getServiceCategories, getServiceSubCategoriesForFilter } from '@/lib/queries/services'
import { RequestsTable } from '@/components/requests/RequestsTable'
import { ColumnFilterSelect } from '@/components/requests/ColumnFilterSelect'
import { StatusFilterSelect } from '@/components/requests/StatusFilterSelect'
import { RequestBoardView } from '@/components/requests/RequestBoardView'
import { Pagination } from '@/components/ui/Pagination'
import type { RequestStatus, RequestPriority } from '@/types'
import type { AssignedToFilter } from '@/lib/queries/requests'

// ── Agent Requests — a page for working tickets, not raising them ──────────────
// Deliberately separate from /requests (which is purely "what did I raise as a
// requester"). This page only ever shows two things: tickets assigned to me,
// and my team's queue — never anything the viewer merely submitted themselves.
// A ticket the agent raised for themselves lives on /requests like anyone
// else's; it never appears here just because they happen to also be an agent.

interface PageProps {
  searchParams: Promise<{
    tab?: string
    layout?: string
    status?: string
    q?: string
    assigned?: string
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
  { label: 'All',             value: 'all' },
]

const PRIORITY_OPTIONS: { value: RequestPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
]

const SORT_COLUMNS = ['updated_at', 'created_at', 'priority', 'status', 'request_no']

export default async function AgentRequestsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const isAgent =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  // Not an agent — this page has nothing for a plain requester. Send them to
  // the page that actually applies to them.
  if (!isAgent) redirect('/requests')

  const params = await searchParams

  // Two tabs only: "My Requests" here means assigned to me (not raised by me
  // — that's a different page entirely), and "Team Queue" is everything the
  // team owns, mine or not, assigned or not.
  const rawTab: 'mine' | 'team' = params.tab === 'team' ? 'team' : (params.assigned && params.assigned !== 'me') || params.assigned === '' ? 'team' : 'mine'

  const layout: 'table' | 'board' = params.layout === 'board' ? 'board' : 'table'
  const rawStatus      = params.status as string | undefined
  const q              = params.q
  const rawAssigned     = rawTab === 'mine' ? 'me' : (params.assigned || undefined)
  const rawPriority    = params.priority
  const rawService     = params.service
  const rawCategory    = params.category
  const rawSubCategory = params.subcategory
  const page           = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const pageSize       = [25, 50, 100].includes(parseInt(params.pageSize ?? '50', 10))
    ? parseInt(params.pageSize ?? '50', 10)
    : 50

  const sortCol = SORT_COLUMNS.includes(params.sort ?? '') ? params.sort! : 'updated_at'
  const sortDir: 'asc' | 'desc' = params.dir === 'asc' ? 'asc' : 'desc'

  const statusFilter: RequestStatus | 'active' | 'unresolved' | undefined =
    rawStatus === 'all' ? undefined : !rawStatus ? 'active' : (rawStatus as RequestStatus | 'unresolved')

  const assignedTo: AssignedToFilter | undefined = rawAssigned || undefined
  const priorityFilter = PRIORITY_OPTIONS.some((p) => p.value === rawPriority) ? (rawPriority as RequestPriority) : undefined
  const serviceFilter = rawService || undefined
  const categoryFilter = rawCategory || undefined
  const subCategoryFilter = rawSubCategory || undefined

  const isBoard = layout === 'board'

  const [result, serviceOptions, categoryOptions, subCategoryOptions] = await Promise.all([
    getRequests({
      view: 'queue',
      userId: profile.id,
      status: statusFilter,
      q: q || undefined,
      assignedTo,
      priority: priorityFilter,
      serviceId: serviceFilter,
      categoryId: categoryFilter,
      subCategoryId: subCategoryFilter,
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

  const relevantTeamIds = Array.from(new Set([
    ...requests.map((r) => r.team_id),
    ...profile.team_members.map((m) => m.team_id),
  ]))
  const assignableUsers = await (async () => {
    const scoped = relevantTeamIds.length > 0 ? await getTeamMembersForTeams(relevantTeamIds) : []
    return scoped.length > 0 ? scoped : await getAgentTierProfiles()
  })()

  function currentParams(): URLSearchParams {
    const p = new URLSearchParams()
    if (layout !== 'table') p.set('layout', layout)
    if (rawStatus && rawStatus !== 'active') p.set('status', rawStatus)
    if (q) p.set('q', q)
    if (rawTab === 'team' && assignedTo) p.set('assigned', assignedTo)
    if (priorityFilter) p.set('priority', priorityFilter)
    if (serviceFilter) p.set('service', serviceFilter)
    if (categoryFilter) p.set('category', categoryFilter)
    if (subCategoryFilter) p.set('subcategory', subCategoryFilter)
    if (params.sort) p.set('sort', params.sort)
    if (params.dir) p.set('dir', params.dir)
    return p
  }
  const currentSearch = currentParams().toString()

  function tabHref(tab: 'mine' | 'team') {
    const p = currentParams()
    p.set('tab', tab)
    if (tab === 'mine') p.delete('assigned')
    p.delete('page')
    return `/requests/queue?${p.toString()}`
  }

  function assignedHref(a: AssignedToFilter | '') {
    const p = currentParams()
    p.set('tab', 'team')
    if (a) p.set('assigned', a)
    else p.delete('assigned')
    p.delete('page')
    return `/requests/queue?${p.toString()}`
  }

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <PageHeader
        title="Agent Requests"
        description={
          rawTab === 'mine' ? 'Tickets assigned to you'
          : 'Team queue — all incoming requests'
        }
        actions={
          <Link href="/requests" className="rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            My Submitted Requests →
          </Link>
        }
      />

      {/* ── Tab toggle: assigned to me vs. team's full queue ── */}
      <div className="flex gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 w-fit">
        {([
          { value: 'mine', label: 'My Requests' },
          { value: 'team', label: 'Team Queue' },
        ] as { value: 'mine' | 'team'; label: string }[]).map(({ value: v, label }) => (
          <Link
            key={v}
            href={tabHref(v)}
            className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
              rawTab === v
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* ── Table / Board layout toggle ── */}
      <div className="flex gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 w-fit">
        {([
          { value: 'table', label: 'Table', Icon: LayoutList },
          { value: 'board', label: 'Board', Icon: Columns3 },
        ] as const).map(({ value: v, label, Icon }) => {
          const p = currentParams()
          p.set('layout', v)
          p.set('tab', rawTab)
          const href = `/requests/queue?${p.toString()}`
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

      {/* ── Within Team Queue: narrow by assignment state ── */}
      {rawTab === 'team' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Technician:</span>
          {(
            [
              { label: 'All',        value: '' as const },
              { label: 'Unassigned', value: 'unassigned' as const },
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
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <form>
            <input type="hidden" name="tab" value={rawTab} />
            {rawTab === 'team' && assignedTo && <input type="hidden" name="assigned" value={assignedTo} />}
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

        <StatusFilterSelect
          value={rawStatus && rawStatus !== 'active' ? rawStatus : 'active'}
          options={FILTER_TABS}
          pathname="/requests/queue"
          currentSearch={currentSearch}
        />

        <ColumnFilterSelect
          paramName="priority"
          value={priorityFilter ?? ''}
          options={PRIORITY_OPTIONS}
          placeholder="Any priority…"
          pathname="/requests/queue"
          currentSearch={currentSearch}
        />
        <ColumnFilterSelect
          paramName="category"
          value={categoryFilter ?? ''}
          options={categoryOptions.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Any category…"
          pathname="/requests/queue"
          currentSearch={currentSearch}
        />
        <ColumnFilterSelect
          paramName="subcategory"
          value={subCategoryFilter ?? ''}
          options={subCategoryOptions.map((s) => ({ value: s.id, label: `${s.name} (${s.category_name})` }))}
          placeholder="Any sub category…"
          pathname="/requests/queue"
          currentSearch={currentSearch}
        />
        <ColumnFilterSelect
          paramName="service"
          value={serviceFilter ?? ''}
          options={serviceOptions.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Any service…"
          pathname="/requests/queue"
          currentSearch={currentSearch}
        />
        {rawTab === 'team' && assignableUsers.length > 0 && (
          <ColumnFilterSelect
            paramName="assigned"
            value={assignedTo && assignedTo !== 'me' && assignedTo !== 'unassigned' ? assignedTo : ''}
            options={assignableUsers.map((a) => ({ value: a.id, label: a.full_name }))}
            placeholder="Any technician…"
            pathname="/requests/queue"
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
          <RequestBoardView requests={requests} pathname="/requests/queue" currentSearch={currentSearch} />
        )
      ) : (
        <RequestsTable
          requests={requests}
          emptyTitle="No requests found"
          emptyDescription={rawTab === 'mine' ? 'Nothing is currently assigned to you.' : 'No requests match the selected filters.'}
          viewerId={profile.id}
          teamMembers={assignableUsers}
          showAssignAction={rawTab === 'team'}
          sortCol={sortCol}
          sortDir={sortDir}
          pathname="/requests/queue"
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
            basePath="/requests/queue"
          />
        </Suspense>
      )}
    </div>
  )
}
