'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from './audit'
import { planStoreAssignment } from '@/lib/oems/store-assignment'
import { inBatchesDo } from '@/lib/queries/in-batches'
import { CVM_ROLES } from '@/lib/cvm/resolve'

type ActionResult<T = undefined> = { error?: string; data?: T }

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Admin or manager role required.' }
  return { profile }
}

// ── Assign stores to a CVM (like "Assign stores" for an OEM) ─────────────────────────────────────────────────────────────────────
// stores.cvm_id is the single source of truth (one CVM per store); one CVM can have many stores. Ticking a store that already has another CVM replaces it
// (the screen names those stores first and asks for a second click). Every change is written to the audit log with the replaced CVMs.
export async function setCvmStores(
  cvmUserId: string,
  storeIds: string[],
): Promise<ActionResult<{ assigned: number; removed: number; moved: number; movedFrom: { store: string; from: string }[] }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  const orgId = guard.profile!.org_id
  if (!orgId) return { error: 'Your account is not linked to an organisation.' }
  if (!Array.isArray(storeIds) || storeIds.length > 5000) return { error: 'Invalid store list.' }

  const admin = createAdminClient()
  const { data: cvm } = await admin.from('profiles').select('id, full_name, role, is_active').eq('id', cvmUserId).eq('org_id', orgId).maybeSingle()
  if (!cvm || !cvm.is_active || !(CVM_ROLES as readonly string[]).includes(cvm.role)) return { error: 'The CVM must be an active staff member (technician, manager or admin) of your organisation.' }

  const { data: stores, error: loadError } = await admin.from('stores').select('id, code, cvm_id').eq('org_id', orgId)
  if (loadError) return { error: 'Could not load stores.' }
  const plan = planStoreAssignment((stores ?? []).map((s) => ({ id: s.id, oem_id: s.cvm_id })), storeIds, cvmUserId)

  const { data: people } = await admin.from('profiles').select('id, full_name').eq('org_id', orgId).in('id', [...new Set(plan.moved.map((m) => m.fromOemId))])
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]))
  const codeOf = new Map((stores ?? []).map((s) => [s.id, s.code]))
  const movedFrom = plan.moved.slice(0, 50).map((m) => ({ store: codeOf.get(m.storeId) ?? m.storeId, from: nameOf.get(m.fromOemId) ?? 'another CVM' }))

  if (plan.toAssign.length > 0) {
    const { error } = await inBatchesDo(plan.toAssign, (batch) => admin.from('stores').update({ cvm_id: cvmUserId }).in('id', batch).eq('org_id', orgId))
    if (error) return { error: 'Could not assign the stores. Nothing further was changed.' }
  }
  if (plan.toUnassign.length > 0) {
    const { error } = await inBatchesDo(plan.toUnassign, (batch) => admin.from('stores').update({ cvm_id: null }).in('id', batch).eq('org_id', orgId).eq('cvm_id', cvmUserId))
    if (error) return { error: 'Stores were assigned, but removing the unticked ones failed. Please try saving again.' }
  }

  await logAdminAudit({
    orgId, actorId: guard.profile!.id,
    entityType: 'profile', entityId: cvmUserId, action: 'cvm_stores_updated',
    metadata: { cvm: cvm.full_name, assigned: plan.toAssign.length, removed: plan.toUnassign.length, replaced: movedFrom },
  })
  revalidatePath('/admin/org')
  return { data: { assigned: plan.toAssign.length, removed: plan.toUnassign.length, moved: plan.moved.length, movedFrom } }
}
