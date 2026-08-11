'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from '@/lib/actions/admin/audit'
import type { RuleCondition, RuleConditionsLogic } from '@/lib/rules/evaluate'
import type { RuleAction } from '@/lib/rules/actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return null
  return profile
}

export type BusinessRuleInput = {
  name: string
  description?: string
  is_active: boolean
  /** A rule can fire on more than one trigger (e.g. Created and Edited) instead of needing a duplicate rule per trigger. */
  trigger: ('created' | 'updated' | 'schedule')[]
  schedule_check?: 'sla_pct_elapsed' | 'unassigned_minutes' | null
  schedule_threshold?: number | null
  conditions: RuleCondition[]
  conditions_logic: RuleConditionsLogic
  actions: RuleAction[]
  execution_order: number
}

export async function createBusinessRule(data: BusinessRuleInput): Promise<{ id?: string; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!data.name.trim()) return { error: 'Name is required.' }
  if (data.trigger.length === 0) return { error: 'Pick at least one trigger.' }
  const isScheduled = data.trigger.includes('schedule')
  if (isScheduled && (!data.schedule_check || data.schedule_threshold == null)) {
    return { error: 'A schedule rule needs a check type and threshold.' }
  }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: rule, error } = await admin
    .from('business_rules')
    .insert({
      org_id: profile.org_id,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      is_active: data.is_active,
      trigger: data.trigger,
      schedule_check: isScheduled ? data.schedule_check : null,
      schedule_threshold: isScheduled ? data.schedule_threshold : null,
      conditions: data.conditions,
      conditions_logic: data.conditions_logic,
      actions: data.actions,
      execution_order: data.execution_order,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !rule) return { error: error?.message ?? 'Failed to create rule.' }

  await logAdminAudit({
    orgId: profile.org_id,
    actorId: profile.id,
    entityType: 'business_rule',
    entityId: rule.id,
    action: 'business_rule_created',
    metadata: { name: data.name, trigger: data.trigger },
  })

  revalidatePath('/admin/business-rules')
  return { id: rule.id }
}

export async function updateBusinessRule(id: string, data: BusinessRuleInput): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }
  if (!data.name.trim()) return { error: 'Name is required.' }
  if (data.trigger.length === 0) return { error: 'Pick at least one trigger.' }
  const isScheduled = data.trigger.includes('schedule')
  if (isScheduled && (!data.schedule_check || data.schedule_threshold == null)) {
    return { error: 'A schedule rule needs a check type and threshold.' }
  }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('business_rules')
    .update({
      name: data.name.trim(),
      description: data.description?.trim() || null,
      is_active: data.is_active,
      trigger: data.trigger,
      schedule_check: isScheduled ? data.schedule_check : null,
      schedule_threshold: isScheduled ? data.schedule_threshold : null,
      conditions: data.conditions,
      conditions_logic: data.conditions_logic,
      actions: data.actions,
      execution_order: data.execution_order,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: profile.org_id!,
    actorId: profile.id,
    entityType: 'business_rule',
    entityId: id,
    action: 'business_rule_updated',
    metadata: { name: data.name, trigger: data.trigger },
  })

  revalidatePath('/admin/business-rules')
  return {}
}

export async function deleteBusinessRule(id: string): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('business_rules').delete().eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: profile.org_id!,
    actorId: profile.id,
    entityType: 'business_rule',
    entityId: id,
    action: 'business_rule_deleted',
  })

  revalidatePath('/admin/business-rules')
  return {}
}

export async function toggleBusinessRuleActive(id: string, isActive: boolean): Promise<{ error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('business_rules')
    .update({ is_active: isActive, updated_by: profile.id })
    .eq('id', id)
    .eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/business-rules')
  return {}
}

// ── Legacy rule migration ────────────────────────────────────────────────────
// One-time, admin-triggered conversion of assignment_rules + sla_escalation_rules
// + the request-scoped slice of alert_rules ('unassigned') into business_rules
// rows. Run manually from the admin screen — never automatic, so nothing
// changes silently. The source tables are left untouched (not deleted), so this
// is safe to re-run (it always inserts fresh rows, never updates/dedupes
// against a previous run — re-running after already migrating will duplicate
// rules, which is why the UI only offers this while legacy tables still have
// active, unmigrated-looking rows).

const SCOPE_FIELD: Record<string, RuleCondition['field']> = {
  service: 'service_id',
  sub_category: 'sub_category_id',
  category: 'category_id',
}

export async function migrateLegacyRulesToBusinessRules(): Promise<{ migrated?: number; error?: string }> {
  const profile = await requireAdminOrManager()
  if (!profile) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient
  let migrated = 0

  // Routing Rules -> trigger: created, action: assign
  const { data: assignmentRules } = await admin
    .from('assignment_rules')
    .select('*')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
  for (const r of assignmentRules ?? []) {
    const conditions: RuleCondition[] = [{ field: SCOPE_FIELD[r.scope_type], operator: 'equals', value: r.scope_id }]
    if (r.priority_filter) conditions.push({ field: 'priority', operator: 'equals', value: r.priority_filter })
    const actions: RuleAction[] = [
      { type: 'assign', params: { strategy: r.strategy, assigneeIds: r.assignee_ids ?? [] } },
    ]
    const { error } = await admin.from('business_rules').insert({
      org_id: profile.org_id,
      name: `${r.name} (migrated from Routing Rules)`,
      is_active: true,
      trigger: ['created'],
      conditions,
      actions,
      execution_order: 0,
      created_by: profile.id,
      updated_by: profile.id,
    })
    if (!error) migrated++
  }

  // SLA Escalation Rules -> trigger: schedule (sla_pct_elapsed), action: notify
  const { data: escalationRules } = await admin.from('sla_escalation_rules').select('*')
  for (const r of escalationRules ?? []) {
    const conditions: RuleCondition[] = [{ field: 'priority', operator: 'equals', value: r.tier }]
    const actions: RuleAction[] = [
      { type: 'notify', params: { roles: r.notify_roles ?? [], notifyAssignee: true, notifyRequester: false, channels: ['in_app'] } },
    ]
    const { error } = await admin.from('business_rules').insert({
      org_id: profile.org_id,
      name: `${r.name} (migrated from SLA Escalation Rules)`,
      is_active: true,
      trigger: ['schedule'],
      schedule_check: 'sla_pct_elapsed',
      schedule_threshold: r.trigger_pct,
      conditions,
      actions,
      execution_order: 0,
      created_by: profile.id,
      updated_by: profile.id,
    })
    if (!error) migrated++
  }

  // Alert Rules ('unassigned', 'request' only) -> trigger: schedule (unassigned_minutes), action: notify
  const { data: alertRules } = await admin
    .from('alert_rules')
    .select('*')
    .eq('org_id', profile.org_id)
    .eq('alert_type', 'unassigned')
    .eq('entity_type', 'request')
  for (const r of alertRules ?? []) {
    const actions: RuleAction[] = [
      {
        type: 'notify',
        params: {
          roles: r.notify_roles ?? [],
          notifyAssignee: r.notify_assignee ?? false,
          notifyRequester: r.notify_requester ?? false,
          channels: (r.channels as ('in_app' | 'email')[] | null) ?? ['in_app'],
        },
      },
    ]
    const { error } = await admin.from('business_rules').insert({
      org_id: profile.org_id,
      name: `${r.name} (migrated from Alert Rules)`,
      is_active: r.is_active,
      trigger: ['schedule'],
      schedule_check: 'unassigned_minutes',
      schedule_threshold: r.threshold_minutes ?? 120,
      conditions: [],
      actions,
      execution_order: 0,
      created_by: profile.id,
      updated_by: profile.id,
    })
    if (!error) migrated++
  }

  await logAdminAudit({
    orgId: profile.org_id,
    actorId: profile.id,
    entityType: 'business_rule',
    entityId: null,
    action: 'business_rules_migrated_from_legacy',
    metadata: { migrated },
  })

  revalidatePath('/admin/business-rules')
  return { migrated }
}
