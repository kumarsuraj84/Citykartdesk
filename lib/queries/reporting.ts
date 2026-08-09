import { createAdminClient } from '@/lib/supabase/admin'
import { getEntityFields, RECORD_COUNT_FIELD, type EntityKey, type ReportField } from '@/lib/reporting/field-registry'
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

/** The field list the UI shows for an entity — static columns + (for tasks) whatever
 * custom fields exist across the org's teams right now. */
export async function getReportFieldsForEntity(entity: EntityKey, orgId: string): Promise<ReportField[]> {
  if (entity !== 'tasks') return [RECORD_COUNT_FIELD, ...getEntityFields(entity)]
  const admin = createAdminClient() as unknown as AnyClient
  const customFields = await getOrgTaskCustomFields(admin, orgId)
  return [RECORD_COUNT_FIELD, ...getEntityFields(entity, customFields.map(customFieldToReportField))]
}

// ── Row fetch + shape-normalization per entity ─────────────────────────────────
// Service-role client, explicit org_id scoping (same posture as lib/export/reports.ts —
// this is an admin/manager-only surface, gated in lib/actions/reporting.ts).

async function fetchRequestRows(admin: AnyClient, orgId: string): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const { data } = await admin
    .from('requests')
    .select(`
      id, request_no, title, status, priority, created_at, updated_at,
      resolved_at, closed_at, resolution_due_at, response_due_at,
      service:services(name), team:teams(name), project:projects(name),
      requester:profiles!requests_requester_id_fkey(full_name),
      assignee:profiles!requests_assigned_to_fkey(full_name)
    `)
    .eq('org_id', orgId)
    .limit(MAX_REPORT_ROWS + 1)

  type Row = {
    id: string; request_no: string; title: string; status: string; priority: string
    created_at: string; updated_at: string; resolved_at: string | null; closed_at: string | null
    resolution_due_at: string | null; response_due_at: string | null
    service: { name: string } | null; team: { name: string } | null; project: { name: string } | null
    requester: { full_name: string } | null; assignee: { full_name: string } | null
  }

  const all = (data ?? []) as Row[]
  const truncated = all.length > MAX_REPORT_ROWS
  const rows = all.slice(0, MAX_REPORT_ROWS).map((r) => {
    const now = nowIso()
    const closedLike = r.resolved_at ?? r.closed_at
    const isBreached = !!r.resolution_due_at && (closedLike ? closedLike > r.resolution_due_at : now > r.resolution_due_at)
    return {
      request_no: r.request_no,
      title: r.title,
      status: r.status,
      priority: r.priority,
      service_name: r.service?.name ?? '',
      team_name: r.team?.name ?? '',
      requester_name: r.requester?.full_name ?? '',
      assignee_name: r.assignee?.full_name ?? '',
      project_name: r.project?.name ?? '',
      created_at: r.created_at,
      updated_at: r.updated_at,
      resolved_at: r.resolved_at,
      closed_at: r.closed_at,
      resolution_due_at: r.resolution_due_at,
      response_due_at: r.response_due_at,
      age_days: daysBetween(r.created_at, closedLike ?? now),
      resolution_days: r.resolved_at ? daysBetween(r.created_at, r.resolved_at) : null,
      is_sla_breached: isBreached,
    } satisfies ReportRow
  })
  return { rows, truncated }
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
  const now = nowIso()
  const rows = all.slice(0, MAX_REPORT_ROWS).map((a) => ({
    request_no: a.request?.request_no ?? '',
    workflow_name: a.workflow?.name ?? '',
    status: a.status,
    current_step: a.current_step,
    created_at: a.created_at,
    updated_at: a.updated_at,
    age_days: daysBetween(a.created_at, now),
  } satisfies ReportRow))
  return { rows, truncated }
}

export async function fetchReportData(entity: EntityKey, orgId: string): Promise<ReportDataResult> {
  const admin = createAdminClient() as unknown as AnyClient

  if (entity === 'tasks') {
    const customFields = await getOrgTaskCustomFields(admin, orgId)
    const { rows, truncated } = await fetchTaskRows(admin, orgId, customFields)
    return { fields: [RECORD_COUNT_FIELD, ...getEntityFields(entity, customFields.map(customFieldToReportField))], rows, truncated }
  }

  const fetchers: Record<Exclude<EntityKey, 'tasks'>, (a: AnyClient, o: string) => Promise<{ rows: ReportRow[]; truncated: boolean }>> = {
    requests: fetchRequestRows,
    projects: fetchProjectRows,
    milestones: fetchMilestoneRows,
    approvals: fetchApprovalRows,
  }
  const { rows, truncated } = await fetchers[entity](admin, orgId)
  return { fields: [RECORD_COUNT_FIELD, ...getEntityFields(entity)], rows, truncated }
}
