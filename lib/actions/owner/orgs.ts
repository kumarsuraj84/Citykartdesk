'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerAccess } from '@/lib/queries/owner'
import { createClient } from '@/lib/supabase/server'

const ALL_MODULES = ['requests', 'tasks', 'approvals', 'services', 'time_tracking', 'analytics', 'integrations'] as const

async function getActorId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

async function auditLog(orgId: string, action: string, metadata: Record<string, unknown> = {}) {
  const admin = createAdminClient()
  const actorId = await getActorId()
  await admin.from('owner_audit_log').insert({ org_id: orgId, actor_id: actorId, action, metadata })
}

export async function updateOrgStatus(orgId: string, status: 'trial' | 'active' | 'suspended' | 'cancelled') {
  if (!(await verifyOwnerAccess())) return { error: 'Unauthorized' }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ status, updated_at: new Date().toISOString() }).eq('id', orgId)
  if (error) return { error: error.message }
  await auditLog(orgId, 'org_status_changed', { status })
  revalidatePath('/owner/orgs')
  revalidatePath(`/owner/orgs/${orgId}`)
  return { success: true }
}

export async function updateOrgSeats(orgId: string, seatLimit: number) {
  if (!(await verifyOwnerAccess())) return { error: 'Unauthorized' }
  const admin = createAdminClient()
  const { error } = await admin.from('organizations').update({ seat_limit: seatLimit, updated_at: new Date().toISOString() }).eq('id', orgId)
  if (error) return { error: error.message }
  await auditLog(orgId, 'org_seats_updated', { seat_limit: seatLimit })
  revalidatePath(`/owner/orgs/${orgId}`)
  return { success: true }
}

export async function extendTrial(orgId: string, days: number) {
  if (!(await verifyOwnerAccess())) return { error: 'Unauthorized' }
  const admin = createAdminClient()
  const trialEndsAt = new Date(Date.now() + days * 86_400_000).toISOString()
  const { error } = await admin.from('organizations').update({
    trial_ends_at: trialEndsAt,
    status: 'trial',
    updated_at: new Date().toISOString(),
  }).eq('id', orgId)
  if (error) return { error: error.message }
  await auditLog(orgId, 'trial_extended', { days, trial_ends_at: trialEndsAt })
  revalidatePath(`/owner/orgs/${orgId}`)
  return { success: true }
}

export async function setModuleAccess(
  orgId: string,
  module: string,
  enabled: boolean,
  validUntil?: string | null
) {
  if (!(await verifyOwnerAccess())) return { error: 'Unauthorized' }
  const admin = createAdminClient()
  const { error } = await admin.from('org_module_access').upsert(
    { org_id: orgId, module: module as any, enabled, valid_until: validUntil ?? null },
    { onConflict: 'org_id,module' }
  )
  if (error) return { error: error.message }
  await auditLog(orgId, 'module_access_changed', { module, enabled, valid_until: validUntil })
  revalidatePath(`/owner/orgs/${orgId}`)
  return { success: true }
}

export async function provisionOrg(data: {
  name: string
  slug: string
  adminEmail: string
  adminName: string
  adminPassword?: string
  seatLimit: number
  trialDays: number
  status?: string
  modules: string[]
}) {
  if (!(await verifyOwnerAccess())) return { error: 'Unauthorized' }
  const admin = createAdminClient()

  // 1. Create org
  const trialEndsAt = new Date(Date.now() + data.trialDays * 86_400_000).toISOString()
  const { data: org, error: orgError } = await admin.from('organizations').insert({
    name: data.name,
    slug: data.slug,
    status: (data.status ?? 'trial') as any,
    seat_limit: data.seatLimit,
    trial_ends_at: trialEndsAt,
  }).select('id').single()
  if (orgError || !org) return { error: orgError?.message ?? 'Failed to create org' }

  // 2. Create admin user (auto-generate password if not supplied)
  const password = data.adminPassword || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: data.adminEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: data.adminName },
  })
  if (authError || !authUser.user) return { error: authError?.message ?? 'Failed to create user' }

  // 3. Set profile org + role
  await admin.from('profiles').update({ org_id: org.id, role: 'admin', full_name: data.adminName }).eq('id', authUser.user.id)

  // 4. Enable selected modules
  if (data.modules.length > 0) {
    await admin.from('org_module_access').insert(
      data.modules.map((m) => ({ org_id: org.id, module: m as any, enabled: true, valid_until: null }))
    )
  }

  await auditLog(org.id, 'org_provisioned', { name: data.name, admin_email: data.adminEmail, modules: data.modules })
  revalidatePath('/owner/orgs')
  return { success: true, orgId: org.id }
}
