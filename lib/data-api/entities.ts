// The entities the read-only data API (/api/data/v1) hands to the data platform (DBA). Each one lists, by name, EVERY column it returns: nothing is ever "select *".
//
// Privacy rules (agreed with the DBA, 2 Nov 2026):
//  - no e-mail address or mobile number of anybody, and no free text typed by people (ticket title / description / comments / remarks / forms / cancel reasons / CSAT comments);
//  - people appear as an opaque id (pii "id") and, only in the `users` entity, their display name (pii "name", agreed by the owner on 2 Nov 2026), plus role and store / department ids; comments appear as flags and a length, never as text;
//  - every store carries its CKDesk store code (`store_code`), the key the data platform joins to its own site list.
import { isoUtc } from './params'
import { isServerRoomAc } from '@/lib/reporting/analytics/facts'

export type ColType = 'uuid' | 'text' | 'int' | 'numeric' | 'bool' | 'timestamptz' | 'date' | 'json'
/** no = no personal data; id = an opaque id of a person; name = the display name of a person (owner agreed 2 Nov 2026; never e-mail, mobile or employee number); derived = worked out by the API from other columns */
export type Pii = 'no' | 'id' | 'name' | 'derived'
export type Col = { name: string; type: ColType; pii: Pii; note?: string }

/** incremental = has an updated-at column that moves on every change; append = rows are only ever added; snapshot = no reliable change date, read it all (small tables). */
export type Mode = 'incremental' | 'append' | 'snapshot'

/** How a row is tied to the organisation when the table has no org_id: follow `column` to `table`.id and read `carry` (the next hop, finally org_id). */
export type OrgHop = { column: string; table: string; carry: string }

export type Ctx = {
  /** profile id -> store code (of the people on this page) */
  storeOfProfile: Map<string, string>
  /** store id -> store code */
  storeCode: Map<string, string>
  /** ticket id -> the key of the AC it is about ("STORE|ac number"); only for AC tickets that say which AC */
  acKeyOfRequest?: Map<string, string>
}
export type Row = Record<string, unknown>

export type EntityDef = {
  name: string
  description: string
  table: string
  mode: Mode
  /** column the pages are ordered by (with id); 'id' for a snapshot */
  cursor: string
  /** columns read from the table (all of them listed; nothing else is ever fetched) */
  select: string[]
  org: 'direct' | OrgHop[]
  /** extra filter of the table, e.g. only the status changes of the activity log */
  where?: { column: string; value: string }
  /** a table with no row id of its own: its key is these two columns, and the API shows a synthetic text id "first:second" (the cursor and the ids list use it) */
  compositeKey?: [string, string]
  /** the columns the API returns */
  columns: Col[]
  needsStoreOfProfile?: { profileColumns: string[] }
  needsStoreCode?: boolean
  /** the rows are tickets and the API works out which AC each one is about (see ./ac-key) */
  needsAcKey?: boolean
  map: (r: Row, ctx: Ctx) => Row
}

/** The Server Room AC as the AC sheet writes it: the AC number "Server Room" (217 rows on live, one per store), also "Server Room AC" or "Server Room 2". The AC Calendar's own rule (isServerRoomAc) is narrower and is NOT changed here. */
export const isServerRoomUnit = (acNo: string): boolean => isServerRoomAc(acNo) || /^\s*server\s*room(\s|$)/i.test(acNo)

const c = (name: string, type: ColType, pii: Pii = 'no', note?: string): Col => ({ name, type, pii, ...(note ? { note } : {}) })
const ts = isoUtc
const pick = (r: Row, names: string[], times: string[] = []): Row => {
  const o: Row = {}
  for (const n of names) o[n] = times.includes(n) ? ts(r[n]) : (r[n] ?? null)
  return o
}
const str = (v: unknown, max = 40): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null)

const REQUEST_TIMES = ['created_at', 'updated_at', 'responded_at', 'resolved_at', 'closed_at', 'response_due_at', 'resolution_due_at', 'waiting_since']
const REQUEST_PLAIN = ['id', 'request_no', 'service_id', 'category_id', 'sub_category_id', 'status', 'priority', 'team_id', 'requester_id', 'assigned_to', 'parent_request_id',
  'created_at', 'updated_at', 'responded_at', 'resolved_at', 'closed_at', 'response_due_at', 'resolution_due_at', 'waiting_since', 'paused_ms_total', 'reopen_count']

export const ENTITIES: EntityDef[] = [
  {
    name: 'requests', table: 'requests', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'One row per ticket: service / category, status, priority, people (ids only), the store of the requester, and the SLA times. No title, description or form text.',
    select: REQUEST_PLAIN,
    columns: [
      c('id', 'uuid'), c('request_no', 'text'), c('service_id', 'uuid'), c('category_id', 'uuid'), c('sub_category_id', 'uuid'), c('status', 'text'), c('priority', 'text'), c('team_id', 'uuid'),
      c('requester_id', 'uuid', 'id'), c('assigned_to', 'uuid', 'id', 'the technician'), c('parent_request_id', 'uuid'),
      c('store_code', 'text', 'derived', 'CKDesk store code of the requester; null for a head-office user'),
      c('ac_key', 'text', 'derived', 'which AC an AC ticket is about: STORE code in capitals + "|" + the AC number in lower case, e.g. "ABC|ac 3" (the key the AC Calendar uses); null for any other ticket or when the ticket does not say which AC'),
      c('created_at', 'timestamptz'), c('updated_at', 'timestamptz'), c('responded_at', 'timestamptz'), c('resolved_at', 'timestamptz'), c('closed_at', 'timestamptz'),
      c('response_due_at', 'timestamptz'), c('resolution_due_at', 'timestamptz'), c('waiting_since', 'timestamptz', 'no', 'set while the ticket waits for the user'),
      c('paused_ms_total', 'int', 'no', 'milliseconds the SLA clock was paused'), c('reopen_count', 'int'),
      c('response_breached', 'bool', 'derived', 'responded_at later than response_due_at; null while not answered or no target'),
      c('resolution_breached', 'bool', 'derived', 'resolved_at later than resolution_due_at; null while not resolved or no target'),
    ],
    needsStoreOfProfile: { profileColumns: ['requester_id'] },
    needsAcKey: true,
    map: (r, ctx) => {
      const late = (done: unknown, due: unknown) => (done && due ? new Date(String(done)).getTime() > new Date(String(due)).getTime() : null)
      return {
        ...pick(r, REQUEST_PLAIN, REQUEST_TIMES),
        store_code: ctx.storeOfProfile.get(String(r.requester_id)) ?? null,
        ac_key: ctx.acKeyOfRequest?.get(String(r.id)) ?? null,
        response_breached: late(r.responded_at, r.response_due_at),
        resolution_breached: late(r.resolved_at, r.resolution_due_at),
      }
    },
  },
  {
    name: 'request_status_history', table: 'request_activity', mode: 'append', cursor: 'created_at', org: [{ column: 'request_id', table: 'requests', carry: 'org_id' }],
    where: { column: 'action', value: 'status_changed' },
    description: 'Every status change of every ticket (from -> to, when, by whom as an id). Only added to, never changed.',
    select: ['id', 'request_id', 'actor_id', 'created_at', 'metadata'],
    columns: [c('id', 'uuid'), c('request_id', 'uuid'), c('actor_id', 'uuid', 'id'), c('created_at', 'timestamptz'), c('from_status', 'text'), c('to_status', 'text')],
    map: (r) => {
      const m = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>
      return { id: r.id, request_id: r.request_id, actor_id: r.actor_id ?? null, created_at: ts(r.created_at), from_status: str(m.from), to_status: str(m.to) }
    },
  },
  {
    name: 'request_comments', table: 'request_comments', mode: 'append', cursor: 'created_at', org: [{ column: 'request_id', table: 'requests', carry: 'org_id' }],
    description: 'One row per message on a ticket, as flags only: who (id), when, internal or public, the channel, and the length. NEVER the text.',
    select: ['id', 'request_id', 'author_id', 'is_internal', 'source', 'created_at', 'body', 'external_email'],
    columns: [c('id', 'uuid'), c('request_id', 'uuid'), c('author_id', 'uuid', 'id', 'null when the writer was outside CKDesk'), c('is_internal', 'bool'), c('source', 'text'),
      c('from_external', 'bool', 'derived'), c('text_length', 'int', 'derived', 'number of characters; the text itself is never sent'), c('created_at', 'timestamptz')],
    map: (r) => ({
      id: r.id, request_id: r.request_id, author_id: r.author_id ?? null, is_internal: !!r.is_internal, source: str(r.source),
      from_external: !!r.external_email, text_length: typeof r.body === 'string' ? r.body.length : 0, created_at: ts(r.created_at),
    }),
  },
  {
    name: 'services', table: 'services', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The services of the catalogue (names, switches, SLA policy). No form definition, keywords or description.',
    select: ['id', 'name', 'slug', 'is_active', 'status', 'team_id', 'sla_policy_id', 'default_priority', 'owner_id', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('slug', 'text'), c('is_active', 'bool'), c('status', 'text'), c('team_id', 'uuid'), c('sla_policy_id', 'uuid'), c('default_priority', 'text'),
      c('owner_id', 'uuid', 'id', 'the service owner'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'slug', 'is_active', 'status', 'team_id', 'sla_policy_id', 'default_priority', 'owner_id', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'service_categories', table: 'service_categories', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The categories under the services.',
    select: ['id', 'name', 'slug', 'is_active', 'is_pms', 'program_id', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('slug', 'text'), c('is_active', 'bool'), c('is_pms', 'bool', 'no', 'the AC PMS category'), c('program_id', 'uuid', 'no', 'the Vendor Program it belongs to'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'slug', 'is_active', 'is_pms', 'program_id', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'service_sub_categories', table: 'service_sub_categories', mode: 'incremental', cursor: 'updated_at', org: [{ column: 'category_id', table: 'service_categories', carry: 'org_id' }],
    description: 'The sub-categories under the categories.',
    select: ['id', 'category_id', 'name', 'slug', 'is_active', 'sla_priority', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('category_id', 'uuid'), c('name', 'text'), c('slug', 'text'), c('is_active', 'bool'), c('sla_priority', 'text'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'category_id', 'name', 'slug', 'is_active', 'sla_priority', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'stores', table: 'stores', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The store master: code, place, region / cluster, priority list, opening date and the AC facts. `code` is the CKDesk store code the data platform joins on.',
    select: ['id', 'code', 'name', 'address', 'city', 'state', 'pincode', 'region', 'cluster', 'priority_list', 'festival', 'open_date', 'is_active', 'ac_total', 'ac_brand', 'ac_amc_brand', 'ac_amc_vendor', 'zenatix', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('code', 'text', 'no', 'store code; the join key'), c('name', 'text'), c('address', 'text', 'no', 'a business address'), c('city', 'text'), c('state', 'text'), c('pincode', 'text'), c('region', 'text'),
      c('cluster', 'text'), c('priority_list', 'text'), c('festival', 'text'), c('open_date', 'date'), c('is_active', 'bool'), c('ac_total', 'int'), c('ac_brand', 'text'), c('ac_amc_brand', 'text'),
      c('ac_amc_vendor', 'text'), c('zenatix', 'bool'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'code', 'name', 'address', 'city', 'state', 'pincode', 'region', 'cluster', 'priority_list', 'festival', 'open_date', 'is_active', 'ac_total', 'ac_brand', 'ac_amc_brand', 'ac_amc_vendor', 'zenatix', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'sla_policies', table: 'sla_policies', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The SLA policies and their targets (config).',
    select: ['id', 'name', 'is_active', 'config', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('is_active', 'bool'), c('config', 'json', 'no', 'the targets by priority'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'is_active', 'config', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'csat_surveys', table: 'csat_surveys', mode: 'snapshot', cursor: 'id', org: 'direct',
    description: 'The rating survey of each resolved ticket: rating and dates. The comment the requester typed is never sent. The table has no change date, so it is read in full (small).',
    select: ['id', 'request_id', 'rating', 'sent_at', 'submitted_at', 'reminder_sent_at'],
    columns: [c('id', 'uuid'), c('request_id', 'uuid'), c('rating', 'int', 'no', '1-5; null until answered'), c('sent_at', 'timestamptz'), c('submitted_at', 'timestamptz'), c('reminder_sent_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'request_id', 'rating', 'sent_at', 'submitted_at', 'reminder_sent_at'], ['sent_at', 'submitted_at', 'reminder_sent_at']),
  },
  {
    name: 'approvals', table: 'approvals', mode: 'incremental', cursor: 'updated_at', org: [{ column: 'request_id', table: 'requests', carry: 'org_id' }],
    description: 'The approval of a ticket: its status and the step it is at.',
    select: ['id', 'request_id', 'status', 'current_step', 'workflow_id', 'requested_by', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('request_id', 'uuid'), c('status', 'text'), c('current_step', 'int'), c('workflow_id', 'uuid'), c('requested_by', 'uuid', 'id'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'request_id', 'status', 'current_step', 'workflow_id', 'requested_by', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'approval_decisions', table: 'approval_decisions', mode: 'append', cursor: 'decided_at',
    org: [{ column: 'approval_id', table: 'approvals', carry: 'request_id' }, { column: 'request_id', table: 'requests', carry: 'org_id' }],
    description: 'Each approve / reject decision (who as an id, step, decision, when). The approver\'s comment is never sent.',
    select: ['id', 'approval_id', 'step_order', 'decision', 'decided_by', 'decided_at'],
    columns: [c('id', 'uuid'), c('approval_id', 'uuid'), c('step_order', 'int'), c('decision', 'text'), c('decided_by', 'uuid', 'id'), c('decided_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'approval_id', 'step_order', 'decision', 'decided_by', 'decided_at'], ['decided_at']),
  },
  {
    name: 'teams', table: 'teams', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The support teams (names behind team_id). The notification e-mail address of a team is never sent.',
    select: ['id', 'name', 'slug', 'prefix', 'department_id', 'is_active', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('slug', 'text'), c('prefix', 'text'), c('department_id', 'uuid'), c('is_active', 'bool'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'slug', 'prefix', 'department_id', 'is_active', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'departments', table: 'departments', mode: 'snapshot', cursor: 'id', org: 'direct',
    description: 'The departments (names behind department_id). The head of department (a person) is never sent. No change date, so read in full (small).',
    select: ['id', 'name', 'code', 'parent_id', 'is_active', 'created_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('code', 'text'), c('parent_id', 'uuid'), c('is_active', 'bool'), c('created_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'code', 'parent_id', 'is_active', 'created_at'], ['created_at']),
  },
  {
    name: 'locations', table: 'locations', mode: 'snapshot', cursor: 'id', org: 'direct',
    description: 'The locations (names behind location_id). No change date, so read in full (small).',
    select: ['id', 'name', 'code', 'city', 'country', 'timezone', 'is_active', 'created_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('code', 'text'), c('city', 'text'), c('country', 'text'), c('timezone', 'text'), c('is_active', 'bool'), c('created_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'code', 'city', 'country', 'timezone', 'is_active', 'created_at'], ['created_at']),
  },
  {
    name: 'approval_workflows', table: 'approval_workflows', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The approval workflows (names behind workflow_id). Their description text is not sent.',
    select: ['id', 'name', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'programs', table: 'vendor_programs', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The Vendor Programs (AC, Genset, RO ...; names behind program_id). Mail wording, sheet links and vendor addresses are never sent.',
    select: ['id', 'name', 'slug', 'level', 'row_type', 'is_active', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid'), c('name', 'text'), c('slug', 'text'), c('level', 'text', 'no', 'mail or portal'), c('row_type', 'text', 'no', 'machine or store'), c('is_active', 'bool'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')],
    map: (r) => pick(r, ['id', 'name', 'slug', 'level', 'row_type', 'is_active', 'created_at', 'updated_at'], ['created_at', 'updated_at']),
  },
  {
    name: 'ac_units', table: 'master_ac_units', mode: 'snapshot', cursor: 'id', org: 'direct',
    description: 'The air conditioners of the AC sheet (about 2,400 rows, read in full): store code, AC number, brand, tonnage, whether the AC is active or was removed, and whether it is the Server Room AC. `store_code` + `ckdesk_no` (lower case) is the `ac_key` of the tickets. No serial number, vendor, e-mail or address.',
    select: ['id', 'store_code', 'ckdesk_no', 'brand', 'tonnage', 'is_active', 'removed_at'],
    columns: [c('id', 'uuid'), c('store_code', 'text', 'no', 'CKDesk store code, capitals'), c('ckdesk_no', 'text', 'no', 'the AC number the store uses on its tickets'), c('brand', 'text'), c('tonnage', 'text'), c('is_active', 'bool'),
      c('is_server_room', 'bool', 'derived', 'the AC number is "Server Room" (how the AC sheet writes the server-room AC, one per store); the AC Calendar does not use this flag and still counts these ACs'), c('removed_at', 'timestamptz', 'no', 'set when the AC left the sheet; null while it is on it')],
    map: (r) => ({
      id: r.id, store_code: typeof r.store_code === 'string' ? r.store_code.trim().toUpperCase() : null, ckdesk_no: str(r.ckdesk_no, 60), brand: str(r.brand, 60), tonnage: str(r.tonnage, 30),
      is_active: !!r.is_active, is_server_room: isServerRoomUnit(String(r.ckdesk_no ?? '')), removed_at: ts(r.removed_at),
    }),
  },
  {
    name: 'users', table: 'profiles', mode: 'incremental', cursor: 'updated_at', org: 'direct',
    description: 'The people: opaque id and display name, role, active flag, store, department and location. No e-mail, mobile number or employee number. Every other entity refers to a person by id only; join to this one for the name.',
    select: ['id', 'full_name', 'role', 'is_active', 'store_id', 'department_id', 'location_id', 'vendor_company_id', 'manager_id', 'created_at', 'updated_at'],
    columns: [c('id', 'uuid', 'id'), c('full_name', 'text', 'name', 'display name only'), c('role', 'text'), c('is_active', 'bool'), c('store_code', 'text', 'derived', 'null for head-office users'), c('department_id', 'uuid'), c('location_id', 'uuid'),
      c('is_vendor', 'bool', 'derived', 'a vendor / OEM technician login'), c('created_at', 'timestamptz'), c('updated_at', 'timestamptz'),
      c('manager_id', 'uuid', 'id', 'the direct manager (the Manager box on the account), an opaque id; null when none')],
    needsStoreCode: true,
    map: (r, ctx) => ({
      id: r.id, full_name: str(r.full_name, 120), role: r.role ?? null, is_active: !!r.is_active, store_code: r.store_id ? (ctx.storeCode.get(String(r.store_id)) ?? null) : null,
      department_id: r.department_id ?? null, location_id: r.location_id ?? null, is_vendor: !!r.vendor_company_id, created_at: ts(r.created_at), updated_at: ts(r.updated_at), manager_id: r.manager_id ?? null,
    }),
  },
  {
    name: 'approval_workflow_steps', table: 'approval_workflow_steps', mode: 'snapshot', cursor: 'id', org: [{ column: 'workflow_id', table: 'approval_workflows', carry: 'org_id' }],
    description: 'The steps of every approval workflow: who approves which step (an opaque id, or "any manager"). Together with approvals.current_step this says whom a pending approval waits for. The workflow tables have no change date, so read in full (small).',
    select: ['id', 'workflow_id', 'step_order', 'approver_type', 'approver_user_id'],
    columns: [c('id', 'uuid'), c('workflow_id', 'uuid'), c('step_order', 'int'), c('approver_type', 'text', 'no', 'specific_user or any_manager'), c('approver_user_id', 'uuid', 'id', 'null for an any_manager step')],
    map: (r) => pick(r, ['id', 'workflow_id', 'step_order', 'approver_type', 'approver_user_id']),
  },
  {
    name: 'team_members', table: 'team_members', mode: 'snapshot', cursor: 'id', org: 'direct', compositeKey: ['team_id', 'user_id'],
    description: 'Who is in which support team (ids only). The table has no row id: "id" is made as team_id:user_id. No change date, so read in full (small).',
    select: ['team_id', 'user_id', 'is_lead', 'joined_at'],
    columns: [c('id', 'text', 'no', 'team_id:user_id, made by the API'), c('team_id', 'uuid'), c('user_id', 'uuid', 'id'), c('is_lead', 'bool'), c('joined_at', 'timestamptz')],
    map: (r) => ({ id: `${r.team_id}:${r.user_id}`, team_id: r.team_id ?? null, user_id: r.user_id ?? null, is_lead: !!r.is_lead, joined_at: ts(r.joined_at) }),
  },
]

export const entityByName = (name: string) => ENTITIES.find((e) => e.name === name)
