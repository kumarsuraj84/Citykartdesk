import Link from 'next/link'
import { Search, LayoutList, Columns3 } from 'lucide-react'
import { Suspense } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { redirect } from 'next/navigation'
import { getCurrentProfile, getTeamMembersForTeams, getAgentTierProfiles } from '@/lib/queries/profiles'
import { getRequests, getRequesterName } from '@/lib/queries/requests'
import { getRequestFilterTaxonomy } from '@/lib/queries/services'
import { scopeTaxonomy } from '@/lib/requests/filter-taxonomy'
import { RequestsTable } from '@/components/requests/RequestsTable'
import { ColumnFilterSelect } from '@/components/requests/ColumnFilterSelect'
import { SortSelect } from '@/components/requests/SortSelect'
import { StatusFilterSelect } from '@/components/requests/StatusFilterSelect'
import { RequestBoardView } from '@/components/requests/RequestBoardView'
import { Pagination } from '@/components/ui/Pagination'
import { requireStaff } from '@/lib/ui/requireStaff'
import type { RequestPriority } from '@/types'
import type { AssignedToFilter } from '@/lib/queries/requests'
import { resolveQueueStatusFilter } from '@/lib/requests/queue-status-filter'
import { queueParams, queueTabParams } from '@/lib/requests/queue-url'

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
    /** show only the tickets of this requester (profile id) */
    requester?: string
    assigned?: string
    /** 'breached' → only tickets past their resolution deadline (Home's "Currently Breached" tile) */
    sla?: string
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
  { label: 'Hold (HO Purchase)', value: 'hold_purchase_ho' },
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
const SORT_OPTIONS = [
  { value: 'updated_at', label: 'Updated' },
  { value: 'created_at', label: 'Created' },
  { value: 'priority',   label: 'Priority' },
  { value: 'status',     label: 'Status' },
  { value: 'request_no', label: 'Request #' },
]

export default async function AgentRequestsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  requireStaff(profile, '/requests/queue')

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
  const requesterParam = /^[0-9a-f-]{36}$/i.test(params.requester ?? '') ? params.requester : undefined
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

  // Technicians see only unresolved work by default; Resolved/Closed/All are explicit choices.
  const statusFilter = resolveQueueStatusFilter(rawStatus)

  const assignedTo: AssignedToFilter | undefined = rawAssigned || undefined
  const breachedOnly = params.sla === 'breached'
  const priorityFilter = PRIORITY_OPTIONS.some((p) => p.value === rawPriority) ? (rawPriority as RequestPriority) : undefined
  // Service -> Category -> Sub Category are linked: each list offers only what fits the choice above it, and a choice that no longer fits is dropped
  const taxonomy = await getRequestFilterTaxonomy()
  const scoped = scopeTaxonomy(taxonomy, { service: rawService || undefined, category: rawCategory || undefined, subcategory: rawSubCategory || undefined })
  const serviceFilter = scoped.effective.service
  const categoryFilter = scoped.effective.category
  const subCategoryFilter = scoped.effective.subcategory

  const isBoard = layout === 'board'

  const [result, requesterRow] = await Promise.all([
    getRequests({
      view: 'queue',
      userId: profile.id,
      status: statusFilter,
      q: q || undefined,
      requesterId: requesterParam,
      assignedTo,
      breachedOnly,
      priority: priorityFilter,
      serviceId: serviceFilter,
      categoryId: categoryFilter,
      subCategoryId: subCategoryFilter,
      page: isBoard ? 1 : page,
      pageSize: isBoard ? 200 : pageSize,
      sort: sortCol,
      dir: sortDir,
    }),
    requesterParam ? getRequesterName(requesterParam) : Promise.resolve(null),
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

  // (keeps the tab: a filter chosen on the Team Queue stays on the Team Queue)
  function currentParams(): URLSearchParams {
    return queueParams({
      layout, tab: rawTab, status: rawStatus, q, requester: requesterParam, assigned: assignedTo, breachedOnly,
      priority: priorityFilter, service: serviceFilter, category: categoryFilter, subcategory: subCategoryFilter, sort: params.sort, dir: params.dir,
    })
  }
  const currentSearch = currentParams().toString()

  // each tab has its own filters: moving to the other tab starts it clean, so the filters of one do not follow you to the other
  function tabHref(tab: 'mine' | 'team') {
    return `/requests/queue?${queueTabParams(tab, layout).toString()}`
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
          : 'Technician group queue — all incoming requests'
        }
        actions={
          <Link href="/requests" className="rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            My Submitted Requests →
          </Link>
        }
      />

      {breachedOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          <span className="font-semibold">Showing only SLA-breached tickets</span>
          <span className="text-destructive/80">(resolution deadline passed)</span>
          <Link
            href={(() => { const p = currentParams(); p.delete('sla'); p.delete('page'); const s = p.toString(); return s ? `/requests/queue?${s}` : '/requests/queue' })()}
            className="ml-auto rounded-md border border-destructive/30 px-2 py-0.5 text-[11px] font-semibold hover:bg-destructive/10"
          >
            Show all
          </Link>
        </div>
      )}

      {/* ── Tab toggle: assigned to me vs. team's full queue ── */}
      <div className="flex gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 w-fit">
        {([
          { value: 'mine', label: 'My Requests' },
          { value: 'team', label: 'Technician Group Queue' },
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
            {requesterParam && <input type="hidden" name="requester" value={requesterParam} />}
            {priorityFilter && <input type="hidden" name="priority" value={priorityFilter} />}
            {serviceFilter && <input type="hidden" name="service" value={serviceFilter} />}
            {categoryFilter && <input type="hidden" name="category" value={categoryFilter} />}
            {subCategoryFilter && <input type="hidden" name="subcategory" value={subCategoryFilter} />}
            {layout === 'board' && <input type="hidden" name="layout" value="board" />}
            {breachedOnly && <input type="hidden" name="sla" value="breached" />}
            {params.sort && <input type="hidden" name="sort" value={params.sort} />}
            {params.dir && <input type="hidden" name="dir" value={params.dir} />}
            <input
              type="search"
              name="q"
              aria-label="Search tickets"
              defaultValue={q}
              placeholder="Search ticket, requester, store, technician, service, comments…"
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
          paramName="service"
          value={serviceFilter ?? ''}
          options={taxonomy.services.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Any service…"
          pathname="/requests/queue"
          currentSearch={currentSearch}
          clearParams={['category', 'subcategory']}
        />
        <ColumnFilterSelect
          paramName="category"
          value={categoryFilter ?? ''}
          options={scoped.categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Any category…"
          pathname="/requests/queue"
          currentSearch={currentSearch}
          clearParams={['subcategory']}
        />
        <ColumnFilterSelect
          paramName="subcategory"
          value={subCategoryFilter ?? ''}
          options={scoped.subCategories.map((s) => ({ value: s.id, label: categoryFilter ? s.name : `${s.name} (${s.category_name})` }))}
          placeholder="Any sub category…"
          pathname="/requests/queue"
          currentSearch={currentSearch}
        />
        <SortSelect value={sortCol} dir={sortDir} options={SORT_OPTIONS} pathname="/requests/queue" currentSearch={currentSearch} />
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

      {(requesterParam || q) && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-semibold text-foreground">{result.total} {result.total === 1 ? 'ticket' : 'tickets'} found</span>
          {requesterParam && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 font-medium text-primary">
              Requester: {requesterRow ?? 'selected requester'}
              <Link
                href={(() => { const p = currentParams(); p.delete('requester'); p.delete('page'); return `/requests/queue?${p.toString()}` })()}
                aria-label="Clear the requester filter"
                className="text-primary/70 hover:text-primary"
              >✕</Link>
            </span>
          )}
          {requesterParam && (!rawStatus || rawStatus === 'active') && (
            <span className="text-muted-foreground">Only active tickets are shown. Choose &quot;All&quot; in the status filter to include resolved and closed ones.</span>
          )}
        </div>
      )}

      {/* The board loads only the first 200 tickets and has no page buttons: say so, with the real total, instead of showing short column counts as if they were complete. */}
      {isBoard && result.total > requests.length && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-semibold">Showing the first {requests.length} of {result.total} tickets.</span>
          <span>Switch to table view to see all.</span>
          <Link
            href={(() => { const p = currentParams(); p.delete('layout'); p.delete('page'); const s = p.toString(); return s ? `/requests/queue?${s}` : '/requests/queue' })()}
            className="ml-auto rounded-md border border-amber-400/60 px-2 py-0.5 text-[11px] font-semibold hover:bg-amber-100 dark:hover:bg-amber-500/20"
          >
            Switch to table view
          </Link>
        </div>
      )}

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
          requesterFilterPath="/requests/queue"
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
