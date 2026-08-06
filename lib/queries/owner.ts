'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type OwnerOrg = {
  id: string
  name: string
  slug: string
  status: 'trial' | 'active' | 'suspended' | 'cancelled'
  seat_limit: number
  trial_ends_at: string | null
  is_owner: boolean
  created_at: string
  modules: { module: string; enabled: boolean; valid_until: string | null }[]
  user_count: number
}

export type OwnerOrgDetail = OwnerOrg & {
  users: { id: string; full_name: string; role: string; is_active: boolean; created_at: string }[]
  license_keys: { id: string; modules: string[]; issued_at: string; expires_at: string; revoked_at: string | null; notes: string | null }[]
  audit_log: { id: string; action: string; metadata: Record<string, unknown>; created_at: string; actor: { full_name: string } | null }[]
}

export async function verifyOwnerAccess(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('profiles')
    .select('role, org_id, organizations!inner(is_owner)')
    .eq('id', user.id)
    .single()
  if (!data) return false
  if (data.role === 'platform_owner') return true
  const org = (data.organizations as any)
  return data.role === 'admin' && (org?.is_owner === true || Array.isArray(org) && org[0]?.is_owner === true)
}

export async function getAllOrgs(): Promise<OwnerOrg[]> {
  const admin = createAdminClient()

  const [{ data: orgs }, { data: modules }, { data: profiles }] = await Promise.all([
    admin.from('organizations').select('*').order('created_at', { ascending: false }),
    admin.from('org_module_access').select('org_id, module, enabled, valid_until'),
    admin.from('profiles').select('org_id').eq('is_active', true),
  ])

  const modulesMap = new Map<string, { module: string; enabled: boolean; valid_until: string | null }[]>()
  for (const m of modules ?? []) {
    if (!modulesMap.has(m.org_id)) modulesMap.set(m.org_id, [])
    modulesMap.get(m.org_id)!.push({ module: m.module, enabled: m.enabled, valid_until: m.valid_until })
  }

  const userCountMap = new Map<string, number>()
  for (const p of profiles ?? []) {
    if (!p.org_id) continue
    userCountMap.set(p.org_id, (userCountMap.get(p.org_id) ?? 0) + 1)
  }

  return (orgs ?? []).map((o: any) => ({
    id: o.id, name: o.name, slug: o.slug, status: o.status,
    seat_limit: o.seat_limit, trial_ends_at: o.trial_ends_at,
    is_owner: o.is_owner ?? false, created_at: o.created_at,
    modules: modulesMap.get(o.id) ?? [],
    user_count: userCountMap.get(o.id) ?? 0,
  }))
}

export async function getOrgDetail(id: string): Promise<OwnerOrgDetail | null> {
  const admin = createAdminClient()

  const [{ data: org }, { data: modules }, { data: users }, { data: keys }, { data: audit }] = await Promise.all([
    admin.from('organizations').select('*').eq('id', id).single(),
    admin.from('org_module_access').select('module, enabled, valid_until').eq('org_id', id),
    admin.from('profiles').select('id, full_name, role, is_active, created_at').eq('org_id', id).order('full_name'),
    admin.from('license_keys').select('id, modules, issued_at, expires_at, revoked_at, notes').eq('org_id', id).order('issued_at', { ascending: false }),
    admin.from('owner_audit_log')
      .select('id, action, metadata, created_at, actor:profiles(full_name)')
      .eq('org_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (!org) return null

  return {
    id: org.id, name: org.name, slug: org.slug, status: org.status,
    seat_limit: org.seat_limit, trial_ends_at: org.trial_ends_at,
    is_owner: org.is_owner ?? false, created_at: org.created_at,
    modules: (modules ?? []).map((m: any) => ({ module: m.module, enabled: m.enabled, valid_until: m.valid_until })),
    user_count: (users ?? []).length,
    users: (users ?? []) as any,
    license_keys: (keys ?? []).map((k: any) => ({ ...k })),
    audit_log: (audit ?? []).map((a: any) => ({
      id: a.id, action: a.action, metadata: a.metadata, created_at: a.created_at,
      actor: Array.isArray(a.actor) ? a.actor[0] : a.actor,
    })),
  }
}
