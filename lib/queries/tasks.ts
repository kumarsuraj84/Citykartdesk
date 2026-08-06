import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/types/database'
import type { TaskStatus, TaskWithDetails, TaskCommentWithAuthor, TaskActivityWithActor } from '@/types'

export type { TaskWithDetails, TaskCommentWithAuthor, TaskActivityWithActor }

type ProfileMini = Pick<Tables<'profiles'>, 'id' | 'full_name'>

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  open:        1,
  done:        2,
  cancelled:   3,
}

export interface PaginatedTasks {
  data: TaskWithDetails[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function getTasks(opts: {
  userId: string
  filter?: 'my_tasks' | 'assigned_me' | 'created_by_me' | 'team' | 'all' | 'due_today' | 'overdue' | 'done_week' | 'team_overdue'
  teamId?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<PaginatedTasks> {
  const supabase = await createClient()
  const { userId, filter = 'my_tasks', teamId, status } = opts
  const pg = opts.page ?? 1
  const size = opts.pageSize ?? 50
  const from = (pg - 1) * size
  const to = from + size - 1

  // Compute time boundaries
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('tasks')
    .select(
      `*, assignee:profiles!tasks_assignee_id_fkey (id, full_name), creator:profiles!tasks_created_by_fkey (id, full_name)`,
      { count: 'exact' }
    )
    // Only top-level tasks (no subtasks) in the main list
    .is('parent_task_id', null)

  if (filter === 'my_tasks') {
    query = query.or(`assignee_id.eq.${userId},created_by.eq.${userId}`)
  } else if (filter === 'assigned_me') {
    query = query.eq('assignee_id', userId)
  } else if (filter === 'created_by_me') {
    query = query.eq('created_by', userId)
  } else if (filter === 'team' && teamId) {
    query = query.eq('team_id', teamId)
  } else if (filter === 'due_today') {
    query = query
      .eq('assignee_id', userId)
      .gte('due_date', todayStart)
      .lte('due_date', todayEnd)
      .not('status', 'in', '("done","cancelled")')
  } else if (filter === 'overdue') {
    query = query
      .eq('assignee_id', userId)
      .lt('due_date', todayStart)
      .not('status', 'in', '("done","cancelled")')
  } else if (filter === 'done_week') {
    query = query
      .eq('assignee_id', userId)
      .eq('status', 'done')
      .gte('updated_at', sevenDaysAgo)
  } else if (filter === 'team_overdue' && teamId) {
    // Team-wide overdue: tasks in the team past due and not completed
    query = query
      .eq('team_id', teamId)
      .lt('due_date', todayStart)
      .not('status', 'in', '("done","cancelled")')
  }
  // 'all': no extra filter (RLS scopes visibility)

  if (status) {
    query = query.eq('status', status as TaskStatus)
  }

  query = query.order('created_at', { ascending: false }).range(from, to)

  const { data, count } = await query
  const rows = (data ?? []) as TaskWithDetails[]

  // Fetch subtask counts — count only, no row data
  if (rows.length > 0) {
    const taskIds = rows.map((r) => r.id)
    const { data: subtaskRows } = await supabase
      .from('tasks')
      .select('parent_task_id')
      .in('parent_task_id', taskIds)
      .not('parent_task_id', 'is', null)

    const countMap = new Map<string, number>()
    for (const sr of subtaskRows ?? []) {
      const pid = sr.parent_task_id as string
      countMap.set(pid, (countMap.get(pid) ?? 0) + 1)
    }
    for (const row of rows) {
      row.subtask_count = countMap.get(row.id) ?? 0
    }
  }

  // Sort by status order
  rows.sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 99
    const sb = STATUS_ORDER[b.status] ?? 99
    if (sa !== sb) return sa - sb
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const total = count ?? 0
  return {
    data: rows,
    total,
    page: pg,
    pageSize: size,
    totalPages: Math.ceil(total / size),
  }
}

export async function getTaskById(id: string): Promise<TaskWithDetails | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!tasks_assignee_id_fkey (id, full_name),
      creator:profiles!tasks_created_by_fkey (id, full_name)
    `)
    .eq('id', id)
    .single()
  return data as TaskWithDetails | null
}

export async function getSubtasks(parentTaskId: string): Promise<TaskWithDetails[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!tasks_assignee_id_fkey (id, full_name),
      creator:profiles!tasks_created_by_fkey (id, full_name)
    `)
    .eq('parent_task_id', parentTaskId)
    .order('created_at', { ascending: true })
  return (data ?? []) as TaskWithDetails[]
}

export async function getTaskComments(taskId: string): Promise<TaskCommentWithAuthor[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('task_comments')
    .select(`*, author:profiles!task_comments_author_id_fkey (id, full_name)`)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  return (data ?? []) as TaskCommentWithAuthor[]
}

export async function getTaskActivity(taskId: string): Promise<TaskActivityWithActor[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('task_activity')
    .select(`*, actor:profiles!task_activity_actor_id_fkey (id, full_name)`)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  return (data ?? []) as TaskActivityWithActor[]
}

// Full assignee set for a task (multi-assignee join). Degrades to [] if the
// task_assignees table isn't present yet (migration 064 not applied).
export async function getTaskAssignees(taskId: string): Promise<ProfileMini[]> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any }
  try {
    const { data, error } = await sb
      .from('task_assignees')
      .select('user_id, profile:profiles!task_assignees_user_id_fkey (id, full_name)')
      .eq('task_id', taskId)
    if (error) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => {
      const p = Array.isArray(r.profile) ? r.profile[0] : r.profile
      return { id: p?.id ?? r.user_id, full_name: p?.full_name ?? 'Unknown' }
    }) as ProfileMini[]
  } catch {
    return []
  }
}

export type TaskAttachment = {
  id: string
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
  uploader: { id: string; full_name: string } | null
}

export async function getTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any }
  try {
    const { data, error } = await sb
      .from('task_attachments')
      .select('id, file_name, file_size, mime_type, created_at, uploader:profiles!task_attachments_uploaded_by_fkey (id, full_name)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    if (error) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      ...r,
      uploader: Array.isArray(r.uploader) ? r.uploader[0] ?? null : r.uploader ?? null,
    })) as TaskAttachment[]
  } catch {
    return []
  }
}

export type TaskIntakeContext = {
  messageId: string
  reviewId: string | null
  subject: string | null
  fromAddress: string | null
  bodyText: string | null
  receivedAt: string | null
  channelName: string | null
  threadCount: number
  attachments: { id: string; file_name: string; file_size: number }[]
}

// Originating intake email for a task created from the intake inbox. Returns
// null when the task has no intake link or the lookup fails (RLS / not found).
export async function getTaskIntakeContext(messageId: string | null): Promise<TaskIntakeContext | null> {
  if (!messageId) return null
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any }
  try {
    const { data: msg, error } = await sb
      .from('intake_messages')
      .select(`
        id, subject, from_address, body_text, received_at, thread_id,
        channel:intake_channels ( name ),
        review:intake_reviews ( id )
      `)
      .eq('id', messageId)
      .maybeSingle()
    if (error || !msg) return null

    const channel = Array.isArray(msg.channel) ? msg.channel[0] : msg.channel
    const review = Array.isArray(msg.review) ? msg.review[0] : msg.review

    const [{ data: attachments }, threadRes] = await Promise.all([
      sb.from('intake_attachments').select('id, file_name, file_size').eq('message_id', messageId),
      msg.thread_id
        ? sb.from('intake_messages').select('id', { count: 'exact', head: true }).eq('thread_id', msg.thread_id)
        : Promise.resolve({ count: 1 }),
    ])

    return {
      messageId: msg.id,
      reviewId: review?.id ?? null,
      subject: msg.subject ?? null,
      fromAddress: msg.from_address ?? null,
      bodyText: msg.body_text ?? null,
      receivedAt: msg.received_at ?? null,
      channelName: channel?.name ?? null,
      threadCount: (threadRes as { count?: number }).count ?? 1,
      attachments: (attachments ?? []) as { id: string; file_name: string; file_size: number }[],
    }
  } catch {
    return null
  }
}

export async function getTasksForRequest(requestId: string): Promise<TaskWithDetails[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!tasks_assignee_id_fkey (id, full_name),
      creator:profiles!tasks_created_by_fkey (id, full_name)
    `)
    .eq('request_id', requestId)
    .is('parent_task_id', null)
    .order('created_at', { ascending: false })
  return (data ?? []) as TaskWithDetails[]
}

import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (table: string) => any }

export async function getCustomFields(teamId: string): Promise<import('@/types').CustomField[]> {
  // Admin client: custom fields schema is config-level, not RLS-scoped per user
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin
    .from('task_custom_fields')
    .select('*')
    .eq('team_id', teamId)
    .order('position', { ascending: true })
  return (data ?? []) as import('@/types').CustomField[]
}

export async function getCustomFieldValues(taskIds: string[]): Promise<Record<string, Record<string, import('@/types').CustomFieldValue['value']>>> {
  if (!taskIds.length) return {}
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin
    .from('task_custom_field_values')
    .select('task_id, field_id, value')
    .in('task_id', taskIds)
  const result: Record<string, Record<string, import('@/types').CustomFieldValue['value']>> = {}
  for (const row of (data ?? []) as { task_id: string; field_id: string; value: unknown }[]) {
    if (!result[row.task_id]) result[row.task_id] = {}
    result[row.task_id][row.field_id] = row.value as import('@/types').CustomFieldValue['value']
  }
  return result
}

export async function getAllProfiles(): Promise<ProfileMini[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true })
    .limit(500)
  return (data ?? []) as ProfileMini[]
}
