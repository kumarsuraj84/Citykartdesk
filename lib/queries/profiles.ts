import { cache } from 'react'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { ModuleSlug, ProfileWithTeams } from '@/types'

export const getCurrentProfile = cache(async function (): Promise<ProfileWithTeams | null> {
  const supabase = await createClient()

  // proxy.ts already verified the session for this exact request and forwards the
  // result via this header — trust it instead of re-verifying with a second
  // supabase.auth.getUser() network round-trip (proxy.ts always sets it, even to ''
  // when unauthenticated, so a *missing* header only happens for requests that
  // somehow bypassed middleware — fall back to a real check in that case).
  const forwardedUserId = (await headers()).get('x-verified-user-id')
  let userId: string | null
  if (forwardedUserId !== null) {
    userId = forwardedUserId || null
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }

  if (!userId) return null

  const { data } = await supabase
    .from('profiles')
    .select(`
      *,
      team_members (
        team_id,
        is_lead,
        joined_at,
        team:teams (*)
      )
    `)
    .eq('id', userId)
    .single()

  return data as ProfileWithTeams | null
})

export async function getAllProfiles(): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  // RLS already scopes to current org; select only needed columns, cap at 100
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .order('full_name')
    .limit(100)
  return (data ?? []) as { id: string; full_name: string }[]
}

export async function searchProfiles(query: string): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  const safe = query.replace(/[%_]/g, '\\$&').trim()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .ilike('full_name', `%${safe}%`)
    .order('full_name')
    .limit(10)
  return (data ?? []) as { id: string; full_name: string }[]
}

export async function getTeamMembers(
  teamId: string
): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('team_members')
    .select('user:profiles!team_members_user_id_fkey (id, full_name)')
    .eq('team_id', teamId)
  if (!data) return []
  return data
    .map((row) => row.user as { id: string; full_name: string } | null)
    .filter((u): u is { id: string; full_name: string } => u !== null)
}

/**
 * Distinct agents across a set of teams — used for the Team Queue's "who's
 * working this?" filter and its bulk Assign-To picker, both of which should
 * only offer agents actually on one of the teams whose requests are visible
 * in the current queue (RLS already scopes the queue itself to those teams),
 * not every profile in the org.
 */
export async function getTeamMembersForTeams(
  teamIds: string[]
): Promise<{ id: string; full_name: string }[]> {
  if (teamIds.length === 0) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('team_members')
    .select('user:profiles!team_members_user_id_fkey (id, full_name)')
    .in('team_id', teamIds)
  if (!data) return []
  const byId = new Map<string, { id: string; full_name: string }>()
  for (const row of data) {
    const u = row.user as { id: string; full_name: string } | null
    if (u) byId.set(u.id, u)
  }
  return Array.from(byId.values()).sort((a, b) => a.full_name.localeCompare(b.full_name))
}

export async function searchAgentsForRequest(
  teamId: string,
  query: string
): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  const safe = query.replace(/[%_]/g, '\\$&').trim()
  const { data } = await supabase
    .from('team_members')
    .select('user:profiles!team_members_user_id_fkey (id, full_name)')
    .eq('team_id', teamId)
    .limit(10)
  if (!data) return []
  const members = data
    .map((row) => row.user as { id: string; full_name: string } | null)
    .filter((u): u is { id: string; full_name: string } => u !== null)
  if (!safe) return members
  const lower = safe.toLowerCase()
  return members.filter((u) => u.full_name.toLowerCase().includes(lower))
}

/**
 * Wrapped in React.cache() so that layout + any server component that calls it
 * with the same userId within a single render tree shares one DB round trip.
 */
export const getEnabledModules = cache(async function (): Promise<ModuleSlug[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('org_module_access')
    .select('module, enabled, valid_until')
  if (!data) return []
  const now = new Date().toISOString()
  return data
    .filter((r) => r.enabled && (r.valid_until === null || r.valid_until > now))
    .map((r) => r.module as ModuleSlug)
})

export const getTrialInfo = cache(async function (): Promise<{
  isTrial: boolean
  daysLeft: number
  isExpired: boolean
} | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('organizations')
    .select('status, trial_ends_at')
    .maybeSingle()

  if (!data || data.status !== 'trial' || !data.trial_ends_at) return null

  const now = new Date()
  const end = new Date(data.trial_ends_at)
  const diffMs = end.getTime() - now.getTime()
  const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

  return {
    isTrial: true,
    daysLeft,
    isExpired: diffMs <= 0,
  }
})

export const getUnreadNotificationCount = cache(async function (
  userId: string
): Promise<number> {
  const supabase = await createClient()

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)

  return count ?? 0
})

export type NavCounts = {
  requests: number
  tasks: number
  approvals: number
  notifications: number
  projects: number
}

export const getNavCounts = cache(async function (userId: string): Promise<NavCounts> {
  const supabase = await createClient()

  const [requestsRes, tasksRes, approvalsRes, notifRes, projectsRes] = await Promise.all([
    supabase
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .eq('requester_id', userId)
      .in('status', ['open', 'in_progress', 'pending_approval']),
    supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('assignee_id', userId)
      .in('status', ['open', 'in_progress']),
    supabase
      .from('approvals')
      .select('id, approval_workflow_steps!inner(approver_user_id, approver_type)', { count: 'exact', head: true })
      .eq('status', 'pending')
      .or(`approver_user_id.eq.${userId},approver_type.eq.any_manager`, { foreignTable: 'approval_workflow_steps' }),
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null),
    supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .is('archived_at', null)
      .not('status', 'in', '("done","cancelled")'),
  ])

  return {
    requests: requestsRes.count ?? 0,
    tasks: tasksRes.count ?? 0,
    approvals: approvalsRes.count ?? 0,
    notifications: notifRes.count ?? 0,
    projects: projectsRes.count ?? 0,
  }
})
