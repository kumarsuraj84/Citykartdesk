'use server'

import { revalidatePath, refresh } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { notify, type NotifyInput } from '@/lib/notifications'
import {
  getTaskById,
  getTaskComments,
  getTaskActivity,
  getSubtasks,
  getTaskDependencies,
} from '@/lib/queries/tasks'
import { getEnabledModules } from '@/lib/queries/profiles'
import type { TaskStatus, TaskPriority, TaskType } from '@/types'
import type { Json, Database } from '@/types/database'

// ── Fetch subtasks (for table row expand) ────────────────────────────────────

export async function fetchSubtasks(parentTaskId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select(`*, assignee:profiles!tasks_assignee_id_fkey(id, full_name), creator:profiles!tasks_created_by_fkey(id, full_name)`)
    .eq('parent_task_id', parentTaskId)
    .order('created_at', { ascending: true })
  return data ?? []
}

// ── Load task panel data (for client-side panel opening) ─────────────────────

export async function loadTaskPanelData(taskId: string) {
  const [task, comments, activity, subtasks, dependencies] = await Promise.all([
    getTaskById(taskId),
    getTaskComments(taskId),
    getTaskActivity(taskId),
    getSubtasks(taskId),
    getTaskDependencies(taskId),
  ])

  let linkedRequest: { id: string; request_no: string; title: string } | null = null
  let linkedProject: { id: string; name: string } | null = null
  if (task?.request_id || task?.project_id) {
    const supabase = await createClient()
    if (task.request_id) {
      const { data } = await supabase
        .from('requests')
        .select('id, request_no, title')
        .eq('id', task.request_id)
        .single()
      linkedRequest = data ?? null
    }
    if (task.project_id) {
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', task.project_id)
        .single()
      linkedProject = data ?? null
    }
  }

  return { task, comments, activity, subtasks, dependencies, linkedRequest, linkedProject }
}

type ActionResult = { error?: string }

// ── Log task activity (admin client to bypass RLS) ────────────────────────────

async function logTaskActivity(opts: {
  taskId: string
  actorId: string
  action: 'created' | 'assigned' | 'unassigned' | 'status_changed' | 'comment_added' | 'completed' | 'reopened' | 'cancelled'
  metadata?: Record<string, unknown>
}) {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('task_activity').insert({
      task_id: opts.taskId,
      actor_id: opts.actorId,
      action: opts.action,
      metadata: (opts.metadata ?? {}) as Json,
    })
    if (error) {
      console.error('[logTaskActivity] failed', error.message)
    }
  } catch (err) {
    console.error('[logTaskActivity] unexpected', err)
  }
}

// ── Create task ───────────────────────────────────────────────────────────────

export async function createTask(data: {
  title: string
  description?: string
  assigneeId?: string
  priority?: TaskPriority
  status?: TaskStatus
  dueDate?: string
  teamId?: string
  taskType?: TaskType
  parentTaskId?: string
  requestId?: string
  projectId?: string
  milestoneId?: string
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const enabledModules = await getEnabledModules()
  if (!enabledModules.includes('tasks')) return { error: 'The Tasks module is not enabled for your organisation.' }

  const supabase = await createClient()

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title: data.title.trim(),
      description: data.description?.trim() || null,
      assignee_id: data.assigneeId || null,
      priority: data.priority ?? 'medium',
      due_date: data.dueDate || null,
      team_id: data.teamId || null,
      task_type: data.taskType ?? (data.teamId ? 'team' : 'personal'),
      created_by: profile.id,
      org_id: profile.org_id ?? null,
      status: data.status ?? 'open',
      parent_task_id: data.parentTaskId || null,
      request_id: data.requestId || null,
      project_id: data.projectId || null,
      milestone_id: data.milestoneId || null,
    })
    .select('id')
    .single()

  if (error || !task) {
    return { error: error?.message ?? 'Failed to create task.' }
  }

  await logTaskActivity({
    taskId: task.id,
    actorId: profile.id,
    action: 'created',
  })

  revalidatePath('/tasks')
  refresh()
  return { data: { id: task.id } }
}

// ── Update task status ────────────────────────────────────────────────────────

export async function updateTaskStatus(
  taskId: string,
  newStatus: TaskStatus
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  // Fetch current task data
  const { data: current } = await supabase
    .from('tasks')
    .select('status, title, created_by, request_id')
    .eq('id', taskId)
    .single()

  if (!current) return { error: 'Task not found.' }

  const oldStatus = current.status as TaskStatus

  const completedAt =
    newStatus === 'done' ? new Date().toISOString() :
    (oldStatus === 'done' || oldStatus === 'cancelled') ? null :
    undefined

  const { error } = await supabase.from('tasks').update({
    status: newStatus,
    updated_at: new Date().toISOString(),
    ...(completedAt !== undefined ? { completed_at: completedAt } : {}),
  }).eq('id', taskId)
  if (error) return { error: error.message }

  const action =
    newStatus === 'done' ? 'completed' :
    newStatus === 'cancelled' ? 'cancelled' :
    (oldStatus === 'done' || oldStatus === 'cancelled') ? 'reopened' :
    'status_changed'

  await logTaskActivity({
    taskId,
    actorId: profile.id,
    action,
    metadata: { from: oldStatus, to: newStatus },
  })

  // Notify on completion
  if (newStatus === 'done') {
    const notifications: NotifyInput[] = []

    // Notify the task creator if different from the actor
    if (current.created_by && current.created_by !== profile.id) {
      notifications.push({
        recipientId: current.created_by,
        actorId: profile.id,
        type: 'task_completed',
        title: 'Task completed',
        body: `${current.title} has been marked done`,
        taskId,
        link: `/tasks?task=${taskId}`,
      })
    }

    // Notify the linked request's assignee if applicable
    if (current.request_id) {
      const admin = createAdminClient()
      const { data: req } = await admin
        .from('requests')
        .select('assigned_to')
        .eq('id', current.request_id)
        .single()

      if (req?.assigned_to && req.assigned_to !== profile.id && req.assigned_to !== current.created_by) {
        notifications.push({
          recipientId: req.assigned_to,
          actorId: profile.id,
          type: 'task_completed',
          title: 'Task completed',
          body: `${current.title} has been marked done`,
          taskId,
          requestId: current.request_id,
          link: `/tasks?task=${taskId}`,
        })
      }
    }

    if (notifications.length > 0) {
      notify(notifications).catch(() => {})
    }
  }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  return {}
}

// ── Update a single task field ────────────────────────────────────────────────

export async function updateTaskField(
  taskId: string,
  field: 'title' | 'description' | 'priority' | 'due_date' | 'assignee_id',
  value: string | null
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  // For assignee change, fetch existing task data for activity log and notification
  let oldAssigneeId: string | null = null
  let taskTitle: string | null = null
  let taskRequestId: string | null = null
  if (field === 'assignee_id') {
    const { data: current } = await supabase
      .from('tasks')
      .select('assignee_id, title, request_id')
      .eq('id', taskId)
      .single()
    oldAssigneeId = current?.assignee_id ?? null
    taskTitle = current?.title ?? null
    taskRequestId = current?.request_id ?? null
  }

  const updatedAt = new Date().toISOString()

  // Each field gets its own typed update to satisfy supabase's strict typegen.
  // `tasks_update` RLS silently matches zero rows (not an error) for a task the
  // caller isn't the creator/assignee/team-member/manager-admin of — chaining
  // .select().maybeSingle() lets us tell "updated" from "no-op" apart and
  // return a real error instead of a false success.
  let updateError: string | undefined
  let updatedRow: { id: string } | null = null
  if (field === 'title') {
    const { data, error } = await supabase.from('tasks').update({ title: value ?? '', updated_at: updatedAt }).eq('id', taskId).select('id').maybeSingle()
    if (error) updateError = error.message
    updatedRow = data
  } else if (field === 'description') {
    const { data, error } = await supabase.from('tasks').update({ description: value, updated_at: updatedAt }).eq('id', taskId).select('id').maybeSingle()
    if (error) updateError = error.message
    updatedRow = data
  } else if (field === 'priority') {
    const { data, error } = await supabase.from('tasks').update({ priority: value as TaskPriority, updated_at: updatedAt }).eq('id', taskId).select('id').maybeSingle()
    if (error) updateError = error.message
    updatedRow = data
  } else if (field === 'due_date') {
    const { data, error } = await supabase.from('tasks').update({ due_date: value, updated_at: updatedAt }).eq('id', taskId).select('id').maybeSingle()
    if (error) updateError = error.message
    updatedRow = data
  } else if (field === 'assignee_id') {
    const { data, error } = await supabase.from('tasks').update({ assignee_id: value, updated_at: updatedAt }).eq('id', taskId).select('id').maybeSingle()
    if (error) updateError = error.message
    updatedRow = data
  }

  const error = updateError ? { message: updateError } : null

  if (error) return { error: error.message }
  if (!updatedRow) return { error: 'Task not found, or you do not have permission to edit it.' }

  if (field === 'assignee_id') {
    const action = value ? 'assigned' : 'unassigned'
    await logTaskActivity({
      taskId,
      actorId: profile.id,
      action,
      metadata: { from: oldAssigneeId, to: value },
    })

    // Notify new assignee (only when assigning, not unassigning)
    if (value && value !== profile.id) {
      notify({
        recipientId: value,
        actorId: profile.id,
        type: 'task_assigned',
        title: 'Task assigned to you',
        body: `You have been assigned: ${taskTitle ?? 'a task'}`,
        taskId,
        ...(taskRequestId ? { requestId: taskRequestId } : {}),
        link: `/tasks?task=${taskId}`,
      }).catch(() => {})
    }
  }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  return {}
}

// Update the work-item "Source" (stored in source_metadata.created_via). Merges
// into existing source_metadata so intake provenance fields (intake_review_id,
// intake_message_id, …) are preserved when a user re-labels the source.
export async function updateTaskSource(taskId: string, source: string | null): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('tasks')
    .select('source_metadata')
    .eq('id', taskId)
    .maybeSingle()

  // tasks_select RLS returns null (not an error) for a task the caller can't
  // see — without this check the update below would silently no-op.
  if (!current) return { error: 'Task not found, or you do not have permission to edit it.' }

  const meta = { ...((current as { source_metadata?: Record<string, unknown> | null } | null)?.source_metadata ?? {}) }
  if (source) meta.created_via = source
  else delete meta.created_via

  const { error } = await supabase
    .from('tasks')
    .update({ source_metadata: meta, updated_at: new Date().toISOString() } as never)
    .eq('id', taskId)
  if (error) return { error: error.message }

  revalidatePath('/tasks')
  return {}
}

// ── Tags ───────────────────────────────────────────────────────────────────
export async function updateTaskTags(taskId: string, tags: string[]): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  const clean = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean))).slice(0, 20)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tasks')
    .update({ tags: clean, updated_at: new Date().toISOString() } as never)
    .eq('id', taskId)
    .select('id')
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Task not found, or you do not have permission to edit it.' }
  revalidatePath('/tasks'); revalidatePath(`/tasks/${taskId}`)
  return {}
}

// ── Date range (start_date + due_date) ───────────────────────────────────────
export async function updateTaskDates(taskId: string, startDate: string | null, dueDate: string | null): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tasks')
    .update({ start_date: startDate || null, due_date: dueDate || null, updated_at: new Date().toISOString() } as never)
    .eq('id', taskId)
    .select('id')
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Task not found, or you do not have permission to edit it.' }
  revalidatePath('/tasks'); revalidatePath(`/tasks/${taskId}`)
  return {}
}

// ── Multi-assignee (task_assignees join) ─────────────────────────────────────
export async function addTaskAssignee(taskId: string, userId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any }
  const { error } = await sb
    .from('task_assignees')
    .upsert({ task_id: taskId, user_id: userId, added_by: profile.id }, { onConflict: 'task_id,user_id' })
  if (error) return { error: error.message }

  // Keep the primary assignee_id populated when the task had none, so the
  // (untouched) task list still shows an assignee.
  const { data: task } = await supabase.from('tasks').select('assignee_id, title, request_id').eq('id', taskId).single()
  if (task && !(task as { assignee_id: string | null }).assignee_id) {
    await supabase.from('tasks').update({ assignee_id: userId } as never).eq('id', taskId)
  }

  await logTaskActivity({ taskId, actorId: profile.id, action: 'assigned', metadata: { to: userId } }).catch(() => {})
  if (userId !== profile.id) {
    notify({
      recipientId: userId, actorId: profile.id, type: 'task_assigned',
      title: 'Task assigned to you',
      body: `You have been assigned: ${(task as { title?: string } | null)?.title ?? 'a task'}`,
      taskId, link: `/tasks?task=${taskId}`,
    }).catch(() => {})
  }
  revalidatePath('/tasks'); revalidatePath(`/tasks/${taskId}`)
  return {}
}

export async function removeTaskAssignee(taskId: string, userId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any }
  const { error } = await sb.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', userId)
  if (error) return { error: error.message }

  // If we removed the primary assignee, promote another remaining one (or clear).
  const { data: task } = await supabase.from('tasks').select('assignee_id').eq('id', taskId).single()
  if (task && (task as { assignee_id: string | null }).assignee_id === userId) {
    const { data: remaining } = await sb.from('task_assignees').select('user_id').eq('task_id', taskId).limit(1)
    const next = (remaining ?? [])[0]?.user_id ?? null
    await supabase.from('tasks').update({ assignee_id: next } as never).eq('id', taskId)
  }
  await logTaskActivity({ taskId, actorId: profile.id, action: 'unassigned', metadata: { from: userId } }).catch(() => {})
  revalidatePath('/tasks'); revalidatePath(`/tasks/${taskId}`)
  return {}
}

// ── Add task comment ──────────────────────────────────────────────────────────

export async function addTaskComment(taskId: string, body: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  if (!body.trim()) return { error: 'Comment body is required.' }

  const supabase = await createClient()

  const { error } = await supabase.from('task_comments').insert({
    task_id: taskId,
    author_id: profile.id,
    body: body.trim(),
  })

  if (error) return { error: error.message }

  await logTaskActivity({
    taskId,
    actorId: profile.id,
    action: 'comment_added',
  })

  revalidatePath(`/tasks/${taskId}`)
  refresh()
  return {}
}

// ── Create subtask ────────────────────────────────────────────────────────────

export async function createSubtask(
  parentTaskId: string,
  title: string,
  opts?: { assigneeId?: string; dueDate?: string; priority?: TaskPriority }
): Promise<ActionResult & { data?: { id: string } }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  if (!title.trim()) return { error: 'Title is required.' }

  const supabase = await createClient()

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title: title.trim(),
      parent_task_id: parentTaskId,
      task_type: 'personal',
      created_by: profile.id,
      status: 'open',
      priority: opts?.priority ?? 'medium',
      assignee_id: opts?.assigneeId ?? null,
      due_date: opts?.dueDate ?? null,
    })
    .select('id')
    .single()

  if (error || !task) return { error: error?.message ?? 'Failed to create subtask.' }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${parentTaskId}`)
  refresh()
  return { data: { id: task.id } }
}

// ── Task dependencies ("Blocked by") ──────────────────────────────────────────

/** True if `target` can already reach `from` by following existing depends_on
 *  edges — i.e. adding from→target would close a cycle. Bounded DFS since this
 *  is a small per-org graph, not a risk of runaway recursion in practice. */
async function wouldCreateCycle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  from: string,
  target: string
): Promise<boolean> {
  const visited = new Set<string>()
  const stack = [target]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === from) return true
    if (visited.has(current)) continue
    visited.add(current)
    if (visited.size > 500) break // safety valve, not expected to trigger
    const { data: edges } = await supabase
      .from('task_dependencies')
      .select('depends_on_task_id')
      .eq('task_id', current)
    for (const e of edges ?? []) stack.push(e.depends_on_task_id)
  }
  return false
}

export async function addTaskDependency(
  taskId: string,
  query: string
): Promise<ActionResult & { data?: { id: string; taskId: string; title: string; status: TaskStatus } }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrAbove =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'
  if (!isAgentOrAbove) return { error: 'Only agents and managers can link task dependencies.' }

  const supabase = await createClient()

  const { data: task } = await supabase.from('tasks').select('id, org_id').eq('id', taskId).single()
  if (!task?.org_id) return { error: 'Could not determine org.' }

  const safe = query.replace(/[%_]/g, '\\$&')
  const { data: found } = await supabase
    .from('tasks')
    .select('id, title, status')
    .ilike('title', `%${safe}%`)
    .neq('id', taskId)
    .limit(1)
    .single()

  if (!found) return { error: 'No matching task found.' }

  if (await wouldCreateCycle(supabase, taskId, found.id)) {
    return { error: `Adding this would create a circular dependency (${found.title} already depends on this task).` }
  }

  const { data: dep, error } = await supabase
    .from('task_dependencies')
    .insert({
      org_id: task.org_id,
      task_id: taskId,
      depends_on_task_id: found.id,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'This dependency already exists.' }
    return { error: error.message }
  }

  revalidatePath(`/tasks/${taskId}`)
  refresh()
  return { data: { id: dep.id, taskId: found.id, title: found.title, status: found.status } }
}

export async function removeTaskDependency(dependencyId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data, error } = await supabase.from('task_dependencies').delete().eq('id', dependencyId).select('id').maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Dependency not found, or you do not have permission to remove it.' }

  refresh()
  return {}
}

// ── Toggle subtask done ───────────────────────────────────────────────────────

export async function toggleSubtaskDone(subtaskId: string, done: boolean): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  const newStatus: TaskStatus = done ? 'done' : 'open'
  const completedAt = done ? new Date().toISOString() : null

  const { data, error } = await supabase.from('tasks').update({
    status: newStatus,
    completed_at: completedAt,
    updated_at: new Date().toISOString(),
  }).eq('id', subtaskId).select('id').maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Task not found, or you do not have permission to edit it.' }

  revalidatePath('/tasks')
  return {}
}

// ── Custom field management ───────────────────────────────────────────────────
// Deliberately uses the RLS-respecting client, not the admin client — the RLS
// policies on these two tables (migration 013) already implement the intended
// authorization exactly (team members read; manager/admin/creator write field
// definitions; a task's creator/assignee/manager/admin write its field values),
// so there is no legitimate reason to bypass them here.

function isAgentOrAboveRole(role: string): boolean {
  return role === 'agent' || role === 'manager' || role === 'admin' || role === 'platform_owner'
}

export async function createCustomField(data: {
  teamId: string
  name: string
  fieldType: import('@/types').CustomFieldType
  options?: import('@/types').CustomFieldOption[]
}): Promise<{ data?: { id: string }; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!isAgentOrAboveRole(profile.role)) {
    return { error: 'You do not have permission to manage custom fields.' }
  }

  const supabase = await createClient()

  const { count } = await supabase
    .from('task_custom_fields')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', data.teamId)

  const { data: field, error } = await supabase
    .from('task_custom_fields')
    .insert({
      team_id: data.teamId,
      name: data.name.trim(),
      field_type: data.fieldType,
      options: data.options?.length ? data.options : null,
      position: count ?? 0,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !field) return { error: error?.message ?? 'Failed to create field.' }
  revalidatePath('/tasks')
  return { data: { id: field.id } }
}

export async function updateCustomField(fieldId: string, data: {
  name?: string
  options?: import('@/types').CustomFieldOption[]
}): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!isAgentOrAboveRole(profile.role)) {
    return { error: 'You do not have permission to manage custom fields.' }
  }

  const supabase = await createClient()
  const update: Database['public']['Tables']['task_custom_fields']['Update'] = {}
  if (data.name !== undefined) update.name = data.name.trim()
  if (data.options !== undefined) update.options = data.options

  const { error } = await supabase.from('task_custom_fields').update(update).eq('id', fieldId)
  if (error) return { error: error.message }
  revalidatePath('/tasks')
  return {}
}

export async function deleteCustomField(fieldId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!isAgentOrAboveRole(profile.role)) {
    return { error: 'You do not have permission to manage custom fields.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('task_custom_fields').delete().eq('id', fieldId)
  if (error) return { error: error.message }
  revalidatePath('/tasks')
  return {}
}

export async function setCustomFieldValue(
  taskId: string,
  fieldId: string,
  value: import('@/types').CustomFieldValue['value'],
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('task_custom_field_values')
    .upsert(
      { task_id: taskId, field_id: fieldId, value, updated_at: new Date().toISOString() },
      { onConflict: 'task_id,field_id' }
    )
  if (error) return { error: error.message }
  return {}
}

// ── Delete task ───────────────────────────────────────────────────────────────

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  // Only creator or manager/admin can delete
  const { data: task } = await supabase
    .from('tasks')
    .select('created_by')
    .eq('id', taskId)
    .single()

  if (!task) return { error: 'Task not found.' }

  const canDelete =
    task.created_by === profile.id ||
    profile.role === 'manager' ||
    profile.role === 'admin'

  if (!canDelete) return { error: 'You do not have permission to delete this task.' }

  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) return { error: error.message }

  revalidatePath('/tasks')
  return {}
}
