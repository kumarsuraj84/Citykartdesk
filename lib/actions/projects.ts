'use server'

import { revalidatePath, refresh } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getEnabledModules } from '@/lib/queries/profiles'
import type { ProjectStatus, ProjectPriority } from '@/types'
import type { Json } from '@/types/database'

type ActionResult = { error?: string }

// ── Log project activity (admin client to bypass RLS) ────────────────────────

async function logProjectActivity(opts: {
  projectId: string
  orgId: string
  actorId: string
  action: 'created' | 'status_changed' | 'archived'
  metadata?: Record<string, unknown>
}) {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('project_activity').insert({
      project_id: opts.projectId,
      org_id: opts.orgId,
      actor_id: opts.actorId,
      action: opts.action,
      metadata: (opts.metadata ?? {}) as Json,
    })
    if (error) {
      console.error('[logProjectActivity] failed', error.message)
    }
  } catch (err) {
    console.error('[logProjectActivity] unexpected', err)
  }
}

// ── Create project ───────────────────────────────────────────────────────────

export async function createProject(data: {
  name: string
  description?: string
  teamId?: string
  ownerId: string
  startDate?: string
  targetDate?: string
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const enabledModules = await getEnabledModules()
  if (!enabledModules.includes('projects')) return { error: 'The Projects module is not enabled for your organisation.' }

  if (!['agent', 'manager', 'admin', 'platform_owner'].includes(profile.role)) {
    return { error: 'You do not have permission to create a project.' }
  }

  if (!data.name.trim()) return { error: 'Project name is required.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const supabase = await createClient()

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      name: data.name.trim(),
      description: data.description?.trim() || null,
      team_id: data.teamId || null,
      owner_id: data.ownerId,
      created_by: profile.id,
      org_id: profile.org_id,
      start_date: data.startDate || null,
      target_date: data.targetDate || null,
    })
    .select('id')
    .single()

  if (error || !project) {
    return { error: error?.message ?? 'Failed to create project.' }
  }

  await logProjectActivity({
    projectId: project.id,
    orgId: profile.org_id,
    actorId: profile.id,
    action: 'created',
  })

  revalidatePath('/projects')
  refresh()
  return { data: { id: project.id } }
}

// ── Bulk create projects (CSV import) ─────────────────────────────────────────

const PROJECT_STATUSES: ProjectStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled']

export async function bulkCreateProjects(
  rows: { name: string; description?: string; owner?: string; team?: string; status?: string; start_date?: string; target_date?: string }[]
): Promise<{ error?: string; data?: { imported: number; errors: string[] } }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const enabledModules = await getEnabledModules()
  if (!enabledModules.includes('projects')) return { error: 'The Projects module is not enabled for your organisation.' }

  if (!['agent', 'manager', 'admin', 'platform_owner'].includes(profile.role)) {
    return { error: 'You do not have permission to create projects.' }
  }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (rows.length === 0) return { error: 'No rows to import.' }

  const admin = createAdminClient()
  const orgId = profile.org_id

  const [{ data: profilesData }, { data: teamsData }] = await Promise.all([
    admin.from('profiles').select('id, full_name').eq('org_id', orgId),
    admin.from('teams').select('id, name').eq('org_id', orgId),
  ])
  const nameToProfileId = new Map((profilesData ?? []).map((p) => [p.full_name.trim().toLowerCase(), p.id]))
  const nameToTeamId = new Map((teamsData ?? []).map((t) => [t.name.trim().toLowerCase(), t.id]))

  const errors: string[] = []
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const rowLabel = `Row ${i + 2}`
    const row = rows[i]
    const name = row.name?.trim()
    if (!name) { errors.push(`${rowLabel}: name is required, skipped.`); continue }

    let ownerId = profile.id
    if (row.owner?.trim()) {
      const found = nameToProfileId.get(row.owner.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: owner "${row.owner}" not found, skipped.`); continue }
      ownerId = found
    }

    let teamId: string | null = null
    if (row.team?.trim()) {
      const found = nameToTeamId.get(row.team.trim().toLowerCase())
      if (!found) { errors.push(`${rowLabel}: team "${row.team}" not found, skipped.`); continue }
      teamId = found
    }

    let status: ProjectStatus = 'not_started'
    if (row.status?.trim()) {
      const candidate = row.status.trim().toLowerCase().replace(/\s+/g, '_')
      if (!PROJECT_STATUSES.includes(candidate as ProjectStatus)) {
        errors.push(`${rowLabel}: status "${row.status}" is invalid, skipped.`)
        continue
      }
      status = candidate as ProjectStatus
    }

    const { data: project, error } = await admin
      .from('projects')
      .insert({
        org_id: orgId,
        name,
        description: row.description?.trim() || null,
        status,
        team_id: teamId,
        owner_id: ownerId,
        created_by: profile.id,
        start_date: row.start_date?.trim() || null,
        target_date: row.target_date?.trim() || null,
      })
      .select('id')
      .single()

    if (error || !project) { errors.push(`${rowLabel}: ${error?.message ?? 'Failed to create project.'}`); continue }

    imported++
    await logProjectActivity({ projectId: project.id, orgId, actorId: profile.id, action: 'created' })
  }

  revalidatePath('/projects')
  refresh()
  return { data: { imported, errors } }
}

// ── Update project ───────────────────────────────────────────────────────────

export async function updateProject(
  id: string,
  data: {
    name?: string
    description?: string
    status?: ProjectStatus
    priority?: ProjectPriority
    ownerId?: string
    functionalOwnerId?: string | null
    teamId?: string | null
    startDate?: string | null
    targetDate?: string | null
  }
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const { data: current } = await supabase
    .from('projects')
    .select('status')
    .eq('id', id)
    .single()
  if (!current) return { error: 'Project not found.' }

  const oldStatus = current.status as ProjectStatus

  const { error } = await supabase
    .from('projects')
    .update({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.ownerId !== undefined ? { owner_id: data.ownerId } : {}),
      ...(data.functionalOwnerId !== undefined ? { functional_owner_id: data.functionalOwnerId } : {}),
      ...(data.teamId !== undefined ? { team_id: data.teamId } : {}),
      ...(data.startDate !== undefined ? { start_date: data.startDate } : {}),
      ...(data.targetDate !== undefined ? { target_date: data.targetDate } : {}),
    })
    .eq('id', id)

  if (error) return { error: error.message }

  if (data.status !== undefined && data.status !== oldStatus && profile.org_id) {
    await logProjectActivity({
      projectId: id,
      orgId: profile.org_id,
      actorId: profile.id,
      action: 'status_changed',
      metadata: { from: oldStatus, to: data.status },
    })
  }

  revalidatePath('/projects')
  revalidatePath(`/projects/${id}`)
  refresh()
  return {}
}

// ── Archive project ───────────────────────────────────────────────────────────

export async function archiveProject(id: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }

  if (profile.org_id) {
    await logProjectActivity({ projectId: id, orgId: profile.org_id, actorId: profile.id, action: 'archived' })
  }

  revalidatePath('/projects')
  refresh()
  return {}
}

// ── Attach/detach a task or request to a project ──────────────────────────────

export async function attachToProject(
  entity: 'task' | 'request',
  id: string,
  projectId: string | null
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const table = entity === 'task' ? 'tasks' : 'requests'

  const { error } = await supabase
    .from(table)
    .update({ project_id: projectId })
    .eq('id', id)

  if (error) return { error: error.message }

  if (projectId) revalidatePath(`/projects/${projectId}`)
  revalidatePath(entity === 'task' ? '/tasks' : '/requests')
  refresh()
  return {}
}

// ── Milestones ────────────────────────────────────────────────────────────────

export async function createMilestone(data: {
  projectId: string
  name: string
  startDate: string
  endDate: string
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!data.name.trim()) return { error: 'Enhancement name is required.' }
  if (data.endDate < data.startDate) return { error: 'End date must be on or after the start date.' }

  const supabase = await createClient()
  const { data: milestone, error } = await supabase
    .from('milestones')
    .insert({
      project_id: data.projectId,
      org_id: profile.org_id,
      name: data.name.trim(),
      start_date: data.startDate,
      end_date: data.endDate,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !milestone) return { error: error?.message ?? 'Failed to create milestone.' }

  revalidatePath(`/projects/${data.projectId}`)
  refresh()
  return { data: { id: milestone.id } }
}

export async function updateMilestone(
  id: string,
  data: {
    name?: string
    status?: ProjectStatus
    priority?: ProjectPriority
    ownerId?: string | null
    functionalOwnerId?: string | null
    startDate?: string | null
    endDate?: string | null
    percentComplete?: number
  }
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (data.name !== undefined && !data.name.trim()) return { error: 'Enhancement name is required.' }
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    return { error: 'End date must be on or after the start date.' }
  }
  if (data.percentComplete !== undefined && (data.percentComplete < 0 || data.percentComplete > 100)) {
    return { error: 'Progress must be between 0 and 100.' }
  }

  const supabase = await createClient()
  const { data: milestone, error } = await supabase
    .from('milestones')
    .update({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.ownerId !== undefined ? { owner_id: data.ownerId } : {}),
      ...(data.functionalOwnerId !== undefined ? { functional_owner_id: data.functionalOwnerId } : {}),
      ...(data.startDate !== undefined ? { start_date: data.startDate } : {}),
      ...(data.endDate !== undefined ? { end_date: data.endDate } : {}),
      ...(data.percentComplete !== undefined ? { percent_complete: data.percentComplete } : {}),
    })
    .eq('id', id)
    .select('project_id')
    .single()

  if (error) return { error: error.message }

  if (milestone) revalidatePath(`/projects/${milestone.project_id}`)
  refresh()
  return {}
}

export async function deleteMilestone(id: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: milestone } = await supabase.from('milestones').select('project_id').eq('id', id).single()

  const { error } = await supabase.from('milestones').delete().eq('id', id)
  if (error) return { error: error.message }

  if (milestone) revalidatePath(`/projects/${milestone.project_id}`)
  refresh()
  return {}
}

export async function assignTaskMilestone(taskId: string, milestoneId: string | null): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase.from('tasks').update({ milestone_id: milestoneId }).eq('id', taskId)
  if (error) return { error: error.message }

  refresh()
  return {}
}

// ── Project members ──────────────────────────────────────────────────────────

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: 'owner' | 'member' = 'member'
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const supabase = await createClient()
  const { error } = await supabase.from('project_members').insert({
    project_id: projectId,
    user_id: userId,
    org_id: profile.org_id,
    role,
    added_by: profile.id,
  })
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  refresh()
  return {}
}

export async function removeProjectMember(projectId: string, userId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  refresh()
  return {}
}

// ── Project updates (narrative status log) ──────────────────────────────────
// Separate from project_activity (system events) — a human-authored post with
// a self-reported progress snapshot. The snapshot is informational only: it
// never writes back to the project's own auto-computed progress bar.

export async function createProjectUpdate(data: {
  projectId: string
  updateDate: string
  updateText: string
  percentComplete: number
  blockers?: string
}): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  if (!data.updateText.trim()) return { error: 'Write what happened.' }

  const supabase = await createClient()
  const { error } = await supabase.from('project_updates').insert({
    project_id: data.projectId,
    org_id: profile.org_id,
    author_id: profile.id,
    update_date: data.updateDate,
    update_text: data.updateText.trim(),
    percent_snapshot: Math.min(100, Math.max(0, Math.round(data.percentComplete))),
    blockers: data.blockers?.trim() || null,
  })
  if (error) return { error: error.message }

  revalidatePath(`/projects/${data.projectId}`)
  refresh()
  return {}
}

export async function deleteProjectUpdate(id: string, projectId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase.from('project_updates').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  refresh()
  return {}
}
