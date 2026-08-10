import { createAdminClient } from '@/lib/supabase/admin'
import { matchesConditions, type RuleCondition, type RuleEvaluationRequest } from './evaluate'
import { executeActions, type RuleAction, type ActionRequest } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

type BusinessRuleRow = {
  id: string
  name: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  execution_order: number
}

/**
 * Runs every active `created`/`updated`-trigger business rule (in
 * execution_order) against one request, executing the actions of every rule
 * whose conditions match — not stop-on-first-match, so a later rule's action
 * (e.g. a second `assign`) can deliberately override an earlier one. This is
 * the single call site both createRequest and the status/priority-change
 * actions use — see lib/actions/requests.ts.
 */
export async function runRulesForTrigger(trigger: 'created' | 'updated', requestId: string): Promise<void> {
  const admin = createAdminClient() as unknown as AnyClient

  const { data: request } = await admin
    .from('requests')
    .select(
      'id, title, description, priority, status, service_id, team_id, requester_id, assigned_to, org_id, service:services(category_id, sub_category_id)'
    )
    .eq('id', requestId)
    .single()

  if (!request || !request.org_id) return

  const { data: rules } = await admin
    .from('business_rules')
    .select('id, name, conditions, actions, execution_order')
    .eq('org_id', request.org_id)
    .eq('trigger', trigger)
    .eq('is_active', true)
    .order('execution_order', { ascending: true })

  if (!rules || rules.length === 0) return

  const service = request.service as unknown as { category_id: string | null; sub_category_id: string | null } | null

  const evalRequest: RuleEvaluationRequest = {
    priority: request.priority,
    status: request.status,
    service_id: request.service_id,
    category_id: service?.category_id ?? null,
    sub_category_id: service?.sub_category_id ?? null,
    team_id: request.team_id,
    requester_id: request.requester_id,
    title: request.title,
    description: request.description,
  }

  const actionRequest: ActionRequest = {
    id: request.id,
    title: request.title,
    requester_id: request.requester_id,
    assigned_to: request.assigned_to,
    org_id: request.org_id,
  }

  for (const rule of rules as BusinessRuleRow[]) {
    if (!matchesConditions(evalRequest, rule.conditions ?? [])) continue
    await executeActions(admin, actionRequest, rule.actions ?? [], { ruleId: rule.id, ruleName: rule.name })
  }
}
