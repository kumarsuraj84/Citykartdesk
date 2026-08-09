// Central definition of what's reportable in the pivot/dynamic-table builder.
// Each entity's field list mirrors the curated columns lib/export/reports.ts
// already exports (raw DB columns + resolved FK display names), plus a small
// set of derived date-math fields (age/overdue) that are cheap to compute
// client-side from columns already being fetched and are the fields ITSM
// reporting actually asks for most. Task custom fields are NOT listed here
// (they're per-org/per-team and fetched at runtime) — see
// lib/queries/reporting.ts's `withCustomFields()`, which merges them in.

export type FieldDataType = 'string' | 'number' | 'date' | 'boolean' | 'enum'

export interface FieldOption {
  value: string
  label: string
}

export interface ReportField {
  /** Dot-path into the row object produced by lib/queries/reporting.ts, e.g. "assignee_name" or "custom:<field_id>". */
  key: string
  label: string
  type: FieldDataType
  /** For type 'enum': the fixed value set, used for filter dropdowns and legend labels. */
  options?: FieldOption[]
  /** Row/Column pivot dimension eligibility. Defaults to true for every type except free-text description-like fields. */
  groupable?: boolean
  isCustomField?: boolean
  customFieldId?: string
}

export type EntityKey = 'requests' | 'tasks' | 'projects' | 'milestones' | 'approvals'

export interface ReportEntityDef {
  key: EntityKey
  label: string
  fields: ReportField[]
}

// ── Shared enum option sets (mirrors types/database.ts Enums, kept in sync by hand
// since these change rarely — see docs/DATABASE.md §1 for the source of truth) ──

const REQUEST_STATUS: FieldOption[] = [
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_user', label: 'Waiting on User' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]
const REQUEST_PRIORITY: FieldOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]
const TASK_STATUS: FieldOption[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]
const TASK_PRIORITY: FieldOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]
const TASK_TYPE: FieldOption[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'team', label: 'Team' },
]
const PROJECT_STATUS: FieldOption[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]
const PROJECT_PRIORITY: FieldOption[] = [
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3' },
]
const APPROVAL_STATUS: FieldOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
]

const BOOL_OPTIONS: FieldOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

// A synthetic field every entity gets, for "how many rows" — the most common
// pivot value field (Excel's "Count of <table>"). Not a real column.
export const RECORD_COUNT_FIELD: ReportField = {
  key: '__count__', label: 'Record Count', type: 'number', groupable: false,
}

export const REPORT_ENTITIES: Record<EntityKey, ReportEntityDef> = {
  requests: {
    key: 'requests',
    label: 'Requests',
    fields: [
      { key: 'request_no', label: 'Request #', type: 'string' },
      { key: 'title', label: 'Title', type: 'string', groupable: false },
      { key: 'status', label: 'Status', type: 'enum', options: REQUEST_STATUS },
      { key: 'priority', label: 'Priority', type: 'enum', options: REQUEST_PRIORITY },
      { key: 'service_name', label: 'Service', type: 'string' },
      { key: 'team_name', label: 'Team', type: 'string' },
      { key: 'requester_name', label: 'Requester', type: 'string' },
      { key: 'assignee_name', label: 'Assignee', type: 'string' },
      { key: 'project_name', label: 'Project', type: 'string' },
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'updated_at', label: 'Updated', type: 'date' },
      { key: 'resolved_at', label: 'Resolved', type: 'date' },
      { key: 'closed_at', label: 'Closed', type: 'date' },
      { key: 'resolution_due_at', label: 'Resolution Due', type: 'date' },
      { key: 'response_due_at', label: 'Response Due', type: 'date' },
      { key: 'age_days', label: 'Age (days)', type: 'number', groupable: false },
      { key: 'resolution_days', label: 'Resolution Time (days)', type: 'number', groupable: false },
      { key: 'is_sla_breached', label: 'SLA Breached', type: 'boolean', options: BOOL_OPTIONS },
    ],
  },
  tasks: {
    key: 'tasks',
    label: 'Tasks',
    fields: [
      { key: 'title', label: 'Title', type: 'string', groupable: false },
      { key: 'status', label: 'Status', type: 'enum', options: TASK_STATUS },
      { key: 'priority', label: 'Priority', type: 'enum', options: TASK_PRIORITY },
      { key: 'task_type', label: 'Type', type: 'enum', options: TASK_TYPE },
      { key: 'assignee_name', label: 'Assignee', type: 'string' },
      { key: 'created_by_name', label: 'Created By', type: 'string' },
      { key: 'team_name', label: 'Team', type: 'string' },
      { key: 'project_name', label: 'Project', type: 'string' },
      { key: 'milestone_name', label: 'Enhancement', type: 'string' },
      { key: 'linked_request_no', label: 'Linked Request', type: 'string' },
      { key: 'tags', label: 'Tags', type: 'string', groupable: false },
      { key: 'start_date', label: 'Start Date', type: 'date' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'completed_at', label: 'Completed', type: 'date' },
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'age_days', label: 'Age (days)', type: 'number', groupable: false },
      { key: 'is_overdue', label: 'Overdue', type: 'boolean', options: BOOL_OPTIONS },
    ],
  },
  projects: {
    key: 'projects',
    label: 'Projects',
    fields: [
      { key: 'name', label: 'Name', type: 'string', groupable: false },
      { key: 'status', label: 'Status', type: 'enum', options: PROJECT_STATUS },
      { key: 'priority', label: 'Priority', type: 'enum', options: PROJECT_PRIORITY },
      { key: 'owner_name', label: 'Tech Owner', type: 'string' },
      { key: 'functional_owner_name', label: 'Functional Owner', type: 'string' },
      { key: 'team_name', label: 'Team', type: 'string' },
      { key: 'created_by_name', label: 'Created By', type: 'string' },
      { key: 'start_date', label: 'Start Date', type: 'date' },
      { key: 'target_date', label: 'Target Date', type: 'date' },
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'age_days', label: 'Age (days)', type: 'number', groupable: false },
      { key: 'is_overdue', label: 'Overdue', type: 'boolean', options: BOOL_OPTIONS },
    ],
  },
  milestones: {
    key: 'milestones',
    label: 'Milestones',
    fields: [
      { key: 'name', label: 'Name', type: 'string', groupable: false },
      { key: 'project_name', label: 'Project', type: 'string' },
      { key: 'status', label: 'Status', type: 'enum', options: PROJECT_STATUS },
      { key: 'priority', label: 'Priority', type: 'enum', options: PROJECT_PRIORITY },
      { key: 'owner_name', label: 'Owner', type: 'string' },
      { key: 'functional_owner_name', label: 'Functional Owner', type: 'string' },
      { key: 'percent_complete', label: '% Complete', type: 'number', groupable: false },
      { key: 'start_date', label: 'Start Date', type: 'date' },
      { key: 'end_date', label: 'End Date', type: 'date' },
      { key: 'is_overdue', label: 'Overdue', type: 'boolean', options: BOOL_OPTIONS },
    ],
  },
  approvals: {
    key: 'approvals',
    label: 'Approvals',
    fields: [
      { key: 'request_no', label: 'Request', type: 'string' },
      { key: 'workflow_name', label: 'Workflow', type: 'string' },
      { key: 'status', label: 'Status', type: 'enum', options: APPROVAL_STATUS },
      { key: 'current_step', label: 'Current Step', type: 'number', groupable: false },
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'updated_at', label: 'Updated', type: 'date' },
      { key: 'age_days', label: 'Age (days)', type: 'number', groupable: false },
    ],
  },
}

/** Aggregation functions that make sense for a given field data type — drives the
 * dropdown shown once a field is dropped into the Values well. */
export function aggregationsForType(type: FieldDataType): { value: string; label: string }[] {
  switch (type) {
    case 'number':
      return [
        { value: 'sum', label: 'Sum' },
        { value: 'avg', label: 'Average' },
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
        { value: 'count', label: 'Count' },
      ]
    case 'date':
      return [
        { value: 'min', label: 'Earliest' },
        { value: 'max', label: 'Latest' },
        { value: 'count', label: 'Count' },
      ]
    case 'boolean':
      return [
        { value: 'countTrue', label: 'Count Yes' },
        { value: 'countFalse', label: 'Count No' },
        { value: 'count', label: 'Count' },
      ]
    case 'string':
    case 'enum':
    default:
      return [
        { value: 'count', label: 'Count' },
        { value: 'countDistinct', label: 'Count Distinct' },
      ]
  }
}

export function getEntityFields(entity: EntityKey, extra: ReportField[] = []): ReportField[] {
  return [...REPORT_ENTITIES[entity].fields, ...extra]
}
