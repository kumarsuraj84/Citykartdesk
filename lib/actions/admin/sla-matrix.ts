'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from '@/lib/actions/admin/audit'
import type { SLAConfig, SLATier } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type FieldSlaOverrideInput = {
  serviceId: string
  fieldId: string
  fieldLabel: string
  optionValue: string
  optionLabel: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  /** Hours to resolution for this priority tier; null clears the override for that cell. */
  resolutionHours: number | null
}

/**
 * Upsert one cell of the Field SLA Matrix — a single priority tier's resolution hours
 * for one (service, field, option) row. Only resolution hours are matrix-editable
 * (response hours still come from the service/global SLA layers), matching the
 * single-number-per-priority-column shape of the matrix.
 */
export async function upsertFieldSlaOverride(input: FieldSlaOverrideInput): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const admin = createAdminClient() as unknown as AnyClient

  const { data: existing } = await admin
    .from('field_sla_overrides')
    .select('sla_config')
    .eq('service_id', input.serviceId)
    .eq('field_id', input.fieldId)
    .eq('option_value', input.optionValue)
    .maybeSingle()

  const existingConfig = (existing?.sla_config ?? {}) as SLAConfig
  const nextTier: SLATier = {
    response_hours: existingConfig[input.priority]?.response_hours ?? null,
    resolution_hours: input.resolutionHours,
  }
  const nextSlaConfig: SLAConfig = { ...existingConfig, [input.priority]: nextTier }

  const { error } = await admin.from('field_sla_overrides').upsert(
    {
      org_id: profile.org_id,
      service_id: input.serviceId,
      field_id: input.fieldId,
      field_label: input.fieldLabel,
      option_value: input.optionValue,
      option_label: input.optionLabel,
      sla_config: nextSlaConfig,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'service_id,field_id,option_value' }
  )

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
      resolutionHours: input.resolutionHours,
    },
  })

  revalidatePath('/admin/request-config')
  return {}
}
