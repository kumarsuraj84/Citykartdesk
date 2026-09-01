'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from './audit'
import type { SLAConfig } from '@/types'

type ActionResult = { error?: string }

// ── Guard: admin-only ─────────────────────────────────────────────────────────
// Same guard as lib/actions/admin/form-templates.ts's requireAdmin() —
// deliberately duplicated rather than shared, kept byte-for-byte identical.

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
}

export type SlaPolicyInput = {
  name: string
  description?: string
  config: SLAConfig
}

export async function createSlaPolicy(
  data: SlaPolicyInput
): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  if (!data.name?.trim()) return { error: 'Name is required.' }

  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from('sla_policies')
    .insert({
      org_id: guard.profile!.org_id!,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      config: data.config,
      created_by: guard.profile!.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createSlaPolicy]', error.message)
    return { error: 'Failed to create SLA policy.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'sla_policy', entityId: row.id, action: 'sla_policy_created',
    metadata: { name: data.name.trim() },
  })

  revalidatePath('/admin/sla-policies')
  return { id: row.id }
}

export async function updateSlaPolicy(
  id: string,
  data: Partial<SlaPolicyInput> & { isActive?: boolean }
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const updatePayload = {
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
    ...(data.config !== undefined ? { config: data.config } : {}),
    ...(data.isActive !== undefined ? { is_active: data.isActive } : {}),
  }

  const { error } = await supabase
    .from('sla_policies')
    .update(updatePayload)
    .eq('id', id)

  if (error) {
    console.error('[updateSlaPolicy]', error.message)
    return { error: 'Failed to update SLA policy.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'sla_policy', entityId: id, action: 'sla_policy_updated',
    metadata: updatePayload,
  })

  revalidatePath('/admin/sla-policies')
  revalidatePath('/admin/services')
  revalidatePath('/services')
  return {}
}

export async function archiveSlaPolicy(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('sla_policies')
    .update({ is_active: false })
    .eq('id', id)

  if (error) {
    console.error('[archiveSlaPolicy]', error.message)
    return { error: 'Failed to archive SLA policy.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'sla_policy', entityId: id, action: 'sla_policy_archived',
  })

  revalidatePath('/admin/sla-policies')
  return {}
}

// ── deleteSlaPolicy ───────────────────────────────────────────────────────────
// A policy still mapped to any service can't be removed — mirrors
// deleteFormTemplate()'s dependent-check-then-hard-delete pattern.

export async function deleteSlaPolicy(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const { data: policy, error: fetchError } = await supabase
    .from('sla_policies')
    .select('name')
    .eq('id', id)
    .single()

  if (fetchError || !policy) return { error: 'SLA policy not found.' }

  const { count: serviceCount } = await supabase
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('sla_policy_id', id)

  if (serviceCount && serviceCount > 0) {
    return {
      error: `Cannot delete "${policy.name}" — ${serviceCount} service${serviceCount === 1 ? '' : 's'} still ${serviceCount === 1 ? 'is' : 'are'} mapped to it. Unmap or delete those services first.`,
    }
  }

  const { error } = await supabase.from('sla_policies').delete().eq('id', id)

  if (error) {
    console.error('[deleteSlaPolicy]', error.message)
    return { error: 'Failed to delete SLA policy.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'sla_policy', entityId: id, action: 'sla_policy_deleted',
    metadata: { name: policy.name },
  })

  revalidatePath('/admin/sla-policies')
  return {}
}
