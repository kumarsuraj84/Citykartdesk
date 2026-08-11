'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from '@/lib/actions/admin/audit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export type FieldSlaOverrideInput = {
  serviceId: string
  fieldId: string
  fieldLabel: string
  optionValue: string
  optionLabel: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  /** Hours to first response for this priority tier; null clears it. */
  responseHours: number | null
  /** Hours to resolution for this priority tier; null clears it. */
  resolutionHours: number | null
}

/**
 * Upsert one row of the Field SLA Matrix — one priority tier's response and resolution
 * hours for one (service, field, option). Storage is still one field_sla_overrides row
 * per (service, field, option) holding all 4 priorities in its sla_config JSONB. Goes
 * through the upsert_field_sla_override() SQL function (atomic jsonb_set) rather than a
 * client-side SELECT-then-merge-then-UPSERT — Response and Resolution hours for the same
 * row save independently (two separate blur-triggered calls), and the old read-modify-write
 * let two overlapping saves race, silently reverting whichever one's round trip landed
 * first. The function also enforces resolution_hours > response_hours.
 */
export async function upsertFieldSlaOverride(input: FieldSlaOverrideInput): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient

  const { error } = await admin.rpc('upsert_field_sla_override', {
    p_org_id: profile.org_id,
    p_service_id: input.serviceId,
    p_field_id: input.fieldId,
    p_field_label: input.fieldLabel,
    p_option_value: input.optionValue,
    p_option_label: input.optionLabel,
    p_priority: input.priority,
    p_response_hours: input.responseHours,
    p_resolution_hours: input.resolutionHours,
    p_updated_by: profile.id,
  })

  if (error) return { error: error.message }

  await logAdminAudit({
    orgId: profile.org_id,
    actorId: profile.id,
    entityType: 'field_sla_override',
    entityId: input.serviceId,
    action: 'field_sla_override_updated',
    metadata: {
      fieldId: input.fieldId,
      fieldLabel: input.fieldLabel,
      optionValue: input.optionValue,
      optionLabel: input.optionLabel,
      priority: input.priority,
      responseHours: input.responseHours,
      resolutionHours: input.resolutionHours,
    },
  })

  revalidatePath('/admin/request-config')
  return {}
}
