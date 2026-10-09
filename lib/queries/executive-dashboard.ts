import { createAdminClient } from '@/lib/supabase/admin'
import { resolveReportAccess, agentScopeOrFilter, type ReportViewerScope } from '@/lib/reporting/access'
import { UNASSIGNED, NO_CATEGORY, NO_LOCATION, type ExecTicket, type ExecApproval, type Priority } from '@/lib/reporting/executive/engine'
import { levelFor, type DashLevel } from '@/lib/reporting/executive/levels'
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
    store: { name: string; state: string | null; oem: { name: string } | null } | null
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
  'requester:profiles!requests_requester_id_fkey(full_name, department:departments!profiles_department_id_fkey(name), location:locations(name), store:stores(name, state, oem:oems(name)))',
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

export function toExecTicket(r: Raw, now: number): ExecTicket {
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
    src: via ? (SOURCE_LABEL[via] ?? titleCase(via)) : 'Portal',
    prio: r.priority,
    status: r.status,
    created,
    resolved,
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
  }
}

/** Loads the compact ticket and approval rows the Executive Dashboard works from, limited to the viewer's level. */
export async function loadExecutiveData(profile: ProfileWithTeams): Promise<ExecutiveData | { error: string }> {
  const level = levelFor(profile.role)
  if (!level || !profile.org_id) return { error: "You don't have access to this dashboard." }
  const access = resolveReportAccess(profile, 'requests')
  if ('error' in access) return { error: access.error }
  const scope = access.scope

  const admin = createAdminClient() as unknown as AnyClient
  const nowDate = new Date()
  const now = nowDate.getTime()
  const since = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString()

  const { rows, truncated } = await fetchAll<Raw>((from, to) => {
    // Cancelled tickets are loaded too (the normal dashboard counts them as created); they only come from inside the look-back.
    const q = admin.from('requests').select(SELECT).eq('org_id', profile.org_id)
      .eq('reopens.action', 'reopened')
      .or(`created_at.gte.${since},and(resolved_at.is.null,closed_at.is.null,status.neq.cancelled)`)
    return applyScope(q, scope, '').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  })
  const tickets = rows.map((r) => toExecTicket(r, now))

  const approvals = await loadApprovals(admin, profile.org_id, scope, since)
  return { level, me: profile.full_name, now, tickets, approvals, truncated }
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
