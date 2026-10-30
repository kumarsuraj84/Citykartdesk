import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/queries/paging'
import { isOverdueDate } from '@/lib/reporting/ist'
import { isSlaPausedStatus } from '@/lib/constants/requests'

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
export async function getWorkloadReport(orgId: string, teamIds: string[] | null = null): Promise<WorkloadRow[]> {
  // null = every group; an empty list = none (a viewer in no group sees no workload).
  if (teamIds && teamIds.length === 0) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inGroups = (q: any) => (teamIds ? q.in('team_id', teamIds) : q)
  const admin = createAdminClient() as unknown as AnyClient
  const now = new Date()

  // Admin client bypasses RLS — every query below scopes to orgId explicitly. Every page is read (the database answers at most 1000 rows per request; a busy
  // queue has more open tickets than that, and a shorter list made the busiest technician look less busy).
  const [{ rows: openRequests }, { rows: openTasks }, { rows: profiles }] = await Promise.all([
    fetchAllPages<{ assigned_to: string; resolution_due_at: string | null; status: string }>((from, to) => inGroups(admin.from('requests')
      .select('assigned_to,resolution_due_at,status')
      .eq('org_id', orgId)
      .not('status', 'in', '("resolved","closed","cancelled")')
      .not('assigned_to', 'is', null))
      .order('id', { ascending: true }).range(from, to)),
    fetchAllPages<{ assignee_id: string; due_date: string | null }>((from, to) => inGroups(admin.from('tasks')
      .select('assignee_id,due_date')
      .eq('org_id', orgId)
      .not('status', 'in', '("done","cancelled")')
      .not('assignee_id', 'is', null))
      .order('id', { ascending: true }).range(from, to)),
    fetchAllPages<{ id: string; full_name: string }>((from, to) => admin.from('profiles').select('id,full_name').eq('org_id', orgId).order('id', { ascending: true }).range(from, to)),
  ])

  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))

  const agg: Record<string, { openRequests: number; overdueRequests: number; openTasks: number; overdueTasks: number }> = {}

  for (const r of openRequests ?? []) {
    const a = (agg[r.assigned_to] ??= { openRequests: 0, overdueRequests: 0, openTasks: 0, overdueTasks: 0 })
    a.openRequests++
    // (a ticket waiting for somebody else has its clock stopped: it is not overdue while it waits)
    if (r.resolution_due_at && !isSlaPausedStatus(r.status) && new Date(r.resolution_due_at) < now) a.overdueRequests++
  }

  for (const t of openTasks ?? []) {
    const a = (agg[t.assignee_id] ??= { openRequests: 0, overdueRequests: 0, openTasks: 0, overdueTasks: 0 })
    a.openTasks++
    if (isOverdueDate(t.due_date)) a.overdueTasks++
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
