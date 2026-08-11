import { createAdminClient } from '@/lib/supabase/admin'
import { matchesConditions, type RuleCondition, type RuleConditionsLogic, type RuleEvaluationRequest } from './evaluate'
import { executeActions, type RuleAction, type ActionRequest } from './actions'
import type { SLAConfig, FormSection, FormField } from '@/types'

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

type RawRequest = {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  service_id: string
  team_id: string
  requester_id: string
  assigned_to: string | null
  org_id: string | null
  created_at: string
  form_data: Record<string, unknown> | null
  waiting_since: string | null
  response_due_at: string | null
  resolution_due_at: string | null
  service: {
    category_id: string | null
    sub_category_id: string | null
    sla_config: SLAConfig | null
    form_sections: FormSection[] | null
    form_fields: FormField[] | null
  } | null
  requester: {
    department_id: string | null
    location_id: string | null
    designation_id: string | null
    function_id: string | null
  } | null
}

const SELECT =
  'id, title, description, priority, status, service_id, team_id, requester_id, assigned_to, org_id, created_at, form_data, waiting_since, response_due_at, resolution_due_at, service:services(category_id, sub_category_id, sla_config, form_sections, form_fields), requester:profiles!requester_id(department_id, location_id, designation_id, function_id)'

async function fetchRequest(admin: AnyClient, requestId: string): Promise<RawRequest | null> {
  const { data } = await admin.from('requests').select(SELECT).eq('id', requestId).single()
  return (data as RawRequest) ?? null
}

function toEvalRequest(request: RawRequest): RuleEvaluationRequest {
  return {
    priority: request.priority,
    status: request.status,
    service_id: request.service_id,
    category_id: request.service?.category_id ?? null,
    sub_category_id: request.service?.sub_category_id ?? null,
    team_id: request.team_id,
    requester_id: request.requester_id,
    requester_department_id: request.requester?.department_id ?? null,
    requester_location_id: request.requester?.location_id ?? null,
    requester_designation_id: request.requester?.designation_id ?? null,
    requester_function_id: request.requester?.function_id ?? null,
    title: request.title,
    description: request.description,
    form_data: request.form_data,
  }
}

function toActionRequest(request: RawRequest): ActionRequest {
  return {
    id: request.id,
    title: request.title,
    requester_id: request.requester_id,
    assigned_to: request.assigned_to,
    org_id: request.org_id,
    status: request.status,
    priority: request.priority,
    service_id: request.service_id,
    created_at: request.created_at,
    form_data: request.form_data ?? {},
    waiting_since: request.waiting_since,
    response_due_at: request.response_due_at,
    resolution_due_at: request.resolution_due_at,
    service: {
      sla_config: request.service?.sla_config ?? null,
      form_sections: request.service?.form_sections ?? null,
      form_fields: request.service?.form_fields ?? null,
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
export async function runRulesForTrigger(trigger: 'created' | 'updated', requestId: string): Promise<void> {
  const admin = createAdminClient() as unknown as AnyClient

  let request = await fetchRequest(admin, requestId)
  if (!request || !request.org_id) return

  const { data: rules } = await admin
    .from('business_rules')
    .select('id, name, conditions, conditions_logic, actions, execution_order')
    .eq('org_id', request.org_id)
    .contains('trigger', [trigger])
    .eq('is_active', true)
    .order('execution_order', { ascending: true })

  if (!rules || rules.length === 0) return

  for (const rule of rules as BusinessRuleRow[]) {
    if (!matchesConditions(toEvalRequest(request), rule.conditions ?? [], rule.conditions_logic)) continue

    await executeActions(admin, toActionRequest(request), rule.actions ?? [], { ruleId: rule.id, ruleName: rule.name })

    const refreshed = await fetchRequest(admin, requestId)
    if (refreshed) request = refreshed
  }
}
