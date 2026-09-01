import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { computeElapsedBusinessMinutes } from '@/lib/sla/business-hours'
import { matchesConditions, type RuleCondition, type RuleConditionsLogic, type RuleEvaluationRequest } from '@/lib/rules/evaluate'
import { executeActions, type RuleAction, type ActionRequest } from '@/lib/rules/actions'
import type { SLAConfig, FormSection, FormField } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

type BusinessRuleRow = {
  id: string
  name: string
  org_id: string
  schedule_check: 'sla_pct_elapsed' | 'unassigned_minutes'
  schedule_threshold: number
  conditions: RuleCondition[]
  conditions_logic: RuleConditionsLogic
  actions: RuleAction[]
}

/**
 * Evaluates every active `schedule`-trigger business rule against the requests
 * it applies to — the schedule-trigger counterpart to the `created`/`updated`
 * triggers run inline from lib/actions/requests.ts. Same verifyCronSecret +
 * admin-client pattern as app/api/alerts/run;
 * registered as the `business-rules` job in scripts/cron-tick.mjs.
 */
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient() as unknown as AnyClient
  const now = new Date()
  let fired = 0

  const { data: rules } = await admin
    .from('business_rules')
    .select('id, name, org_id, schedule_check, schedule_threshold, conditions, conditions_logic, actions')
    .contains('trigger', ['schedule'])
    .eq('is_active', true)

  for (const rule of (rules ?? []) as BusinessRuleRow[]) {
    try {
      if (rule.schedule_check === 'sla_pct_elapsed') {
        fired += await runSlaPctElapsed(admin, rule, now)
      } else if (rule.schedule_check === 'unassigned_minutes') {
        fired += await runUnassignedMinutes(admin, rule, now)
      }
    } catch (e) {
      console.error(`[business-rules/run] Rule ${rule.id} (${rule.schedule_check}) failed`, e)
    }
  }

  return NextResponse.json({ ok: true, fired })
}

async function alreadyFired(admin: AnyClient, ruleId: string, requestId: string): Promise<boolean> {
  const { data } = await admin
    .from('business_rule_events')
    .select('id')
    .eq('rule_id', ruleId)
    .eq('request_id', requestId)
    .maybeSingle()
  return !!data
}

function sourceChannelOf(sourceMetadata: unknown): string {
  const createdVia = (sourceMetadata as { created_via?: string } | null)?.created_via
  return createdVia === 'intake' ? 'intake' : 'portal'
}

function isSlaBreached(request: RawRequest): boolean {
  if (!request.resolution_due_at) return false
  const closedLike = request.resolved_at ?? request.closed_at
  const now = new Date().toISOString()
  return closedLike ? closedLike > request.resolution_due_at : now > request.resolution_due_at
}

function ageDays(request: RawRequest): number {
  return Math.round((Date.now() - new Date(request.created_at).getTime()) / 86_400_000)
}

async function hasAttachment(admin: AnyClient, requestId: string): Promise<boolean> {
  const { data } = await admin
    .from('request_attachments')
    .select('id')
    .eq('request_id', requestId)
    .is('deleted_at', null)
    .limit(1)
  return (data?.length ?? 0) > 0
}

async function fireRule(admin: AnyClient, rule: BusinessRuleRow, request: RawRequest): Promise<boolean> {
  if (await alreadyFired(admin, rule.id, request.id)) return false

  const evalRequest: RuleEvaluationRequest = {
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
  }
  if (!matchesConditions(evalRequest, rule.conditions ?? [], rule.conditions_logic)) return false

  const actionRequest: ActionRequest = {
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
      sla_policy: request.service?.sla_policy ?? null,
      form_sections: request.service?.form_sections ?? null,
      form_fields: request.service?.form_fields ?? null,
      template: request.service?.template ?? null,
    },
  }
  await executeActions(admin, actionRequest, rule.actions ?? [], { ruleId: rule.id, ruleName: rule.name })
  await admin.from('business_rule_events').insert({ rule_id: rule.id, request_id: request.id })
  return true
}

type RawRequest = {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  service_id: string
  team_id: string
  project_id: string | null
  requester_id: string
  assigned_to: string | null
  org_id: string
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

const REQUEST_SELECT =
  'id, title, description, priority, status, service_id, team_id, project_id, requester_id, assigned_to, org_id, created_at, resolved_at, closed_at, source_metadata, form_data, waiting_since, response_due_at, resolution_due_at, category_id, sub_category_id, service:services(template_id, sla_policy:sla_policies(config), form_sections, form_fields, template:form_templates(form_sections)), requester:profiles!requester_id(role, department_id, location_id, designation_id, function_id)'

async function runSlaPctElapsed(admin: AnyClient, rule: BusinessRuleRow, now: Date): Promise<number> {
  const { data: requests } = await admin
    .from('requests')
    .select(REQUEST_SELECT)
    .eq('org_id', rule.org_id)
    .not('resolution_due_at', 'is', null)
    .not('status', 'in', '("resolved","cancelled","closed")')

  let count = 0
  for (const request of (requests ?? []) as RawRequest[]) {
    const createdAt = new Date(request.created_at)
    const deadlineAt = new Date(request.resolution_due_at!)
    if (deadlineAt <= createdAt) continue

    const totalBusinessMinutes = await computeElapsedBusinessMinutes(createdAt, deadlineAt)
    const pctElapsed =
      totalBusinessMinutes > 0
        ? ((await computeElapsedBusinessMinutes(createdAt, now)) / totalBusinessMinutes) * 100
        : ((now.getTime() - createdAt.getTime()) / (deadlineAt.getTime() - createdAt.getTime())) * 100

    if (pctElapsed < rule.schedule_threshold) continue
    if (await fireRule(admin, rule, request)) count++
  }
  return count
}

async function runUnassignedMinutes(admin: AnyClient, rule: BusinessRuleRow, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - rule.schedule_threshold * 60 * 1000)
  const { data: requests } = await admin
    .from('requests')
    .select(REQUEST_SELECT)
    .eq('org_id', rule.org_id)
    .is('assigned_to', null)
    .not('status', 'in', '("resolved","cancelled","closed")')
    .lt('created_at', cutoff.toISOString())

  let count = 0
  for (const request of (requests ?? []) as RawRequest[]) {
    if (await fireRule(admin, rule, request)) count++
  }
  return count
}
