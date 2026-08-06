'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { periodStart, type Period } from '@/lib/queries/analytics'

// ── Shared filter type — _module switches which table is queried ──────────────

export type DrawerFilter = {
  title: string
  description?: string
  _module?: 'requests' | 'tasks'  // defaults to 'requests'
  // Request filters
  status?: string[]
  priority?: string
  teamId?: string
  assignedTo?: string
  slaBreached?: boolean
  frtBreached?: boolean
  resolvedInPeriod?: boolean
  createdInPeriod?: boolean
  period?: Period
  sort?: 'created_desc' | 'tat_desc' | 'priority'
  // Task-specific filters
  taskOverdue?: boolean
  taskCompletedInPeriod?: boolean
  taskType?: 'personal' | 'team'
  taskLinkedToRequest?: boolean
  taskStandalone?: boolean
}

// ── Request drawer ────────────────────────────────────────────────────────────

export type DrawerRequest = {
  id: string
  title: string
  status: string
  priority: string
  created_at: string
  resolved_at: string | null
  assigned_to: string | null
  team_id: string | null
  resolution_due_at: string | null
  responded_at: string | null
  assignee_name: string | null
  team_name: string | null
  service_name: string | null
}

export async function getFilteredRequests(filter: DrawerFilter): Promise<{
  data: DrawerRequest[]
  error?: string
}> {
  // Route to task query if module = tasks
  if (filter._module === 'tasks') {
    const res = await getFilteredTasks(filter)
    // Return as DrawerRequest shape so DrawerRequest component works for both
    return {
      data: res.data.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        created_at: t.created_at,
        resolved_at: t.completed_at,
        assigned_to: t.assignee_id,
        team_id: t.team_id,
        resolution_due_at: t.due_date,
        responded_at: null,
        assignee_name: t.assignee_name,
        team_name: t.team_name,
        service_name: null,
      })),
      error: res.error,
    }
  }

  try {
    const admin = createAdminClient()
    const now   = new Date().toISOString()

    let q = admin
      .from('requests')
      .select(`
        id, title, status, priority, created_at, resolved_at,
        assigned_to, team_id, resolution_due_at, response_due_at, responded_at,
        assignee:profiles!requests_assigned_to_fkey(full_name),
        team:teams(name),
        service:services(name)
      `)

    if (filter.status?.length)   q = q.in('status', filter.status)
    if (filter.priority)         q = q.eq('priority', filter.priority)
    if (filter.teamId)           q = q.eq('team_id', filter.teamId)
    if (filter.assignedTo)       q = q.eq('assigned_to', filter.assignedTo)

    if (filter.slaBreached) {
      q = q.not('resolution_due_at', 'is', null).lt('resolution_due_at', now)
           .not('status', 'in', '("resolved","closed","cancelled")')
    }
    if (filter.frtBreached) {
      q = q.is('responded_at', null)
           .not('status', 'in', '("resolved","closed","cancelled")')
    }
    if (filter.resolvedInPeriod && filter.period) {
      const start = periodStart(filter.period).toISOString()
      q = q.gte('resolved_at', start).not('resolved_at', 'is', null)
    }
    if (filter.createdInPeriod && filter.period) {
      q = q.gte('created_at', periodStart(filter.period).toISOString())
    }

    q = q.order('created_at', { ascending: false }).limit(50)

    const { data, error } = await q
    if (error) return { data: [], error: error.message }

    return {
      data: (data ?? []).map((r: any) => ({
        id: r.id, title: r.title, status: r.status, priority: r.priority,
        created_at: r.created_at, resolved_at: r.resolved_at,
        assigned_to: r.assigned_to, team_id: r.team_id,
        resolution_due_at: r.resolution_due_at, responded_at: r.responded_at,
        assignee_name: r.assignee?.full_name ?? null,
        team_name: r.team?.name ?? null,
        service_name: r.service?.name ?? null,
      })),
    }
  } catch (e: any) {
    return { data: [], error: e.message }
  }
}

// ── Task drawer ───────────────────────────────────────────────────────────────

type DrawerTask = {
  id: string
  title: string
  status: string
  priority: string
  created_at: string
  completed_at: string | null
  assignee_id: string | null
  team_id: string | null
  due_date: string | null
  task_type: string
  assignee_name: string | null
  team_name: string | null
}

async function getFilteredTasks(filter: DrawerFilter): Promise<{
  data: DrawerTask[]
  error?: string
}> {
  try {
    const admin = createAdminClient()
    const now   = new Date().toISOString()

    let q = admin
      .from('tasks')
      .select(`
        id, title, status, priority, task_type,
        created_at, completed_at, due_date,
        assignee_id, team_id, request_id,
        assignee:profiles!tasks_assignee_id_fkey(full_name),
        team:teams(name)
      `)

    if (filter.status?.length)   q = q.in('status', filter.status)
    if (filter.priority)         q = q.eq('priority', filter.priority)
    if (filter.teamId)           q = q.eq('team_id', filter.teamId)
    if (filter.assignedTo)       q = q.eq('assignee_id', filter.assignedTo)
    if (filter.taskType)         q = q.eq('task_type', filter.taskType)
    if (filter.taskLinkedToRequest) q = q.not('request_id', 'is', null)
    if (filter.taskStandalone)      q = q.is('request_id', null)

    if (filter.taskOverdue) {
      q = q.not('due_date', 'is', null).lt('due_date', now)
           .not('status', 'in', '("done","cancelled")')
    }
    if (filter.taskCompletedInPeriod && filter.period) {
      const start = periodStart(filter.period).toISOString()
      q = q.gte('completed_at', start).not('completed_at', 'is', null)
    }
    if (filter.createdInPeriod && filter.period) {
      q = q.gte('created_at', periodStart(filter.period).toISOString())
    }

    q = q.order('created_at', { ascending: false }).limit(50)

    const { data, error } = await q
    if (error) return { data: [], error: error.message }

    return {
      data: (data ?? []).map((t: any) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
        task_type: t.task_type, created_at: t.created_at,
        completed_at: t.completed_at, due_date: t.due_date,
        assignee_id: t.assignee_id, team_id: t.team_id,
        assignee_name: t.assignee?.full_name ?? null,
        team_name: t.team?.name ?? null,
      })),
    }
  } catch (e: any) {
    return { data: [], error: e.message }
  }
}
