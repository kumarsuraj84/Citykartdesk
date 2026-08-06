'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'

type AnyClient = { from: (t: string) => any }
type ActionResult<T = undefined> = { error?: string; data?: T }

// ── Guard: admin-only ─────────────────────────────────────────────────────────

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (profile.role !== 'admin') return { error: 'Admin role required.' }
  return { profile }
}

// ── createTeam ────────────────────────────────────────────────────────────────

export async function createTeam(name: string): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }
  if (!name.trim()) return { error: 'Team name is required.' }

  const admin = createAdminClient() as unknown as AnyClient

  const { data, error } = await admin
    .from('teams')
    .insert({ name: name.trim() })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return { data: { id: data.id } }
}

// ── updateTeam ────────────────────────────────────────────────────────────────

export async function updateTeam(id: string, name: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }
  if (!name.trim()) return { error: 'Team name is required.' }

  const admin = createAdminClient() as unknown as AnyClient

  const { error } = await admin
    .from('teams')
    .update({ name: name.trim() })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}

// ── deleteTeam ────────────────────────────────────────────────────────────────

export async function deleteTeam(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient

  // Check for members
  const { count: memberCount } = await admin
    .from('team_members')
    .select('*', { count: 'exact', head: true })
    .eq('team_id', id)

  if (memberCount && memberCount > 0) {
    return { error: 'Cannot delete a team that still has members.' }
  }

  // Check for pending requests
  const { count: requestCount } = await admin
    .from('requests')
    .select('*', { count: 'exact', head: true })
    .eq('team_id', id)
    .not('status', 'in', '("resolved","closed","cancelled")')

  if (requestCount && requestCount > 0) {
    return { error: 'Cannot delete a team with open requests.' }
  }

  const { error } = await admin.from('teams').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}

// ── addTeamMember ─────────────────────────────────────────────────────────────

export async function addTeamMember(teamId: string, userId: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient

  const { error } = await admin
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId })

  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}

// ── removeTeamMember ──────────────────────────────────────────────────────────

export async function removeTeamMember(teamId: string, userId: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient() as unknown as AnyClient

  const { error } = await admin
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)

  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}
