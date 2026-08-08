'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'

export async function savePermissionOverrides(
  overrides: { role_key: string; action_key: string; allowed: boolean }[]
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated' }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Insufficient permissions' }

  const supabase = await createClient()

  // Fetch org_id from current profile's org
  const { data: orgRow } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', profile.id)
    .single()

  if (!orgRow?.org_id) return { error: 'No organisation found' }
  const orgId = orgRow.org_id

  const rows = overrides.map((o) => ({
    org_id:     orgId,
    role_key:   o.role_key,
    action_key: o.action_key,
    allowed:    o.allowed,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('permission_overrides')
    .upsert(rows, { onConflict: 'org_id,role_key,action_key' })

  if (error) return { error: error.message }

  revalidatePath('/admin/roles')
  return {}
}

export async function createCustomRole(data: {
  name: string
  description: string
  base_role: string
}): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated' }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Insufficient permissions' }

  const supabase = await createClient()

  const { data: orgRow } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', profile.id)
    .single()

  if (!orgRow?.org_id) return { error: 'No organisation found' }

  const { data: row, error } = await supabase
    .from('custom_roles')
    .insert({
      org_id:      orgRow.org_id,
      name:        data.name.trim(),
      description: data.description.trim(),
      base_role:   data.base_role,
      created_by:  profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/admin/roles')
  return { id: row.id }
}

export async function deleteCustomRole(roleId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated' }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Insufficient permissions' }

  const supabase = await createClient()
  const { error } = await supabase.from('custom_roles').delete().eq('id', roleId)
  if (error) return { error: error.message }

  revalidatePath('/admin/roles')
  return {}
}
