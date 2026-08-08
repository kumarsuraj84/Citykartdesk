'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'

type ActionResult<T = undefined> = { error?: string; data?: T }

// ── Guard: admin-only ─────────────────────────────────────────────────────────

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin','platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
}

// ── createTeam ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

function prefixify(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '')
  return (letters.slice(0, 3) || 'TM').padEnd(2, 'X')
}

export async function createTeam(name: string): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }
  if (!name.trim()) return { error: 'Team name is required.' }

  const admin = createAdminClient()
  const orgId = guard.profile!.org_id
  if (!orgId) return { error: 'No organization context.' }

  const { data: department } = await admin
    .from('departments')
    .select('id')
    .eq('org_id', orgId)
    .order('name')
    .limit(1)
    .maybeSingle()

  if (!department) return { error: 'Create a department first before adding teams.' }

  const trimmed = name.trim()
  const baseSlug = slugify(trimmed) || `team-${Date.now()}`
  const basePrefix = prefixify(trimmed)

  const { data, error } = await admin
    .from('teams')
    .insert({
      name: trimmed,
      slug: baseSlug,
      prefix: basePrefix,
      department_id: department.id,
      org_id: orgId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'A team with a similar name already exists — try a different name.' }
    return { error: error.message }
  }

  revalidatePath('/admin/teams')
  return { data: { id: data.id } }
}

// ── updateTeam ────────────────────────────────────────────────────────────────

export async function updateTeam(id: string, name: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }
  if (!name.trim()) return { error: 'Team name is required.' }

  const admin = createAdminClient()

  const { error } = await admin
    .from('teams')
    .update({ name: name.trim() })
    .eq('id', id)
    .eq('org_id', guard.profile!.org_id!)

  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}

// ── deleteTeam ────────────────────────────────────────────────────────────────

export async function deleteTeam(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()

  const { data: team } = await admin.from('teams').select('id').eq('id', id).eq('org_id', guard.profile!.org_id!).maybeSingle()
  if (!team) return { error: 'Team not found.' }

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

  const { error } = await admin.from('teams').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}

// ── addTeamMember ─────────────────────────────────────────────────────────────

export async function addTeamMember(teamId: string, userId: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()

  // team_members.org_id is NOT NULL with no DB default — resolve it from the
  // parent team rather than trusting the caller's session org. Also confirms
  // the team belongs to the caller's own org before adding anyone to it.
  const { data: team } = await admin
    .from('teams')
    .select('org_id')
    .eq('id', teamId)
    .eq('org_id', guard.profile!.org_id!)
    .maybeSingle()

  if (!team?.org_id) return { error: 'Team not found or has no organization context.' }

  const { error } = await admin
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId, org_id: team.org_id })

  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}

// ── removeTeamMember ──────────────────────────────────────────────────────────

export async function removeTeamMember(teamId: string, userId: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()

  const { error } = await admin
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('org_id', guard.profile!.org_id!)

  if (error) return { error: error.message }

  revalidatePath('/admin/teams')
  return {}
}
