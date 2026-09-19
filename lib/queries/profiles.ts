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

  // A one-off database hiccup used to look exactly like "no profile", which the
  // layout turns into a redirect to /login — and the proxy bounces a signed-in user
  // straight back, looping until the browser throttles navigation (blank page).
  // Retry once on a real error; a genuinely missing row (PGRST116) is not retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
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

    if (!error) return data as ProfileWithTeams | null
    if (error.code === 'PGRST116') return null
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
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

/** Org-wide fallback for the Assignee column filter/bulk Assign-To picker when
 *  no team-scoped candidates exist — unlike getAllProfiles(), restricted to
 *  agent-tier roles since a plain 'user' can't actually be assigned a request. */
export async function getAgentTierProfiles(): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('role', ['agent', 'manager', 'admin', 'platform_owner'])
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

// Only these roles can actually be assigned a request and act on it (see
// isAgent checks throughout lib/actions/requests.ts) — a plain 'user' who
// happens to be a team_members row (e.g. legacy data, or added for reporting
// visibility) can't pick up or work a ticket, so team-member pickers must not
// offer them as an assignee.
const AGENT_TIER_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

export async function getTeamMembers(
  teamId: string
): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('team_members')
    .select('user:profiles!team_members_user_id_fkey (id, full_name, role)')
    .eq('team_id', teamId)
  if (!data) return []
  return data
    .map((row) => row.user as { id: string; full_name: string; role: string } | null)
    .filter((u): u is { id: string; full_name: string; role: string } => u !== null && AGENT_TIER_ROLES.includes(u.role))
    .map((u) => ({ id: u.id, full_name: u.full_name }))
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
    .select('user:profiles!team_members_user_id_fkey (id, full_name, role)')
    .in('team_id', teamIds)
  if (!data) return []
  const byId = new Map<string, { id: string; full_name: string }>()
  for (const row of data) {
    const u = row.user as { id: string; full_name: string; role: string } | null
    if (u && AGENT_TIER_ROLES.includes(u.role)) byId.set(u.id, { id: u.id, full_name: u.full_name })
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

/** Whether this user has any direct reports at all — drives whether the
 *  "My Team" view on /requests is worth showing (org-chart based, via
 *  profiles.manager_id — a separate concept from Team membership). */
export const hasSubordinates = cache(async function (userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('manager_id', userId)
  return (count ?? 0) > 0
})

export type NavCounts = {
  requests: number
  tasks: number
  approvals: number
  notifications: number
  projects: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countPendingApprovalsForUser(supabase: any, userId: string): Promise<number> {
  // approvals and approval_workflow_steps are SIBLINGS under
  // approval_workflows (no direct FK between them), so PostgREST can't embed
  // one under the other in a single .select() — that query silently errors
  // and falls back to 0. Two plain queries instead: which workflows this
  // user is a step-approver on, then how many of THOSE are still pending.
  const { data: steps } = await supabase
    .from('approval_workflow_steps')
    .select('workflow_id')
    .or(`approver_user_id.eq.${userId},approver_type.eq.any_manager`)
  const workflowIds = [...new Set((steps ?? []).map((s: { workflow_id: string }) => s.workflow_id))]
  if (workflowIds.length === 0) return 0

  const { count } = await supabase
    .from('approvals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .in('workflow_id', workflowIds)
  return count ?? 0
}

export const getNavCounts = cache(async function (userId: string): Promise<NavCounts> {
  const supabase = await createClient()

  const [requestsRes, tasksRes, approvalsCount, notifRes, projectsRes] = await Promise.all([
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
    countPendingApprovalsForUser(supabase, userId),
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
    approvals: approvalsCount,
    notifications: notifRes.count ?? 0,
    projects: projectsRes.count ?? 0,
  }
})
