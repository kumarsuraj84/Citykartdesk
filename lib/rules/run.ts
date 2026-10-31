import { createAdminClient } from '@/lib/supabase/admin'
import { matchesConditions, type RuleCondition, type RuleConditionsLogic, type RuleEvaluationRequest } from './evaluate'
import { executeActions, type RuleAction, type ActionRequest } from './actions'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { libraryFieldValues } from '@/lib/forms/library'
import { sourceChannelOf } from '@/lib/sources'
import { isSlaPausedStatus } from '@/lib/constants/requests'
import { storeFactsFromRow, STORE_DETAIL_COLUMNS, type StoreFacts } from '@/lib/stores/details'
import type { SLAConfig, FormSection, FormField } from '@/types'

export { sourceChannelOf }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

type BusinessRuleRow = {
  id: string
  name: string
  conditions: RuleCondition[]
  conditions_logic: RuleConditionsLogic
  actions: RuleAction[]
  execution_order: number
}

export type RawRequest = {
  id: string
  request_no: string
  title: string
  description: string | null
  priority: string
  status: string
  service_id: string
  team_id: string
  project_id: string | null
  requester_id: string
  assigned_to: string | null
  org_id: string | null
  created_at: string
  resolved_at: string | null
  closed_at: string | null
  source_metadata: unknown
  form_data: Record<string, unknown> | null
  waiting_since: string | null
  response_due_at: string | null
  resolution_due_at: string | null
  category_id: string | null
  sub_category_id: string | null
  reopen_count: number | null
  responded_at: string | null
  paused_ms_total: number | null
  service: {
    template_id: string | null
    sla_policy: { config: SLAConfig | null } | null
    form_sections: FormSection[] | null
    form_fields: FormField[] | null
    template: { form_sections: FormSection[] | null } | null
  } | null
  requester: {
    role: string
    department_id: string | null
    location_id: string | null
    designation_id: string | null
    function_id: string | null
  } | null
}

export const RULE_REQUEST_SELECT =
  'id, request_no, title, description, priority, status, service_id, team_id, project_id, requester_id, assigned_to, org_id, created_at, resolved_at, closed_at, source_metadata, form_data, waiting_since, response_due_at, resolution_due_at, category_id, sub_category_id, reopen_count, responded_at, paused_ms_total, service:services(template_id, sla_policy:sla_policies(config), form_sections, form_fields, template:form_templates(form_sections)), requester:profiles!requester_id(role, department_id, location_id, designation_id, function_id, store_id)'

async function fetchRequest(admin: AnyClient, requestId: string): Promise<RawRequest | null> {
  const { data, error } = await admin.from('requests').select(RULE_REQUEST_SELECT).eq('id', requestId).maybeSingle()
  // a failed read must not look like "no such ticket" (the rules would silently not run and the ticket be marked as done)
  if (error) throw new Error(`Could not read ticket ${requestId} for the Business Rules: ${error.message ?? 'unknown error'}`)
  return (data as RawRequest) ?? null
}

/** Is the ticket past its resolution deadline? Real instants are compared (F-03: the database may write the same moment as '...Z' or '...-07:00', and as TEXT
 *  those compare wrongly by hours). A ticket whose SLA clock is paused (waiting on the user / a purchase / an approval) is not breached (F-02). */
export function isSlaBreached(request: Pick<RawRequest, 'resolution_due_at' | 'resolved_at' | 'closed_at' | 'status'>, nowMs: number = Date.now()): boolean {
  if (!request.resolution_due_at) return false
  const dueMs = new Date(request.resolution_due_at).getTime()
  const closedLike = request.resolved_at ?? request.closed_at
  if (closedLike) return new Date(closedLike).getTime() > dueMs
  if (isSlaPausedStatus(request.status)) return false
  return nowMs > dueMs
}

/** Whole days since the ticket was created (1.5 days is 1, not 2: a rule "older than 2 days" must not fire at 36 hours). */
export function ageDays(request: Pick<RawRequest, 'created_at'>, nowMs: number = Date.now()): number {
  return Math.floor((nowMs - new Date(request.created_at).getTime()) / 86_400_000)
}

async function hasAttachment(admin: AnyClient, requestId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('request_attachments')
    .select('id')
    .eq('request_id', requestId)
    .is('deleted_at', null)
    .limit(1)
  if (error) throw new Error(`Could not read the attachments of ticket ${requestId}: ${error.message ?? 'unknown error'}`)
  return (data?.length ?? 0) > 0
}

/** The AC the ticket was raised for (saved with the ticket), as far as a rule needs it. Empty strings when the ticket has none. */
async function acFacts(admin: AnyClient, requestId: string) {
  const { data, error } = await admin.from('request_master_snapshots').select('snapshot').eq('request_id', requestId).eq('kind', 'ac').maybeSingle()
  // an unreadable snapshot must not look like "this ticket has no AC" (a "is not ..." condition would then match wrongly)
  if (error) throw new Error(`Could not read the AC of ticket ${requestId}: ${error.message ?? 'unknown error'}`)
  const unit = (Array.isArray(data?.snapshot) ? data.snapshot[0] : null) as Record<string, string | null> | null
  const s = (v: string | null | undefined) => (v ?? '').trim()
  if (unit) return { ac_amc_vendor: s(unit.amc_vendor), ac_brand: s(unit.brand), store_region: s(unit.region), store_state: s(unit.state), store_cluster: s(unit.cluster) }
  // No AC record: a ticket of a Vendor Program (for example AC after its categories were moved onto a program) keeps the sheet row of its program instead. The rules that route by
  // the AC vendor, brand or place keep working from it: the vendor is the row's Vendor, and brand / region / state / cluster are the row's columns with those headings.
  const { data: ps, error: pErr } = await admin.from('request_program_snapshots').select('snapshot').eq('request_id', requestId).limit(1).maybeSingle()
  if (pErr) throw new Error(`Could not read the program row of ticket ${requestId}: ${pErr.message ?? 'unknown error'}`)
  const row = (Array.isArray(ps?.snapshot) ? ps.snapshot[0] : null) as { vendor?: string | null; extra?: Record<string, string> | null } | null
  const extra = (row?.extra ?? {}) as Record<string, string>
  const byHeading = (...names: string[]) => {
    const want = names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''))
    for (const [h, v] of Object.entries(extra)) if (want.includes(h.toLowerCase().replace(/[^a-z0-9]/g, ''))) return s(v)
    return ''
  }
  return { ac_amc_vendor: s(row?.vendor), ac_brand: byHeading('ac brand', 'brand'), store_region: byHeading('region'), store_state: byHeading('state'), store_cluster: byHeading('cluster') }
}

/**
 * The standard details of the requester's store (region, state, cluster, city, priority list, festival, months since opening), from the store card: the main store master,
 * the same for a ticket of any service, with or without a Vendor Program. Null when the requester has no store or the store has no card.
 */
async function storeCardFacts(admin: AnyClient, orgId: string | null, storeId: string): Promise<StoreFacts | null> {
  if (!storeId || !orgId) return null
  const { data, error } = await admin.from('stores').select(STORE_DETAIL_COLUMNS).eq('org_id', orgId).eq('id', storeId).maybeSingle()
  // an unreadable store card must not look like "this store has no region" (an "is not ..." condition would then match wrongly)
  if (error) throw new Error(`Could not read the store of a ticket for the Business Rules: ${error.message ?? 'unknown error'}`)
  return Array.isArray(data) ? null : storeFactsFromRow(data as Record<string, string | null> | null)
}

/** The Vendor Program / vendor facts of a ticket, from CK Desk's own settings: its category's program (or the built-in AC / Genset line) and the company of the vendor technician who has it. */
async function vendorFacts(admin: AnyClient, request: { category_id: string | null; assigned_to: string | null }) {
  let vendor_line = ''
  if (request.category_id) {
    const { data, error } = await admin.from('service_categories').select('program_id, auto_oem_kind').eq('id', request.category_id).maybeSingle()
    if (error) throw new Error(`Could not read the category of a ticket for the Business Rules: ${error.message ?? 'unknown error'}`)
    vendor_line = (data?.program_id as string | null) ?? (data?.auto_oem_kind as string | null) ?? ''
  }
  let vendor_company_id = ''
  if (request.assigned_to) {
    const { data: p, error } = await admin.from('profiles').select('vendor_company_id, vendor_role').eq('id', request.assigned_to).maybeSingle()
    if (error) throw new Error(`Could not read the assignee of a ticket for the Business Rules: ${error.message ?? 'unknown error'}`)
    if (p?.vendor_company_id && p.vendor_role === 'technician') vendor_company_id = p.vendor_company_id as string
  }
  return { vendor_line, vendor_company_id, is_with_vendor: vendor_company_id !== '' }
}

/**
 * The ONE builder of the facts a rule's conditions are checked against. The "created"/"updated" rules (this file) and the scheduled rules
 * (app/api/business-rules/run) both use it: the scheduled path used to build its own partial copy that lacked the AC / vendor / store facts
 * (ac_amc_vendor, store_region, vendor_line, is_with_vendor ...), so a scheduled rule with such a condition never matched (is / is one of)
 * or always matched (is not / is not one of) (B-25 / H-01).
 */
export async function buildRuleEvaluationRequest(admin: AnyClient, request: RawRequest): Promise<RuleEvaluationRequest> {
  const storeId = (request.requester as { store_id?: string | null } | null)?.store_id ?? ''
  const ac = await acFacts(admin, request.id)
  const store = await storeCardFacts(admin, request.org_id, storeId)
  // the store card first (it exists for every ticket of the store); the AC row / program row saved with the ticket only fills what the card leaves empty, so the rules that
  // were made for the AC sheet's region, state and cluster keep matching
  const card = (fromStore: string | undefined, fallback: string) => (fromStore && fromStore !== '' ? fromStore : fallback)
  return {
    ...ac,
    store_region: card(store?.region, ac.store_region),
    store_state: card(store?.state, ac.store_state),
    store_cluster: card(store?.cluster, ac.store_cluster),
    store_city: store?.city ?? '',
    store_priority: store?.priority ?? '',
    store_festival: store?.festival ?? '',
    store_open_months: store?.openMonths == null ? '' : String(store.openMonths),
    ...(await vendorFacts(admin, request)),
    requester_store_id: storeId,
    priority: request.priority,
    status: request.status,
    service_id: request.service_id,
    category_id: request.category_id,
    sub_category_id: request.sub_category_id,
    template_id: request.service?.template_id ?? null,
    team_id: request.team_id,
    project_id: request.project_id,
    assigned_to: request.assigned_to,
    requester_id: request.requester_id,
    requester_role: request.requester?.role ?? '',
    requester_department_id: request.requester?.department_id ?? null,
    requester_location_id: request.requester?.location_id ?? null,
    requester_designation_id: request.requester?.designation_id ?? null,
    requester_function_id: request.requester?.function_id ?? null,
    title: request.title,
    description: request.description,
    source_channel: sourceChannelOf(request.source_metadata),
    is_sla_breached: isSlaBreached(request),
    has_attachment: await hasAttachment(admin, request.id),
    age_days: ageDays(request),
    form_data: request.form_data,
    library_field_values: libraryFieldValues(resolveServiceFormSections(request.service ?? {}), request.form_data),
  }
}

export function toActionRequest(request: RawRequest): ActionRequest {
  return {
    id: request.id,
    request_no: request.request_no,
    title: request.title,
    requester_id: request.requester_id,
    assigned_to: request.assigned_to,
    org_id: request.org_id,
    status: request.status,
    priority: request.priority,
    service_id: request.service_id,
    team_id: request.team_id,
    created_at: request.created_at,
    form_data: request.form_data ?? {},
    waiting_since: request.waiting_since,
    response_due_at: request.response_due_at,
    resolution_due_at: request.resolution_due_at,
    reopen_count: request.reopen_count ?? 0,
    responded_at: request.responded_at,
    paused_ms_total: Number(request.paused_ms_total ?? 0),
    service: {
      sla_policy: request.service?.sla_policy ?? null,
      form_sections: request.service?.form_sections ?? null,
      form_fields: request.service?.form_fields ?? null,
      template: request.service?.template ?? null,
    },
  }
}

/**
 * Runs every active `created`/`updated`-trigger business rule (in
 * execution_order) against one request, executing the actions of every rule
 * whose conditions match — not stop-on-first-match, so a later rule's action
 * (e.g. a second `assign`) can deliberately override an earlier one. This is
 * the single call site both createRequest and the status/priority-change
 * actions use — see lib/actions/requests.ts.
 *
 * `allowReassign` is for a deliberate re-routing (the category was changed): only then may an assign action of an "edited" rule replace a person who already has
 * the ticket. After any other edit an assign rule only fills an empty slot (B-02).
 *
 * A rule's `trigger` is an array (a rule can fire on Created AND Edited, not
 * just one), so this queries with a containment check rather than equality.
 *
 * Re-fetches the request after every rule that actually matched and ran its
 * actions, so a later rule's condition check sees that rule's writes instead
 * of the stale snapshot taken at the start of this function — otherwise a
 * second rule keyed off the field a first rule just changed (e.g. rule A sets
 * status to resolved, rule B is conditioned on status = resolved) would
 * evaluate against pre-write data and silently never fire.
 */
export async function runRulesForTrigger(trigger: 'created' | 'updated', requestId: string, opts: { allowReassign?: boolean } = {}): Promise<void> {
  const admin = createAdminClient() as unknown as AnyClient

  let request = await fetchRequest(admin, requestId)
  if (!request || !request.org_id) return

  const { data: rules, error: rulesError } = await admin
    .from('business_rules')
    .select('id, name, conditions, conditions_logic, actions, execution_order')
    .eq('org_id', request.org_id)
    .contains('trigger', [trigger])
    .eq('is_active', true)
    .order('execution_order', { ascending: true })

  // a failed read is an error, not "there are no rules" (the caller would then mark the rules as having run)
  if (rulesError) throw new Error(`Could not read the Business Rules (${trigger}): ${rulesError.message ?? 'unknown error'}`)
  if (!rules || rules.length === 0) return

  // Computed once per request "version" rather than once per rule — one of
  // its fields (has_attachment) costs a real DB query, and the request only
  // actually changes when a rule's actions run (recomputed below in that
  // case), not on every loop iteration.
  let evalRequest = await buildRuleEvaluationRequest(admin, request)

  for (const rule of rules as BusinessRuleRow[]) {
    if (!matchesConditions(evalRequest, rule.conditions ?? [], rule.conditions_logic)) continue

    await executeActions(admin, toActionRequest(request), rule.actions ?? [], { ruleId: rule.id, ruleName: rule.name, trigger, allowReassign: opts.allowReassign })

    const refreshed = await fetchRequest(admin, requestId)
    if (refreshed) {
      request = refreshed
      evalRequest = await buildRuleEvaluationRequest(admin, request)
    }
  }
}
