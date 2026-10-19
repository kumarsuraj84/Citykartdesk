import { createAdminClient } from '@/lib/supabase/admin'
import { resolveReportAccess, agentScopeOrFilter, reportsScopeOrFilter, type ReportViewerScope } from '@/lib/reporting/access'
import { getDirectReportIds } from '@/lib/queries/profiles'
import {
  UNASSIGNED, NO_CATEGORY, NO_LOCATION, NOT_SET, NOT_AC, NO_AC_DATA, RED_FLAG, WITHIN_LIMIT, type ExecTicket, type ExecApproval, type Priority,
} from '@/lib/reporting/executive/engine'
import { isNsoStore, DEFAULT_RED_FLAG_PERCENT } from '@/lib/reporting/analytics/facts'
import { loadAcContext } from '@/lib/queries/store-ac-stats'
import { levelFor, type DashLevel } from '@/lib/reporting/executive/levels'
import { createShortCache } from '@/lib/cache/short-ttl'
import type { ProfileWithTeams } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const PAGE = 1000
/** Safety cap: a runaway query stops here and the page says so. */
const MAX_ROWS = 30_000

/** Pages through a query (PostgREST returns at most 1000 rows per request). Unlike the report helpers it does not hide errors: a broken query must show up, not as an empty dashboard. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return { rows, truncated: false }
    if (rows.length >= MAX_ROWS) return { rows, truncated: true }
  }
}

/** How far back tickets are loaded (enough for "this FY" and its previous period). Still-open tickets are always loaded. */
const LOOKBACK_DAYS = 800
const NO_TEAM_ID = '00000000-0000-0000-0000-000000000000'

export interface ExecutiveData {
  level: DashLevel
  /** the viewer's own name, for the technician "only mine" shortcut */
  me: string
  now: number
  tickets: ExecTicket[]
  approvals: ExecApproval[]
  truncated: boolean
}

interface Raw {
  id: string
  request_no: string
  title: string
  status: string
  priority: Priority
  created_at: string
  resolved_at: string | null
  closed_at: string | null
  responded_at: string | null
  resolution_due_at: string | null
  updated_at: string
  reopen_count: number
  source_metadata: { created_via?: string } | null
  team: { name: string } | null
  assignee: { full_name: string } | null
  requester: {
    full_name: string
    department: { name: string } | null
    location: { name: string } | null
    store: {
      code: string; name: string; state: string | null; oem: { name: string } | null
      cluster: string | null; region: string | null; priority_list: string | null; ac_total: number | null
      ac_brand: string | null; ac_amc_brand: string | null; ac_amc_vendor: string | null; open_date: string | null
    } | null
  } | null
  service: { name: string; auto_oem_routing: boolean | null } | null
  category: { name: string } | null
  sub_category: { name: string } | null
  /** one survey per ticket, so PostgREST may send an object instead of a list */
  csat: { rating: number | null } | { rating: number | null }[] | null
  reopens: { created_at: string }[] | null
}

const SELECT = [
  'id, request_no, title, status, priority, created_at, updated_at, resolved_at, closed_at, responded_at, resolution_due_at, reopen_count, source_metadata',
  'team:teams(name)',
  'assignee:profiles!requests_assigned_to_fkey(full_name)',
  'requester:profiles!requests_requester_id_fkey(full_name, department:departments!profiles_department_id_fkey(name), location:locations(name), store:stores!profiles_store_id_fkey(code, name, state, cluster, region, priority_list, ac_total, ac_brand, ac_amc_brand, ac_amc_vendor, open_date, oem:oems!stores_oem_id_fkey(name)))',
  'service:services(name, auto_oem_routing)',
  'category:service_categories(name)',
  'sub_category:service_sub_categories(name)',
  'csat:csat_surveys(rating)',
  'reopens:request_activity(created_at)',
].join(', ')

const SOURCE_LABEL: Record<string, string> = {
  portal: 'Portal', email: 'Email', whatsapp: 'WhatsApp', intake: 'Intake desk', phone: 'Phone', api: 'API',
}
const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** "BLUE STAR OEM - DL" → "BLUE STAR". */
export function oemBrand(oemName: string): string {
  const i = oemName.toUpperCase().indexOf(' OEM')
  return (i > 0 ? oemName.slice(0, i) : oemName).trim()
}

/**
 * One ticket as the dashboard needs it. `openAcByStore` is each store's open AC tickets (see store-ac-stats.ts): with the store's AC total it gives the
 * AC Not Working % and the red flag, the same as in the Store AC report.
 */
export function toExecTicket(r: Raw, now: number, openAcByStore: ReadonlyMap<string, number> = new Map()): ExecTicket {
  const created = new Date(r.created_at).getTime()
  // resolved time: resolved_at, else closed_at; a ticket whose status says resolved/closed but has neither stamp falls back to its last update
  const doneIso = r.resolved_at ?? r.closed_at ?? (r.status === 'resolved' || r.status === 'closed' ? r.updated_at : null)
  const resolved = doneIso ? new Date(doneIso).getTime() : null
  const due = r.resolution_due_at ? new Date(r.resolution_due_at).getTime() : null
  const breached = due === null || r.status === 'cancelled' ? false : (resolved ?? now) > due
  const tat = resolved !== null ? (resolved - created) / 3_600_000 : null
  const rating = (Array.isArray(r.csat) ? r.csat : r.csat ? [r.csat] : []).map((c) => c.rating).filter((x): x is number => typeof x === 'number')
  // The store's OEM only matters for equipment requests (a service with OEM routing switched on, such as an AC repair). An IT or HR
  // ticket from the same store has nothing to do with the store's AC vendor, so it carries no OEM and stays out of every OEM view.
  const oem = r.service?.auto_oem_routing ? (r.requester?.store?.oem?.name ?? '') : ''
  const via = r.source_metadata?.created_via
  // the store's details from the Store Master; a requester who is not a store (head office staff) has none
  const st = r.requester?.store ?? null
  const isAc = !!r.service?.auto_oem_routing
  const detail = (v: string | null | undefined) => v?.trim() || NOT_SET
  const acTotal = st?.ac_total ?? null
  const acOpen = st ? (openAcByStore.get(st.code) ?? 0) : 0
  const acPct = st && acTotal && acTotal > 0 ? (acOpen / acTotal) * 100 : null
  const responded = r.responded_at ? (new Date(r.responded_at).getTime() - created) / 3_600_000 : null
  return {
    id: r.id,
    no: r.request_no,
    subject: r.title,
    group: r.team?.name ?? '(No group)',
    tech: r.assignee?.full_name ?? UNASSIGNED,
    cat: r.category?.name ?? NO_CATEGORY,
    sub: r.sub_category?.name ?? '(No sub category)',
    svc: r.service?.name ?? '',
    req: r.requester?.full_name ?? '',
    dept: r.requester?.department?.name ?? '(No department)',
    loc: r.requester?.location?.name ?? NO_LOCATION,
    store: r.requester?.store?.name ?? '(No store)',
    state: r.requester?.store?.state ?? '(No state)',
    oem: oem || '(No OEM)',
    brand: oem ? oemBrand(oem) : '(No OEM)',
    cluster: detail(st?.cluster),
    region: detail(st?.region),
    // NSO = a new store: no open date yet, or opened less than 9 months ago
    stype: st ? (isNsoStore(st.open_date, new Date(now)) ? 'NSO' : 'Regular') : NOT_SET,
    plist: detail(st?.priority_list),
    acb: isAc ? detail(st?.ac_brand) : NOT_AC,
    amb: isAc ? detail(st?.ac_amc_brand) : NOT_AC,
    amv: isAc ? detail(st?.ac_amc_vendor) : NOT_AC,
    ac: !isAc ? NOT_AC : acPct === null ? NO_AC_DATA : acPct > DEFAULT_RED_FLAG_PERCENT ? RED_FLAG : WITHIN_LIMIT,
    acTotal,
    acOpen,
    acPct,
    src: via ? (SOURCE_LABEL[via] ?? titleCase(via)) : 'Portal',
    prio: r.priority,
    status: r.status,
    created,
    resolved,
    closed: r.closed_at ? new Date(r.closed_at).getTime() : null,
    due,
    tatH: tat !== null && Number.isFinite(tat) && tat >= 0 ? tat : null,
    breached,
    csat: rating.length ? rating[rating.length - 1] : null,
    reo: (r.reopens ?? []).map((x) => new Date(x.created_at).getTime()),
    frH: responded !== null && Number.isFinite(responded) && responded >= 0 ? responded : null,
  }
}

/** Restricts a requests query (or an embedded `request` of another table) to what the viewer may see. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyScope(q: any, scope: ReportViewerScope, prefix: '' | 'request.'): any {
  const col = (c: string) => `${prefix}${c}`
  const opt = prefix ? { referencedTable: 'request' } : undefined
  switch (scope.kind) {
    case 'all': return q
    case 'own': return q.eq(col('requester_id'), scope.userId)
    case 'team': return q.in(col('team_id'), scope.teamIds.length ? scope.teamIds : [NO_TEAM_ID])
    case 'agent': return opt ? q.or(agentScopeOrFilter(scope), opt) : q.or(agentScopeOrFilter(scope))
    case 'reports': {
      // the team's tickets, then narrowed to the technicians (assigned to them) and / or requesters (raised by them) picked on the Dashboard
      let r = opt ? q.or(reportsScopeOrFilter(scope), opt) : q.or(reportsScopeOrFilter(scope))
      if (scope.techIds && scope.techIds.length > 0) r = r.in(col('assigned_to'), scope.techIds)
      if (scope.requesterIds && scope.requesterIds.length > 0) r = r.in(col('requester_id'), scope.requesterIds)
      return r
    }
  }
}

/** The dashboard's figures may be up to this old (D-040): it is a view of the whole year, not a live queue. */
export const EXECUTIVE_CACHE_MS = 60_000
const executiveCache = createShortCache<Omit<ExecutiveData, 'me'>>(EXECUTIVE_CACHE_MS, 40)

/** Loads the compact ticket and approval rows the Executive Dashboard works from, limited to the viewer's level. Shared for a minute between viewers with the same organization, level and scope. */
export async function loadExecutiveData(profile: ProfileWithTeams, opts: { fresh?: boolean; people?: { techIds?: string[]; requesterIds?: string[] } } = {}): Promise<ExecutiveData | { error: string }> {
  const level = levelFor(profile.role)
  if (!level || !profile.org_id) return { error: "You don't have access to this dashboard." }
  const access = resolveReportAccess(profile, 'requests')
  if ('error' in access) return { error: access.error }
  let scope = access.scope
  // a normal user who has people reporting to them sees the tickets of those people (not their own)
  if (profile.role === 'user') {
    const reportIds = await getDirectReportIds(profile.id)
    if (reportIds.length > 0) {
      // (only people who really report to them can be picked)
      const within = (ids?: string[]) => (ids ?? []).filter((id) => reportIds.includes(id))
      scope = { kind: 'reports', userId: profile.id, reportIds, techIds: within(opts.people?.techIds), requesterIds: within(opts.people?.requesterIds) }
    }
  }
  const orgId: string = profile.org_id

  // the key holds everything that decides which rows this viewer may see
  const shared = await executiveCache.get(`exec|${orgId}|${level}|${JSON.stringify(scope)}`, () => loadExecutiveRows(orgId, level, scope), opts)
  return { ...shared, me: profile.full_name }
}

export async function loadExecutiveRows(orgId: string, level: DashLevel, scope: ReportViewerScope): Promise<Omit<ExecutiveData, 'me'>> {
  const admin = createAdminClient() as unknown as AnyClient
  const nowDate = new Date()
  const now = nowDate.getTime()
  const since = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString()

  const { rows, truncated } = await fetchAll<Raw>((from, to) => {
    // Cancelled tickets are loaded too (the normal dashboard counts them as created); they only come from inside the look-back.
    const q = admin.from('requests').select(SELECT).eq('org_id', orgId)
      .eq('reopens.action', 'reopened')
      .or(`created_at.gte.${since},and(resolved_at.is.null,closed_at.is.null,status.neq.cancelled)`)
    return applyScope(q, scope, '').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  })
  // the AC position of each store is the same whatever the viewer's own scope is, so a store's red flag is the same on every dashboard
  const { openAcByStore } = await loadAcContext(admin, orgId)
  const tickets = rows.map((r) => toExecTicket(r, now, openAcByStore))

  const approvals = await loadApprovals(admin, orgId, scope, since)
  return { level, now, tickets, approvals, truncated }
}

interface RawApproval {
  id: string
  request_id: string
  status: string
  created_at: string
  decisions: { decision: string; decided_at: string; decider: { full_name: string } | null }[] | null
}

async function loadApprovals(admin: AnyClient, orgId: string, scope: ReportViewerScope, since: string): Promise<ExecApproval[]> {
  const { rows } = await fetchAll<RawApproval>((from, to) => {
    const q = admin.from('approvals')
      .select('id, request_id, status, created_at, decisions:approval_decisions(decision, decided_at, decider:profiles!approval_decisions_decided_by_fkey(full_name)), request:requests!inner(org_id, team_id, requester_id, assigned_to)')
      .eq('request.org_id', orgId)
      .gte('created_at', since)
    return applyScope(q, scope, 'request.').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  })
  const out: ExecApproval[] = []
  for (const a of rows) {
    if (a.status !== 'pending' && a.status !== 'approved' && a.status !== 'rejected') continue // cancelled ones don't count
    const last = [...(a.decisions ?? [])].sort((x, y) => new Date(x.decided_at).getTime() - new Date(y.decided_at).getTime()).pop()
    const decided = a.status === 'pending' ? null : last ? new Date(last.decided_at).getTime() : new Date(a.created_at).getTime()
    out.push({
      id: a.id, reqId: a.request_id, status: a.status, requested: new Date(a.created_at).getTime(),
      decided, by: last?.decider?.full_name ?? '',
    })
  }
  return out
}
