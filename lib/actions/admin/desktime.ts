'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { runDeskTimeSync, remapDeskTimeProjects, type DeskTimeSyncResult } from '@/lib/desktime/sync'

type ActionResult<T = undefined> = { error?: string; data?: T }

// Same bar as connecting the API key in the first place (lib/actions/admin/integrations.ts).
async function requireDeskTimeAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') return { error: 'Admin role required.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  return { profile }
}

export async function triggerDeskTimeSync(days: number): Promise<ActionResult<DeskTimeSyncResult>> {
  const guard = await requireDeskTimeAdmin()
  if (guard.error) return { error: guard.error }

  try {
    const result = await runDeskTimeSync(guard.profile!.org_id!, days, 'manual')
    revalidatePath('/admin/desktime')
    return { data: result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'DeskTime sync failed.' }
  }
}

export async function saveDeskTimeMapping(id: string, projectId: string | null): Promise<ActionResult> {
  const guard = await requireDeskTimeAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin
    .from('desktime_project_map')
    .update({ project_id: projectId })
    .eq('id', id)
    .eq('org_id', guard.profile!.org_id!)
  if (error) return { error: error.message }

  revalidatePath('/admin/desktime')
  return {}
}

export async function reapplyDeskTimeMapping(): Promise<ActionResult<{ updated: number }>> {
  const guard = await requireDeskTimeAdmin()
  if (guard.error) return { error: guard.error }

  try {
    const result = await remapDeskTimeProjects(guard.profile!.org_id!)
    revalidatePath('/admin/desktime')
    return { data: result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to re-apply mapping.' }
  }
}

export async function addAiApplication(name: string): Promise<ActionResult> {
  const guard = await requireDeskTimeAdmin()
  if (guard.error) return { error: guard.error }
  if (!name.trim()) return { error: 'Application name is required.' }

  const admin = createAdminClient()
  const { error } = await admin.from('ai_applications').insert({ org_id: guard.profile!.org_id!, name: name.trim() })
  if (error) return { error: error.message }

  revalidatePath('/admin/desktime')
  return {}
}

export async function toggleAiApplication(id: string, isActive: boolean): Promise<ActionResult> {
  const guard = await requireDeskTimeAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('ai_applications').update({ is_active: isActive }).eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: error.message }

  revalidatePath('/admin/desktime')
  return {}
}

export async function removeAiApplication(id: string): Promise<ActionResult> {
  const guard = await requireDeskTimeAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin.from('ai_applications').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: error.message }

  revalidatePath('/admin/desktime')
  return {}
}
