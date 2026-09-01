import { createAdminClient } from '@/lib/supabase/admin'
import { getEntityFields, RECORD_COUNT_FIELD, type EntityKey, type ReportField } from '@/lib/reporting/field-registry'
import type { ReportViewerScope } from '@/lib/reporting/access'
import { getServiceFormFieldsForOrg, type ServiceFormFieldRef } from '@/lib/forms/sections'
import { flattenLeafOptions } from '@/lib/forms/options'
import type { Database } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export const MAX_REPORT_ROWS = 20000

export type ReportRow = Record<string, string | number | boolean | null>

export interface ReportDataResult {
  fields: ReportField[]
  rows: ReportRow[]
  truncated: boolean
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

const nowIso = () => new Date().toISOString()

// ── Task custom fields — dynamic, per-org, merged into the static registry ────

type CustomFieldDef = Database['public']['Tables']['task_custom_fields']['Row']

async function getOrgTaskCustomFields(admin: AnyClient, orgId: string): Promise<CustomFieldDef[]> {
  const { data: teams } = await admin.from('teams').select('id').eq('org_id', orgId)
  const teamIds = (teams ?? []).map((t: { id: string }) => t.id)
  if (teamIds.length === 0) return []
  const { data } = await admin
    .from('task_custom_fields')
    .select('*')
    .in('team_id', teamIds)
    .order('position', { ascending: true })
  return (data ?? []) as CustomFieldDef[]
}

function customFieldToReportField(f: CustomFieldDef): ReportField {
  const key = `custom:${f.id}`
  switch (f.field_type) {
    case 'number':
      return { key, label: f.name, type: 'number', groupable: false, isCustomField: true, customFieldId: f.id }
    case 'date':
      return { key, label: f.name, type: 'date', isCustomField: true, customFieldId: f.id }
    case 'checkbox':
      return {
        key, label: f.name, type: 'boolean', isCustomField: true, customFieldId: f.id,
        options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }],
      }
    case 'dropdown': {
      const opts = Array.isArray(f.options) ? (f.options as Array<{ value: string }>) : []
      return {
        key, label: f.name, type: 'enum', isCustomField: true, customFieldId: f.id,
        options: opts.map((o) => ({ value: o.value, label: o.value })),
      }
    }
    case 'multi_select':
    case 'text':
    default:
      return { key, label: f.name, type: 'string', groupable: f.field_type !== 'multi_select', isCustomField: true, customFieldId: f.id }
  }
}

// ── Request custom fields — every active service's intake-form fields, dynamic
// per-org, merged into the static registry just like task custom fields ──────

const FORM_FIELD_PREFIX = 'form:'
// 'toggle' is excluded — FieldRenderer.tsx has no render case for it (see the
// matching note in BusinessRulesClient.tsx), so it never collects a value and
// isn't reportable. 'file' holds an upload, not a scalar value worth a column.
const SKIPPED_FORM_FIELD_TYPES = new Set(['toggle', 'file'])

function serviceFormFieldToReportField(f: ServiceFormFieldRef): ReportField {
  const key = `${FORM_FIELD_PREFIX}${f.id}`
  const label = `${f.serviceName}: ${f.label}`
  switch (f.type) {
    case 'number':
      return { key, label, type: 'number', groupable: false, isCustomField: true, customFieldId: f.id }
    case 'date':
      return { key, label, type: 'date', isCustomField: true, customFieldId: f.id }
    case 'checkbox':
      return {
        key, label, type: 'boolean', isCustomField: true, customFieldId: f.id,
        options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }],
      }
    case 'select':
    case 'radio':
      return {
        key, label, type: 'enum', isCustomField: true, customFieldId: f.id,
        options: flattenLeafOptions(f.options),
      }
    case 'multiselect':
      return { key, label, type: 'string', groupable: false, isCustomField: true, customFieldId: f.id }
    default: // text, textarea, email, phone
      return { key, label, type: 'string', isCustomField: true, customFieldId: f.id }
  }
}

async function getOrgRequestFormFields(admin: AnyClient, orgId: string): Promise<ServiceFormFieldRef[]> {
  const all = await getServiceFormFieldsForOrg(admin, orgId)
  return all.filter((f) => !SKIPPED_FORM_FIELD_TYPES.has(f.type))
}

/** The field list the UI shows for an entity — static columns + whatever
 * dynamic custom fields exist right now (per-org intake-form fields for
 * requests, per-team custom fields for tasks). */
export async function getReportFieldsForEntity(entity: EntityKey, orgId: string): Promise<ReportField[]> {
  const admin = createAdminClient() as unknown as AnyClient
  if (entity === 'tasks') {
    const customFields = await getOrgTaskCustomFields(admin, orgId)
    return [RECORD_COUNT_FIELD, ...getEntityFields(entity, customFields.map(customFieldToReportField))]
  }
  if (entity === 'requests') {
    const formFields = await getOrgRequestFormFields(admin, orgId)
    return [RECORD_COUNT_FIELD, ...getEntityFields(entity, formFields.map(serviceFormFieldToReportField))]
  }
  return [RECORD_COUNT_FIELD, ...getEntityFields(entity)]
}

// ── Row fetch + shape-normalization per entity ─────────────────────────────────
// Service-role client, explicit org_id scoping (same posture as lib/export/reports.ts —
// this is an admin/manager-only surface, gated in lib/actions/reporting.ts).

function sourceChannelOf(sourceMetadata: unknown): string {
  const createdVia = (sourceMetadata as { created_via?: string } | null)?.created_via
  return createdVia === 'intake' ? 'intake' : 'portal'
}

async function fetchRequestRows(
  admin: AnyClient,
  orgId: string,
  scope: ReportViewerScope,
  formFields: ServiceFormFieldRef[]
): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  // { kind: 'team' } with no teams means "on no team" — an empty .in() filter
  // would otherwise match every row instead of none.
  if (scope.kind === 'team' && scope.teamIds.length === 0) return { rows: [], truncated: false }

  let query = admin
    .from('requests')
    .select(`
      id, request_no, title, description, status, priority, created_at, updated_at,
      responded_at, resolved_at, closed_at, resolution_due_at, response_due_at, source_metadata, form_data,
      service:services(name, template:form_templates(name)),
      category:service_categories(name), sub_category:service_sub_categories(name),
      team:teams(name), project:projects(name),
      requester:profiles!requests_requester_id_fkey(full_name),
      assignee:profiles!requests_assigned_to_fkey(full_name)
    `)
    .eq('org_id', orgId)

  if (scope.kind === 'own') query = query.eq('requester_id', scope.userId)
  else if (scope.kind === 'agent') query = query.or(`assigned_to.eq.${scope.userId},requester_id.eq.${scope.userId}`)
  else if (scope.kind === 'team') query = query.in('team_id', scope.teamIds)

  const { data } = await query.limit(MAX_REPORT_ROWS + 1)

  type Row = {
    id: string; request_no: string; title: string; description: string | null; status: string; priority: string
    created_at: string; updated_at: string; responded_at: string | null; resolved_at: string | null; closed_at: string | null
    resolution_due_at: string | null; response_due_at: string | null; source_metadata: unknown
    form_data: Record<string, unknown> | null
    service: { name: string; template: { name: string } | null } | null
    category: { name: string } | null; sub_category: { name: string } | null
    team: { name: string } | null; project: { name: string } | null
    requester: { full_name: string } | null; assignee: { full_name: string } | null
  }

  const all = (data ?? []) as Row[]
  const truncated = all.length > MAX_REPORT_ROWS
  const pageRows = all.slice(0, MAX_REPORT_ROWS)
  const requestIds = pageRows.map((r) => r.id)

  const [collabCounts, attachmentCounts, commentCounts, timeMinutes, csatRatings, approvalSummaries] = await Promise.all([
    countByRequestId(admin, 'request_collaborators', requestIds),
    countByRequestId(admin, 'request_attachments', requestIds, (q) => q.is('deleted_at', null)),
    countByRequestId(admin, 'request_comments', requestIds),
    sumTimeTrackedMinutes(admin, requestIds),
    getCsatRatings(admin, requestIds),
    getApprovalSummaryByRequestId(admin, requestIds),
  ])

  const now = nowIso()
  const rows = pageRows.map((r) => {
    const closedLike = r.resolved_at ?? r.closed_at
    const isSlaBreached = !!r.resolution_due_at && (closedLike ? closedLike > r.resolution_due_at : now > r.resolution_due_at)
    const isResponseSlaBreached = !!r.response_due_at && (r.responded_at ? r.responded_at > r.response_due_at : now > r.response_due_at)
    const row: ReportRow = {
      request_no: r.request_no,
      title: r.title,
      description: r.description ?? '',
      status: r.status,
      priority: r.priority,
      service_name: r.service?.name ?? '',
      category_name: r.category?.name ?? '',
      sub_category_name: r.sub_category?.name ?? '',
      template_name: r.service?.template?.name ?? '',
      team_name: r.team?.name ?? '',
      requester_name: r.requester?.full_name ?? '',
      assignee_name: r.assignee?.full_name ?? '',
      project_name: r.project?.name ?? '',
      source_channel: sourceChannelOf(r.source_metadata),
      approval_status: approvalSummaries.get(r.id)?.status ?? 'not_sent',
      approved_by_name: approvalSummaries.get(r.id)?.decidedByName ?? '',
      approval_decided_at: approvalSummaries.get(r.id)?.decidedAt ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      responded_at: r.responded_at,
      resolved_at: r.resolved_at,
      closed_at: r.closed_at,
      resolution_due_at: r.resolution_due_at,
      response_due_at: r.response_due_at,
      age_days: daysBetween(r.created_at, closedLike ?? now),
      resolution_days: r.resolved_at ? daysBetween(r.created_at, r.resolved_at) : null,
      is_sla_breached: isSlaBreached,
      is_response_sla_breached: isResponseSlaBreached,
      csat_rating: csatRatings.get(r.id) ?? null,
      collaborator_count: collabCounts.get(r.id) ?? 0,
      attachment_count: attachmentCounts.get(r.id) ?? 0,
      comment_count: commentCounts.get(r.id) ?? 0,
      time_tracked_minutes: timeMinutes.get(r.id) ?? 0,
    }
    for (const f of formFields) {
      const raw = r.form_data?.[f.id]
      row[`${FORM_FIELD_PREFIX}${f.id}`] = raw === undefined || raw === null
        ? null
        : Array.isArray(raw) ? raw.join(', ')
        : (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') ? raw
        : String(raw)
    }
    return row
  })
  return { rows, truncated }
}

// Supabase's .in() is serialized into the GET request's query string — a
// single batch covering all 20,000 possible rows would produce a multi-
// hundred-KB URL, well past what most proxies/gateways/PostgREST allow.
// Every request_id-scoped aggregate below batches through this.
const IN_CLAUSE_BATCH_SIZE = 200

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function selectInBatches<T>(
  admin: AnyClient,
  table: string,
  select: string,
  ids: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refine?: (q: any) => any,
  idColumn = 'request_id'
): Promise<T[]> {
  if (ids.length === 0) return []
  const results = await Promise.all(
    chunk(ids, IN_CLAUSE_BATCH_SIZE).map(async (batch) => {
      let query = admin.from(table).select(select).in(idColumn, batch)
      if (refine) query = refine(query)
      const { data } = await query
      return (data ?? []) as T[]
    })
  )
  return results.flat()
}

/** Bulk-fetch-and-reduce row count per request_id — mirrors the pattern used
 * elsewhere in this codebase for per-entity rollups (e.g. getTechnicianWorkloadBoard
 * in lib/queries/requests.ts) rather than a per-row correlated subquery. */
async function countByRequestId(
  admin: AnyClient,
  table: string,
  requestIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refine?: (q: any) => any
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const rows = await selectInBatches<{ request_id: string }>(admin, table, 'request_id', requestIds, refine)
  for (const row of rows) counts.set(row.request_id, (counts.get(row.request_id) ?? 0) + 1)
  return counts
}

async function sumTimeTrackedMinutes(admin: AnyClient, requestIds: string[]): Promise<Map<string, number>> {
  const minutes = new Map<string, number>()
  const rows = await selectInBatches<{ request_id: string; started_at: string; stopped_at: string }>(
    admin, 'request_time_entries', 'request_id, started_at, stopped_at', requestIds,
    (q) => q.not('stopped_at', 'is', null)
  )
  for (const e of rows) {
    const mins = Math.round((new Date(e.stopped_at).getTime() - new Date(e.started_at).getTime()) / 60_000)
    minutes.set(e.request_id, (minutes.get(e.request_id) ?? 0) + Math.max(0, mins))
  }
  return minutes
}

async function getCsatRatings(admin: AnyClient, requestIds: string[]): Promise<Map<string, number>> {
  const ratings = new Map<string, number>()
  const rows = await selectInBatches<{ request_id: string; rating: number }>(
    admin, 'csat_surveys', 'request_id, rating', requestIds,
    (q) => q.not('rating', 'is', null)
  )
  for (const s of rows) ratings.set(s.request_id, s.rating)
  return ratings
}

type RequestApprovalSummary = { status: string; decidedByName: string; decidedAt: string | null }

/** Per-request "was this sent for approval, and what happened" — a request
 * with no approvals row at all is simply absent from the returned map
 * (callers treat that as "not_sent"). For a ticket with more than one
 * approval cycle, only the most recent cycle's outcome is kept. */
async function getApprovalSummaryByRequestId(
  admin: AnyClient,
  requestIds: string[]
): Promise<Map<string, RequestApprovalSummary>> {
  type ApprovalRow = { id: string; request_id: string; status: string; created_at: string }
  const approvals = await selectInBatches<ApprovalRow>(
    admin, 'approvals', 'id, request_id, status, created_at', requestIds
  )
  if (approvals.length === 0) return new Map()

  // Latest approval cycle per request (highest created_at wins).
  const latestByRequest = new Map<string, ApprovalRow>()
  for (const a of approvals) {
    const existing = latestByRequest.get(a.request_id)
    if (!existing || a.created_at > existing.created_at) latestByRequest.set(a.request_id, a)
  }

  const approvalIds = [...latestByRequest.values()].map((a) => a.id)
  type DecisionRow = { approval_id: string; decided_at: string; decider: { full_name: string } | null }
  const decisions = await selectInBatches<DecisionRow>(
    admin,
    'approval_decisions',
    'approval_id, decided_at, decider:profiles!approval_decisions_decided_by_fkey(full_name)',
    approvalIds,
    undefined,
    'approval_id'
  )
  // Latest decision per approval (highest decided_at wins) — same
  // "who decided this" resolution as the Approvals report entity.
  const latestDecisionByApproval = new Map<string, DecisionRow>()
  for (const d of decisions) {
    const existing = latestDecisionByApproval.get(d.approval_id)
    if (!existing || d.decided_at > existing.decided_at) latestDecisionByApproval.set(d.approval_id, d)
  }

  const summaries = new Map<string, RequestApprovalSummary>()
  for (const [requestId, approval] of latestByRequest) {
    const decision = latestDecisionByApproval.get(approval.id)
    summaries.set(requestId, {
      status: approval.status,
      decidedByName: decision?.decider?.full_name ?? '',
      decidedAt: decision?.decided_at ?? null,
    })
  }
  return summaries
}

async function fetchTaskRows(admin: AnyClient, orgId: string, customFields: CustomFieldDef[]): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const { data } = await admin
    .from('tasks')
    .select(`
      id, title, status, priority, task_type, start_date, due_date, completed_at, created_at, tags,
      team:teams(name), project:projects(name), milestone:milestones(name), request:requests(request_no),
      assignee:profiles!tasks_assignee_id_fkey(full_name),
      created_by_profile:profiles!tasks_created_by_fkey(full_name)
    `)
    .eq('org_id', orgId)
    .limit(MAX_REPORT_ROWS + 1)

  type Row = {
    id: string; title: string; status: string; priority: string; task_type: string
    start_date: string | null; due_date: string | null; completed_at: string | null; created_at: string
    tags: string[] | null
    team: { name: string } | null; project: { name: string } | null; milestone: { name: string } | null
    request: { request_no: string } | null
    assignee: { full_name: string } | null; created_by_profile: { full_name: string } | null
  }

  const all = (data ?? []) as Row[]
  const truncated = all.length > MAX_REPORT_ROWS
  const taskIds = all.slice(0, MAX_REPORT_ROWS).map((t) => t.id)

  const valuesByTask = new Map<string, Map<string, unknown>>()
  if (customFields.length > 0 && taskIds.length > 0) {
    const { data: values } = await admin
      .from('task_custom_field_values')
      .select('task_id, field_id, value')
      .in('task_id', taskIds)
    for (const v of (values ?? []) as { task_id: string; field_id: string; value: unknown }[]) {
      if (!valuesByTask.has(v.task_id)) valuesByTask.set(v.task_id, new Map())
      valuesByTask.get(v.task_id)!.set(v.field_id, v.value)
    }
  }

  const now = nowIso()
  const rows = all.slice(0, MAX_REPORT_ROWS).map((t) => {
    const isOverdue = !!t.due_date && !t.completed_at && t.due_date < now
    const row: ReportRow = {
      title: t.title,
      status: t.status,
      priority: t.priority,
      task_type: t.task_type,
      assignee_name: t.assignee?.full_name ?? '',
      created_by_name: t.created_by_profile?.full_name ?? '',
      team_name: t.team?.name ?? '',
      project_name: t.project?.name ?? '',
      milestone_name: t.milestone?.name ?? '',
      linked_request_no: t.request?.request_no ?? '',
      tags: (t.tags ?? []).join(', '),
      start_date: t.start_date,
      due_date: t.due_date,
      completed_at: t.completed_at,
      created_at: t.created_at,
      age_days: daysBetween(t.created_at, t.completed_at ?? now),
      is_overdue: isOverdue,
    }
    const fieldValues = valuesByTask.get(t.id)
    for (const cf of customFields) {
      const raw = fieldValues?.get(cf.id)
      row[`custom:${cf.id}`] = raw === undefined || raw === null
        ? null
        : Array.isArray(raw) ? raw.join(', ')
        : (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') ? raw
        : String(raw)
    }
    return row
  })
  return { rows, truncated }
}

async function fetchProjectRows(admin: AnyClient, orgId: string): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const { data } = await admin
    .from('projects')
    .select(`
      id, name, status, priority, start_date, target_date, created_at,
      team:teams(name),
      owner:profiles!projects_owner_id_fkey(full_name),
      functional_owner:profiles!projects_functional_owner_id_fkey(full_name),
      created_by_profile:profiles!projects_created_by_fkey(full_name)
    `)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .limit(MAX_REPORT_ROWS + 1)

  type Row = {
    id: string; name: string; status: string; priority: string
    start_date: string | null; target_date: string | null; created_at: string
    team: { name: string } | null
    owner: { full_name: string } | null; functional_owner: { full_name: string } | null
    created_by_profile: { full_name: string } | null
  }

  const all = (data ?? []) as Row[]
  const truncated = all.length > MAX_REPORT_ROWS
  const now = nowIso()
  const rows = all.slice(0, MAX_REPORT_ROWS).map((p) => ({
    name: p.name,
    status: p.status,
    priority: p.priority,
    owner_name: p.owner?.full_name ?? '',
    functional_owner_name: p.functional_owner?.full_name ?? '',
    team_name: p.team?.name ?? '',
    created_by_name: p.created_by_profile?.full_name ?? '',
    start_date: p.start_date,
    target_date: p.target_date,
    created_at: p.created_at,
    age_days: daysBetween(p.created_at, now),
    is_overdue: !!p.target_date && p.status !== 'done' && p.status !== 'cancelled' && p.target_date < now,
  } satisfies ReportRow))
  return { rows, truncated }
}

async function fetchMilestoneRows(admin: AnyClient, orgId: string): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const { data } = await admin
    .from('milestones')
    .select(`
      id, name, status, priority, percent_complete, start_date, end_date,
      project:projects(name),
      owner:profiles!milestones_owner_id_fkey(full_name),
      functional_owner:profiles!milestones_functional_owner_id_fkey(full_name)
    `)
    .eq('org_id', orgId)
    .limit(MAX_REPORT_ROWS + 1)

  type Row = {
    id: string; name: string; status: string; priority: string; percent_complete: number
    start_date: string | null; end_date: string | null
    project: { name: string } | null
    owner: { full_name: string } | null; functional_owner: { full_name: string } | null
  }

  const all = (data ?? []) as Row[]
  const truncated = all.length > MAX_REPORT_ROWS
  const now = nowIso()
  const rows = all.slice(0, MAX_REPORT_ROWS).map((m) => ({
    name: m.name,
    project_name: m.project?.name ?? '',
    status: m.status,
    priority: m.priority,
    owner_name: m.owner?.full_name ?? '',
    functional_owner_name: m.functional_owner?.full_name ?? '',
    percent_complete: m.percent_complete,
    start_date: m.start_date,
    end_date: m.end_date,
    is_overdue: !!m.end_date && m.status !== 'done' && m.status !== 'cancelled' && m.end_date < now,
  } satisfies ReportRow))
  return { rows, truncated }
}

async function fetchApprovalRows(admin: AnyClient, orgId: string): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const { data } = await admin
    .from('approvals')
    .select(`
      id, status, current_step, created_at, updated_at,
      request:requests!inner(request_no, org_id),
      workflow:approval_workflows(name)
    `)
    .eq('request.org_id', orgId)
    .limit(MAX_REPORT_ROWS + 1)

  type Row = {
    id: string; status: string; current_step: number | null; created_at: string; updated_at: string
    request: { request_no: string } | null
    workflow: { name: string } | null
  }

  const all = (data ?? []) as Row[]
  const truncated = all.length > MAX_REPORT_ROWS
  const page = all.slice(0, MAX_REPORT_ROWS)

  // Who decided each approval, and when — fetched separately since a single
  // approval can carry multiple decisions (sequential steps, or every
  // approver in a parallel one); the most recent one per approval is what
  // "who approved this" resolves to for reporting purposes.
  // Batched the same way every other request_id-scoped aggregate in this file
  // is (IN_CLAUSE_BATCH_SIZE) — page can hold up to MAX_REPORT_ROWS (20,000)
  // approval ids, and a single .in() with that many ids would blow past what
  // PostgREST/most proxies allow in a GET query string.
  const approvalIds = page.map((a) => a.id)
  type DecisionRow = { approval_id: string; decided_at: string; comment: string | null; decider: { full_name: string } | null }
  const latestDecisionByApproval = new Map<string, DecisionRow>()
  const decisions = await selectInBatches<DecisionRow>(
    admin,
    'approval_decisions',
    'approval_id, decided_at, comment, decider:profiles!approval_decisions_decided_by_fkey(full_name)',
    approvalIds,
    undefined,
    'approval_id'
  )
  // selectInBatches doesn't preserve cross-batch ordering, so sort here — the
  // "latest decision wins" fold below needs decided_at ascending, same as the
  // single-query .order('decided_at', { ascending: true }) this replaces.
  decisions.sort((a, b) => a.decided_at.localeCompare(b.decided_at))
  for (const d of decisions) {
    latestDecisionByApproval.set(d.approval_id, d)
  }

  const now = nowIso()
  const rows = page.map((a) => {
    const decision = latestDecisionByApproval.get(a.id)
    return {
      request_no: a.request?.request_no ?? '',
      workflow_name: a.workflow?.name ?? '',
      status: a.status,
      current_step: a.current_step,
      decided_by_name: decision?.decider?.full_name ?? '',
      decided_at: decision?.decided_at ?? null,
      decision_comment: decision?.comment ?? '',
      created_at: a.created_at,
      updated_at: a.updated_at,
      age_days: daysBetween(a.created_at, now),
    } satisfies ReportRow
  })
  return { rows, truncated }
}

export async function fetchReportData(
  entity: EntityKey,
  orgId: string,
  scope: ReportViewerScope = { kind: 'all' }
): Promise<ReportDataResult> {
  const admin = createAdminClient() as unknown as AnyClient

  if (entity === 'tasks') {
    const customFields = await getOrgTaskCustomFields(admin, orgId)
    const { rows, truncated } = await fetchTaskRows(admin, orgId, customFields)
    return { fields: [RECORD_COUNT_FIELD, ...getEntityFields(entity, customFields.map(customFieldToReportField))], rows, truncated }
  }

  if (entity === 'requests') {
    const formFields = await getOrgRequestFormFields(admin, orgId)
    const { rows, truncated } = await fetchRequestRows(admin, orgId, scope, formFields)
    return { fields: [RECORD_COUNT_FIELD, ...getEntityFields(entity, formFields.map(serviceFormFieldToReportField))], rows, truncated }
  }

  const fetchers: Record<Exclude<EntityKey, 'tasks' | 'requests'>, (a: AnyClient, o: string) => Promise<{ rows: ReportRow[]; truncated: boolean }>> = {
    projects: fetchProjectRows,
    milestones: fetchMilestoneRows,
    approvals: fetchApprovalRows,
  }
  const { rows, truncated } = await fetchers[entity](admin, orgId)
  return { fields: [RECORD_COUNT_FIELD, ...getEntityFields(entity)], rows, truncated }
}
