'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from './audit'
import { planStoreAssignment } from '@/lib/oems/store-assignment'
import type { Database } from '@/types/database'

type ActionResult<T = undefined> = { error?: string; data?: T }
type OemUpdate = Database['public']['Tables']['oems']['Update']

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Admin or manager role required.' }
  return { profile }
}

// ── OEMs (vendors) ────────────────────────────────────────────────────────────
// Each OEM carries its own recipient email list and a customizable
// notification email template — see runOemAutoRouting() in
// lib/actions/requests.ts for how these get used when an AC-style ticket is
// raised by a store assigned to this OEM (stores.oem_id).

export type OemInput = {
  name: string
  emails: string[]
  email_subject_template?: string | null
  email_body_template?: string | null
  is_active?: boolean
}

function cleanEmails(emails: string[]): string[] {
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
}

export async function createOem(fields: OemInput): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.name.trim()) return { error: 'OEM name is required.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('oems')
    .insert({
      org_id: guard.profile!.org_id!,
      name: fields.name.trim(),
      emails: cleanEmails(fields.emails),
      email_subject_template: fields.email_subject_template?.trim() || null,
      email_body_template: fields.email_body_template?.trim() || null,
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  // D-12: '/admin/oems' isn't a real route — the OEM admin UI lives on the
  // OEM tab of '/admin/org' (OrgStructureClient.tsx). deleteOem() below
  // already revalidated the right path; create/update didn't, so an edit
  // stayed stale on screen until a hard refresh.
  revalidatePath('/admin/org')
  return { data }
}

export async function updateOem(id: string, fields: Partial<OemInput>): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const update: OemUpdate = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if (fields.emails !== undefined) update.emails = cleanEmails(fields.emails)
  if ('email_subject_template' in fields) update.email_subject_template = fields.email_subject_template?.trim() || null
  if ('email_body_template' in fields) update.email_body_template = fields.email_body_template?.trim() || null
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const { error } = await admin.from('oems').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteOem(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  // Stores pointing at this OEM fall back to unmapped (no auto-email) rather
  // than blocking deletion — matches stores.oem_id's ON DELETE SET NULL.
  const { error } = await admin.from('oems').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: error.message }
  revalidatePath('/admin/org')
  return {}
}

// ── Assign stores to an OEM (the reverse of picking an OEM on each store) ─────
// stores.oem_id is the single source of truth (one OEM per store), so this just
// applies the difference between the ticked list and what the OEM has now.
// Ticking a store that belongs to another OEM moves it.

export async function setOemStores(
  oemId: string,
  storeIds: string[],
): Promise<ActionResult<{ assigned: number; removed: number; moved: number }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  const orgId = guard.profile!.org_id
  if (!orgId) return { error: 'Your account is not linked to an organisation.' }
  if (!Array.isArray(storeIds) || storeIds.length > 5000) return { error: 'Invalid store list.' }

  const admin = createAdminClient()
  const { data: oem } = await admin.from('oems').select('id, name').eq('id', oemId).eq('org_id', orgId).maybeSingle()
  if (!oem) return { error: 'OEM not found in your organisation.' }

  // Only this organisation's stores can be touched, whatever ids were sent.
  const { data: stores, error: loadError } = await admin.from('stores').select('id, oem_id').eq('org_id', orgId)
  if (loadError) return { error: 'Could not load stores.' }

  const plan = planStoreAssignment((stores ?? []) as { id: string; oem_id: string | null }[], storeIds, oemId)

  if (plan.toAssign.length > 0) {
    const { error } = await admin.from('stores').update({ oem_id: oemId }).in('id', plan.toAssign).eq('org_id', orgId)
    if (error) return { error: 'Could not assign the stores. Nothing further was changed.' }
  }
  if (plan.toUnassign.length > 0) {
    const { error } = await admin.from('stores').update({ oem_id: null }).in('id', plan.toUnassign).eq('org_id', orgId).eq('oem_id', oemId)
    if (error) return { error: 'Stores were assigned, but removing the unticked ones failed. Please try saving again.' }
  }

  await logAdminAudit({
    orgId, actorId: guard.profile!.id,
    entityType: 'oem', entityId: oemId, action: 'oem_stores_updated',
    metadata: { oem: oem.name, assigned: plan.toAssign.length, removed: plan.toUnassign.length, moved_from_other_oems: plan.moved.length },
  })

  revalidatePath('/admin/org')
  return { data: { assigned: plan.toAssign.length, removed: plan.toUnassign.length, moved: plan.moved.length } }
}
