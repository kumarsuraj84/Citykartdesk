'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { requireModuleEnabled } from '@/lib/actions/moduleGuard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type IntakeWorkType = 'request' | 'task' | 'approval' | 'informational' | 'ignore'
export type IntakePriority = 'low' | 'medium' | 'high' | 'urgent'
export type RuleMatchField = 'subject' | 'text' | 'both' | 'sender' | 'all'

export type IntakeRule = {
  id: string
  name: string
  enabled: boolean
  match_field: RuleMatchField
  match_keywords: string[]
  match_regex: string | null
  output_type: IntakeWorkType | null
  output_department: string | null
  output_category: string | null
  output_subcategory: string | null
  output_priority: IntakePriority | null
  weight: number
}

export type RuleInput = Omit<IntakeRule, 'id'>

// intake.rules.manage ≈ admin. Enforced here AND in RLS (the write policies on
// intake_rules require role admin/platform_owner — defence in depth).
function canManageRules(role: string): boolean {
  return role === 'admin' || role === 'platform_owner'
}

// Shared validation so create and update reject the same malformed rules the DB
// CHECK constraints would (clearer message than a Postgres error).
function validate(input: RuleInput): string | null {
  if (!input.name.trim()) return 'Rule name is required.'
  const hasMatch = (input.match_keywords?.some((k) => k.trim()) ?? false) || !!input.match_regex?.trim()
  if (!hasMatch) return 'Add at least one keyword or a regex to match on.'
  const hasOutput = !!(input.output_type || input.output_department || input.output_category
    || input.output_subcategory || input.output_priority)
  if (!hasOutput) return 'Set at least one outcome (type, department, category, subcategory or priority).'
  if (input.match_regex) {
    try { new RegExp(input.match_regex) } catch { return 'The regex pattern is invalid.' }
  }
  if (input.weight < 1 || input.weight > 10) return 'Weight must be between 1 and 10.'
  return null
}

// Normalise the UI draft into a clean DB row (trimmed, empty → null). Values now
// come from master-data dropdowns: department keeps its proper name; category and
// subcategory are slugs.
function toRow(input: RuleInput) {
  const clean = (v: string | null) => (v?.trim() ? v.trim() : null)
  return {
    name: input.name.trim(),
    enabled: input.enabled,
    match_field: input.match_field,
    match_keywords: (input.match_keywords ?? []).map((k) => k.trim()).filter(Boolean),
    match_regex: input.match_regex?.trim() || null,
    output_type: input.output_type || null,
    output_department: clean(input.output_department),
    output_category: clean(input.output_category),
    output_subcategory: clean(input.output_subcategory),
    output_priority: input.output_priority || null,
    weight: input.weight,
  }
}

async function logAudit(admin: AnyClient, orgId: string, actorId: string, action: string, id: string, name: string) {
  await admin.from('intake_audit_log').insert({
    org_id: orgId, actor_id: actorId, entity_type: 'intake_rule',
    entity_id: id, action, metadata: { name },
  })
}

export async function createIntakeRule(input: RuleInput): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!canManageRules(profile.role)) return { error: 'You do not have permission to manage intake rules.' }
  if (!profile.org_id) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const admin = createAdminClient() as unknown as AnyClient
  const { data, error } = await admin
    .from('intake_rules')
    .insert({ ...toRow(input), org_id: profile.org_id, created_by: profile.id, updated_by: profile.id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  await logAudit(admin, profile.org_id, profile.id, 'rule_created', data.id, input.name.trim())
  revalidatePath('/intake/rules')
  return { id: data.id }
}

export async function updateIntakeRule(id: string, input: RuleInput): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!canManageRules(profile.role)) return { error: 'You do not have permission to manage intake rules.' }
  if (!profile.org_id) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('intake_rules')
    .update({ ...toRow(input), updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', profile.org_id)
  if (error) return { error: error.message }

  await logAudit(admin, profile.org_id, profile.id, 'rule_updated', id, input.name.trim())
  revalidatePath('/intake/rules')
  return {}
}

// Quick enable/disable toggle without opening the editor.
export async function setIntakeRuleEnabled(id: string, enabled: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!canManageRules(profile.role)) return { error: 'You do not have permission to manage intake rules.' }
  if (!profile.org_id) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin
    .from('intake_rules')
    .update({ enabled, updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', profile.org_id)
  if (error) return { error: error.message }
  revalidatePath('/intake/rules')
  return {}
}

export async function deleteIntakeRule(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!canManageRules(profile.role)) return { error: 'You do not have permission to manage intake rules.' }
  if (!profile.org_id) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('intake_rules').delete().eq('id', id).eq('org_id', profile.org_id)
  if (error) return { error: error.message }

  await logAudit(admin, profile.org_id, profile.id, 'rule_deleted', id, '')
  revalidatePath('/intake/rules')
  return {}
}
