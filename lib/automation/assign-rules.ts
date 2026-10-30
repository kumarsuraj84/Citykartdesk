import { createAdminClient } from '@/lib/supabase/admin'
import { matchesConditions, type RuleCondition, type RuleConditionsLogic } from '@/lib/rules/evaluate'
import { executeActions, type RuleAction } from '@/lib/rules/actions'
import { buildRuleEvaluationRequest, RULE_REQUEST_SELECT, toActionRequest, type RawRequest } from '@/lib/rules/run'

// Giving a ticket to a technician again, for "Run automation again" and the automatic retry.
//
// When a ticket is made, EVERY action of the matching "created" Business Rules runs (assign, set priority, set status, notify ...). Running all of them a second time later
// would send the notifications again and could undo what an agent changed since (priority, status). The only thing a re-run is for is "nobody has this ticket", so this runs
// the ASSIGN actions only, and only for a ticket that is still Open with nobody on it. It reads the rules and facts exactly like lib/rules/run.ts does (same functions).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

type RuleRow = { id: string; name: string; conditions: RuleCondition[]; conditions_logic: RuleConditionsLogic; actions: RuleAction[]; execution_order: number }

async function fetchRequest(admin: AnyClient, requestId: string): Promise<RawRequest | null> {
  const { data, error } = await admin.from('requests').select(RULE_REQUEST_SELECT).eq('id', requestId).maybeSingle()
  if (error) throw new Error(`Could not read ticket ${requestId} for the Business Rules: ${error.message ?? 'unknown error'}`)
  return (data as RawRequest) ?? null
}

/** Runs the assign actions of the matching "created" rules for one unassigned, Open ticket. Throws when the rules or the ticket cannot be read. */
export async function runCreatedAssignRules(requestId: string): Promise<{ ran: boolean }> {
  const admin = createAdminClient() as unknown as AnyClient
  let request = await fetchRequest(admin, requestId)
  if (!request || !request.org_id) return { ran: false }
  // somebody (or another run) already took care of it: nothing to give
  if (request.assigned_to || request.status !== 'open') return { ran: false }

  const { data: rules, error } = await admin.from('business_rules')
    .select('id, name, conditions, conditions_logic, actions, execution_order')
    .eq('org_id', request.org_id).contains('trigger', ['created']).eq('is_active', true).order('execution_order', { ascending: true })
  if (error) throw new Error(`Could not read the Business Rules (created): ${error.message ?? 'unknown error'}`)

  let ran = false
  let evalRequest = await buildRuleEvaluationRequest(admin, request)
  for (const rule of (rules ?? []) as RuleRow[]) {
    const assignOnly = (rule.actions ?? []).filter((a) => a.type === 'assign')
    if (assignOnly.length === 0) continue
    if (!matchesConditions(evalRequest, rule.conditions ?? [], rule.conditions_logic)) continue
    await executeActions(admin, toActionRequest(request), assignOnly, { ruleId: rule.id, ruleName: rule.name, trigger: 'created' })
    ran = true
    const refreshed = await fetchRequest(admin, requestId)
    if (refreshed) { request = refreshed; evalRequest = await buildRuleEvaluationRequest(admin, request) }
  }
  return { ran }
}
