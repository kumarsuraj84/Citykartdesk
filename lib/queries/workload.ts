import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** Ticket-count-based capacity threshold — no effort-estimate field exists yet,
 *  so this is the simplest useful signal until hours-based capacity planning lands. */
export const WORKLOAD_THRESHOLD = 15

export type WorkloadRow = {
  agentId: string
  agentName: string
  openRequests: number
  overdueRequests: number
  openTasks: number
  overdueTasks: number
  totalOpen: number
}

/** Current per-agent open workload across Requests + Tasks — unlike the period-scoped
 *  agentLeaderboard in analytics.ts/taskAnalytics.ts, this is a right-now snapshot
 *  (capacity is about current load, not historical throughput) and covers every
 *  agent with open work, not just the top 10 by resolved/done count. */
export async function getWorkloadReport(orgId: string): Promise<WorkloadRow[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const now = new Date()

  // Admin client bypasses RLS — every query below scopes to orgId explicitly.
  const [{ data: openRequests }, { data: openTasks }, { data: profiles }] = await Promise.all([
    admin.from('requests')
      .select('assigned_to,resolution_due_at')
      .eq('org_id', orgId)
      .not('status', 'in', '("resolved","closed","cancelled")')
      .not('assigned_to', 'is', null),
    admin.from('tasks')
      .select('assignee_id,due_date')
      .eq('org_id', orgId)
      .not('status', 'in', '("done","cancelled")')
      .not('assignee_id', 'is', null),
    admin.from('profiles').select('id,full_name').eq('org_id', orgId),
  ])

  type ProfileRow = { id: string; full_name: string }
  const profileMap = Object.fromEntries(((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p.full_name]))

  const agg: Record<string, { openRequests: number; overdueRequests: number; openTasks: number; overdueTasks: number }> = {}

  for (const r of openRequests ?? []) {
    const a = (agg[r.assigned_to] ??= { openRequests: 0, overdueRequests: 0, openTasks: 0, overdueTasks: 0 })
    a.openRequests++
    if (r.resolution_due_at && new Date(r.resolution_due_at) < now) a.overdueRequests++
  }

  for (const t of openTasks ?? []) {
    const a = (agg[t.assignee_id] ??= { openRequests: 0, overdueRequests: 0, openTasks: 0, overdueTasks: 0 })
    a.openTasks++
    if (t.due_date && new Date(t.due_date) < now) a.overdueTasks++
  }

  return Object.entries(agg)
    .map(([agentId, v]) => ({
      agentId,
      agentName: profileMap[agentId] ?? 'Unknown',
      ...v,
      totalOpen: v.openRequests + v.openTasks,
    }))
    .sort((a, b) => b.totalOpen - a.totalOpen)
}
