'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logActivity } from '@/lib/activity'
import { notify, getRequestAudience, parseMentions } from '@/lib/notifications'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import { getEnabledModules } from '@/lib/queries/profiles'
import { validateFieldValue } from '@/lib/validation/formFields'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveFormSections } from '@/lib/forms/sections'
import type { FormField, FormSection, SLAConfig, RequestPriority, RequestStatus } from '@/types'
import type { Database, Json } from '@/types/database'

type RequestUpdate = Database['public']['Tables']['requests']['Update']

// ── Helpers ───────────────────────────────────────────────────────────────────

type ActionResult = { error?: string }

// ── Create request ────────────────────────────────────────────────────────────

type CreateRequestResult =
  | { requestId: string; error?: never }
  | { error: string; requestId?: never }

export async function createRequest(formData: FormData): Promise<CreateRequestResult> {
  const supabase = await createClient()
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to submit a request.' }

  const enabledModules = await getEnabledModules()
  if (!enabledModules.includes('requests')) return { error: 'The Requests module is not enabled for your organisation.' }

  const serviceId = formData.get('service_id') as string | null
  if (!serviceId) return { error: 'Service is required.' }

  const projectId = (formData.get('project_id') as string | null) || null

  const rawFormData = formData.get('form_data') as string | null
  let parsedFormData: Record<string, unknown> = {}
  if (rawFormData) {
    try {
      parsedFormData = JSON.parse(rawFormData) as Record<string, unknown>
    } catch {
      return { error: 'Invalid form data.' }
    }
  }

  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('*, team:teams (*)')
    .eq('id', serviceId)
    .eq('is_active', true)
    .single()

  if (serviceError || !service) return { error: 'Service not found.' }

  // ── Resolve mode: sections vs legacy flat ──────────────────────────────────
  const hasSections =
    Array.isArray(service.form_sections) && service.form_sections.length > 0

  const sections = hasSections
    ? (service.form_sections as unknown as FormSection[])
    : null

  const legacyFields = Array.isArray(service.form_fields)
    ? (service.form_fields as unknown as FormField[])
    : []

  // All fields in submission order (for validation and title extraction)
  const allFields: FormField[] = sections
    ? [...sections]
        .sort((a, b) => a.order - b.order)
        .flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))
    : legacyFields

  // ── Server-side validation ─────────────────────────────────────────────────
  // Source of truth — the client's DynamicForm runs the same check for instant
  // feedback, but this is what actually gates the insert below.
  //
  // `file`-type fields are skipped here: request_attachments.request_id is a
  // NOT NULL FK, so file values can only be uploaded *after* this request row
  // exists — DynamicForm never puts them in form_data at all, uploading them
  // in a follow-up step once it has a real requestId. Required-ness for file
  // fields is therefore enforced client-side only (DynamicForm's validate()).
  for (const field of allFields) {
    if (field.type === 'file') continue
    const err = validateFieldValue(field, parsedFormData[field.id])
    if (err) return { error: err }
  }

  // ── Request title ──────────────────────────────────────────────────────────
  // Priority: text → textarea → select value → radio value → multiselect (joined) → service name
  const titleField =
    allFields.find((f) => f.type === 'text') ??
    allFields.find((f) => f.type === 'textarea') ??
    allFields.find((f) => (f.type === 'select' || f.type === 'radio') && parsedFormData[f.id]) ??
    allFields.find((f) => f.type === 'multiselect' && Array.isArray(parsedFormData[f.id]) && (parsedFormData[f.id] as string[]).length > 0)

  let titleValue: string | undefined
  if (titleField) {
    if (titleField.type === 'multiselect') {
      const vals = parsedFormData[titleField.id] as string[]
      // Resolve option labels for human-readable title
      const labels = vals.map((v) => titleField.options?.find((o) => o.value === v)?.label ?? v)
      titleValue = labels.join(', ')
    } else if (titleField.type === 'select' || titleField.type === 'radio') {
      const raw = String(parsedFormData[titleField.id] ?? '')
      titleValue = titleField.options?.find((o) => o.value === raw)?.label ?? raw
    } else {
      titleValue = String(parsedFormData[titleField.id] ?? '').trim()
    }
  }

  const title = titleValue ? `${service.name}: ${titleValue}` : service.name

  const priority = service.default_priority as RequestPriority
  const now = new Date()
  const { data: requesterProfile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single()
  const orgId = requesterProfile?.org_id

  // SLA resolution, most specific layer wins field-by-field:
  //   1. field_sla_overrides — a specific dropdown/radio value selected on this
  //      submission (e.g. "Screen Repair" under Laptop Repair), configured via the
  //      Field SLA Matrix (Request Configuration → Field SLA Matrix).
  //   2. services.sla_config — the service's own per-priority overrides, set via the
  //      "SLA Overrides" section on the service form.
  // No org-wide default beneath that (the old "SLA Targets" screen was removed) — a
  // service/field with no explicit override gets no SLA deadline. Both deadlines are
  // business-hours-aware (skip nights/weekends/holidays) from the moment they're first
  // computed, so there's no separate flat estimate + later recompute step.
  const { responseDueAt, resolutionDueAt } = await resolveSlaDeadlines(supabase, {
    serviceId,
    priority,
    serviceSlaConfig: service.sla_config as unknown as SLAConfig | null,
    allFields,
    formData: parsedFormData,
    from: now,
  })

  const { data: request, error: insertError } = await supabase
    .from('requests')
    .insert({
      request_no: '',
      service_id: serviceId,
      team_id: service.team_id,
      requester_id: user.id,
      org_id: orgId,
      title,
      priority,
      form_data: parsedFormData as Json,
      // Legacy flat snapshot (always present for backward compat)
      form_schema_snapshot: service.form_fields as Json,
      // Section snapshot (empty array for legacy services)
      form_sections_snapshot: (service.form_sections ?? []) as Json,
      response_due_at: responseDueAt,
      resolution_due_at: resolutionDueAt,
      project_id: projectId,
    })
    .select('id, request_no')
    .single()

  if (insertError || !request) {
    return { error: insertError?.message ?? 'Failed to create request.' }
  }

  // Auto-assign via routing rules
  try {
    const { resolveAssignee } = await import('@/lib/routing/assign')
    const resolvedUserId = await resolveAssignee({
      serviceId,
      categoryId: service.category_id ?? null,
      subCategoryId: service.sub_category_id ?? null,
      priority: priority ?? null,
    })
    if (resolvedUserId) {
      await admin
        .from('requests')
        .update({ assigned_to: resolvedUserId })
        .eq('id', request.id)
      await admin.from('request_activity').insert({
        request_id: request.id,
        actor_id:   resolvedUserId,
        action:     'assigned',
        metadata:   { assigned_to: resolvedUserId, via: 'routing_rule' },
      })
      if (resolvedUserId) {
        notify([{
          recipientId: resolvedUserId,
          actorId: resolvedUserId,
          type: 'request_assigned',
          title: 'Request assigned to you',
          body: title,
          requestId: request.id,
          link: '/requests/' + request.id,
        }]).catch(() => {})
      }
    }
  } catch (e) {
    console.error('[createRequest] Auto-assign failed', e)
  }

  // Activity log — creation must be recorded; surface failure to caller
  const activityResult = await logActivity({
    requestId: request.id,
    actorId: user.id,
    action: 'created',
  })
  if (activityResult.error) {
    // Request was created; log the failure but do not roll back
    console.error('[createRequest] Activity log failed for request', request.id)
  }

  // Notify team members about the new request
  {
    const { data: teamMembers } = await admin
      .from('team_members')
      .select('user_id')
      .eq('team_id', service.team_id)
    for (const member of teamMembers ?? []) {
      if (member.user_id !== user.id) {
        notify({
          recipientId: member.user_id,
          actorId: user.id,
          type: 'request_created',
          title: `New request: ${title}`,
          body: 'A new request has been submitted that needs attention.',
          requestId: request.id,
          link: `/requests/${request.id}`,
        }).catch(() => {})
      }
    }
  }

  // Approvals are initiated manually by the solver via "Send for Approval" — not auto-created here.

  revalidatePath('/requests')
  revalidatePath('/home')

  return { requestId: request.id }
}

// ── Update request status ─────────────────────────────────────────────────────

export async function updateRequestStatus(
  requestId: string,
  newStatus: RequestStatus,
  comment?: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, status, priority, requester_id, team_id, assigned_to, responded_at, waiting_since, response_due_at, resolution_due_at')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.some((m) => m.team_id === request.team_id)
  const isRequester = request.requester_id === profile.id

  const currentStatus = request.status as RequestStatus
  const allowedForAgent = AGENT_TRANSITIONS[currentStatus] ?? []
  const allowedForRequester = REQUESTER_TRANSITIONS[currentStatus] ?? []

  const canTransition =
    (isAgent && allowedForAgent.includes(newStatus)) ||
    (isRequester && allowedForRequester.includes(newStatus))

  if (!canTransition) {
    return { error: `Transition to "${newStatus}" is not permitted.` }
  }

  const now = new Date()
  const nowIso = now.toISOString()

  // Build the status update payload
  const updatePayload: RequestUpdate = {
    status: newStatus,
    resolved_at: newStatus === 'resolved' ? nowIso : newStatus === 'open' ? null : undefined,
    closed_at:   newStatus === 'closed'   ? nowIso : newStatus === 'open' ? null : undefined,
  }

  // SLA pause: entering waiting_user
  if (newStatus === 'waiting_user') {
    updatePayload.waiting_since = nowIso
  }

  // SLA resume: leaving waiting_user → extend deadlines by paused duration
  if (currentStatus === 'waiting_user' && request.waiting_since) {
    const pausedMs = now.getTime() - new Date(request.waiting_since).getTime()
    if (request.response_due_at) {
      updatePayload.response_due_at = new Date(
        new Date(request.response_due_at).getTime() + pausedMs
      ).toISOString()
    }
    if (request.resolution_due_at) {
      updatePayload.resolution_due_at = new Date(
        new Date(request.resolution_due_at).getTime() + pausedMs
      ).toISOString()
    }
    updatePayload.waiting_since = null
  }

  // responded_at: first agent action that moves the request to an active state
  if (isAgent && !request.responded_at && (newStatus === 'in_progress' || newStatus === 'assigned')) {
    updatePayload.responded_at = nowIso
  }

  const { error: updateError } = await supabase
    .from('requests')
    .update(updatePayload)
    .eq('id', requestId)

  if (updateError) return { error: updateError.message }

  // CSAT: create survey record when request is resolved (requester can rate later)
  // Uses the admin client because csat_surveys' INSERT policy only allows
  // admin/platform_owner directly; this write must succeed regardless of who
  // resolved the request. Upsert-ignore dedupes against the UNIQUE(request_id)
  // constraint so reopen→resolve cycles don't error on a pre-existing survey row.
  if (newStatus === 'resolved' && request.requester_id && profile.org_id) {
    try {
      const admin = createAdminClient()
      const { error: csatError } = await admin
        .from('csat_surveys')
        .upsert(
          {
            org_id: profile.org_id,
            request_id: requestId,
            requester_id: request.requester_id,
            sent_at: nowIso,
          },
          { onConflict: 'request_id', ignoreDuplicates: true }
        )
      if (csatError) console.error('[updateRequestStatus] CSAT survey creation failed', csatError)
    } catch (e) {
      console.error('[updateRequestStatus] CSAT survey creation failed', e)
    }
  }

  // REOPEN: recalculate resolution_due_at from current time and clear resolution timestamps.
  // Uses the same field-override > service-override resolution as request creation — a
  // reopened ticket should still get the SLA its selected field values/service imply, not
  // just whatever the (removed) org-wide default used to say.
  if (newStatus === 'open' && (currentStatus === 'resolved' || currentStatus === 'closed')) {
    try {
      const priority = request.priority as RequestPriority
      const { data: full } = await supabase
        .from('requests')
        .select('service_id, form_data, service:services(sla_config, form_sections, form_fields)')
        .eq('id', requestId)
        .single()

      let resolutionDueAt: string | null = null
      if (full) {
        const svc = full.service as unknown as {
          sla_config?: SLAConfig
          form_sections?: FormSection[]
          form_fields?: FormField[]
        }
        const allFields = resolveFormSections(svc).flatMap((s) => s.fields)
        const resolved = await resolveSlaDeadlines(supabase, {
          serviceId: full.service_id,
          priority,
          serviceSlaConfig: svc.sla_config ?? null,
          allFields,
          formData: (full.form_data ?? {}) as Record<string, unknown>,
          from: new Date(),
        })
        resolutionDueAt = resolved.resolutionDueAt
      }

      if (resolutionDueAt) {
        await supabase
          .from('requests')
          .update({
            resolution_due_at: resolutionDueAt,
            resolved_at: null,
            closed_at: null,
            waiting_since: null,
          })
          .eq('id', requestId)
      } else {
        // No applicable SLA config found — still clear the timestamps
        await supabase
          .from('requests')
          .update({ resolved_at: null, closed_at: null, waiting_since: null })
          .eq('id', requestId)
      }
    } catch (e) {
      console.error('[updateRequestStatus] REOPEN SLA recalculation failed', e)
    }
  }

  // Activity log — status change must be recorded
  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'status_changed',
    metadata: { from: currentStatus, to: newStatus },
  })
  if (activityResult.error) {
    return { error: activityResult.error }
  }

  // Notify requester on meaningful status changes (not self-transitions)
  if (request.requester_id !== profile.id) {
    const notifyStatuses: Record<string, { type: import('@/lib/notifications').NotifyInput['type']; title: string; body: string }> = {
      in_progress:  { type: 'status_changed',    title: 'Your request is in progress',       body: `${profile.full_name} is working on it.` },
      waiting_user: { type: 'status_changed',    title: 'Action required on your request',   body: `${profile.full_name} is waiting for your response.` },
      resolved:     { type: 'request_resolved',  title: 'Your request has been resolved',    body: `${profile.full_name} marked it resolved.` },
      closed:       { type: 'request_closed',    title: 'Your request has been closed',      body: `Request ${request.id} is now closed.` },
      cancelled:    { type: 'request_cancelled', title: 'Your request has been cancelled',   body: `${profile.full_name} cancelled the request.` },
      open:         { type: 'request_reopened',  title: 'Your request has been reopened',    body: `${profile.full_name} reopened the request.` },
    }
    const notifyConfig = notifyStatuses[newStatus]
    if (notifyConfig) {
      notify({
        recipientId: request.requester_id,
        actorId: profile.id,
        ...notifyConfig,
        requestId,
        link: `/requests/${requestId}`,
      }).catch(() => {})
    }
  }

  // Notify assignee when request is reopened (open status)
  if (newStatus === 'open' && request.assigned_to && request.assigned_to !== profile.id) {
    notify({
      recipientId: request.assigned_to,
      actorId: profile.id,
      type: 'request_reopened',
      title: 'Request reopened',
      body: `A request has been reopened: ${requestId}`,
      requestId,
      link: `/requests/${requestId}`,
    }).catch(() => {})
  }

  // Optional comment attached to the transition (always public)
  if (comment?.trim()) {
    const { error: commentError } = await supabase.from('request_comments').insert({
      request_id: requestId,
      author_id: profile.id,
      body: comment.trim(),
      is_internal: false,
    })
    if (commentError) {
      console.error('[updateRequestStatus] Comment insert failed', commentError.message)
      // Status was updated and logged — do not roll back for a failed comment
    }
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/home')

  return {}
}

// ── Assign request ────────────────────────────────────────────────────────────

export async function assignRequest(
  requestId: string,
  assigneeId: string | null
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrManager =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.length > 0

  if (!isAgentOrManager) return { error: 'Not authorized to assign requests.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, status, assigned_to, team_id')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  // Verify caller is on the request's team (defence-in-depth; RLS also enforces)
  const isOnTeam =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.some((m) => m.team_id === request.team_id)

  if (!isOnTeam) return { error: 'Not authorized to assign requests for this team.' }

  const newStatus: RequestStatus =
    request.status === 'open' && assigneeId ? 'assigned' : (request.status as RequestStatus)

  const { error: updateError } = await supabase
    .from('requests')
    .update({ assigned_to: assigneeId, status: newStatus })
    .eq('id', requestId)

  if (updateError) return { error: updateError.message }

  const action = assigneeId ? 'assigned' : 'unassigned'
  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action,
    metadata: assigneeId ? { assigned_to: assigneeId } : {},
  })
  if (activityResult.error) {
    return { error: activityResult.error }
  }

  // Notify new assignee (skip if self-assigning)
  if (assigneeId && assigneeId !== profile.id) {
    const wasAssigned = request.assigned_to !== null
    notify({
      recipientId: assigneeId,
      actorId: profile.id,
      type: wasAssigned ? 'request_reassigned' : 'request_assigned',
      title: wasAssigned ? 'Request reassigned to you' : 'Request assigned to you',
      body: `by ${profile.full_name}`,
      requestId,
      link: `/requests/${requestId}`,
    }).catch(() => {})
  }

  // Notify previous assignee when reassigned to someone else
  if (request.assigned_to && request.assigned_to !== assigneeId && request.assigned_to !== profile.id) {
    notify({
      recipientId: request.assigned_to,
      actorId: profile.id,
      type: 'request_unassigned',
      title: 'You were unassigned from a request',
      body: assigneeId
        ? `${profile.full_name} reassigned the request to someone else.`
        : `${profile.full_name} unassigned the request.`,
      requestId,
      link: `/requests/${requestId}`,
    }).catch(() => {})
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/home')

  return {}
}

// ── Bulk assign ───────────────────────────────────────────────────────────────

export type BulkResult = { succeeded: string[]; failed: { id: string; error: string }[] }

export async function bulkAssignRequests(
  requestIds: string[],
  assigneeId: string | null
): Promise<BulkResult> {
  const settled = await Promise.all(
    requestIds.map(async (id) => ({ id, r: await assignRequest(id, assigneeId) }))
  )
  const result: BulkResult = { succeeded: [], failed: [] }
  for (const { id, r } of settled) {
    if (r.error) result.failed.push({ id, error: r.error })
    else result.succeeded.push(id)
  }
  return result
}

// ── Bulk status update ────────────────────────────────────────────────────────

export async function bulkUpdateStatus(
  requestIds: string[],
  newStatus: RequestStatus
): Promise<BulkResult> {
  const settled = await Promise.all(
    requestIds.map(async (id) => ({ id, r: await updateRequestStatus(id, newStatus) }))
  )
  const result: BulkResult = { succeeded: [], failed: [] }
  for (const { id, r } of settled) {
    if (r.error) result.failed.push({ id, error: r.error })
    else result.succeeded.push(id)
  }
  return result
}

// ── Bulk priority change ──────────────────────────────────────────────────────

export async function bulkChangePriority(
  requestIds: string[],
  newPriority: RequestPriority
): Promise<BulkResult> {
  const settled = await Promise.all(
    requestIds.map(async (id) => ({ id, r: await changePriority(id, newPriority) }))
  )
  const result: BulkResult = { succeeded: [], failed: [] }
  for (const { id, r } of settled) {
    if (r.error) result.failed.push({ id, error: r.error })
    else result.succeeded.push(id)
  }
  return result
}

// ── Collaborators ─────────────────────────────────────────────────────────────

/**
 * Typeahead search of active users in the caller's org, for the collaborator picker.
 * RLS on `profiles` scopes results to the caller's org, so this is org-wide but
 * tenant-safe. Returns at most 10 matches.
 */
export async function searchOrgMembers(
  query: string
): Promise<{ id: string; full_name: string }[]> {
  const profile = await getCurrentProfile()
  if (!profile) return []
  const safe = query.replace(/[%_]/g, '\\$&').trim()
  if (!safe) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .ilike('full_name', `%${safe}%`)
    .order('full_name')
    .limit(10)
  return (data ?? []) as { id: string; full_name: string }[]
}

export async function addCollaborator(
  requestId: string,
  userId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrManager =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.length > 0

  if (!isAgentOrManager) return { error: 'Not authorized to add collaborators.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, team_id, assigned_to')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isOnTeam =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.some((m) => m.team_id === request.team_id)

  if (!isOnTeam) return { error: 'Not authorized to add collaborators for this team.' }

  if (request.assigned_to === userId) {
    return { error: 'Assignee is already the primary owner.' }
  }

  // Fetch collaborator (RLS-scoped to the caller's org — also validates the target is a
  // user in the same org, since a cross-org id returns no visible profile).
  const { data: collaboratorProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single()

  if (!collaboratorProfile) return { error: 'User not found in your organization.' }

  const { error: insertError } = await supabase
    .from('request_collaborators')
    .insert({ request_id: requestId, user_id: userId, added_by: profile.id })

  if (insertError) {
    if (insertError.code === '23505') return { error: 'Already a collaborator.' }
    return { error: insertError.message }
  }

  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'collaborator_added',
    metadata: {
      collaborator_id: userId,
      collaborator_name: collaboratorProfile?.full_name ?? userId,
    },
  })

  // Notify the added collaborator
  if (userId !== profile.id) {
    notify({
      recipientId: userId,
      actorId: profile.id,
      type: 'collaborator_added',
      title: 'You were added as a collaborator',
      body: `${profile.full_name} added you to a request.`,
      requestId,
      link: `/requests/${requestId}`,
    }).catch(() => {})
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')

  return {}
}

// ── Remove collaborator ───────────────────────────────────────────────────────

export async function removeCollaborator(
  requestId: string,
  collaboratorRecordId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { data: record } = await supabase
    .from('request_collaborators')
    .select('id, user_id, added_by, request_id')
    .eq('id', collaboratorRecordId)
    .eq('request_id', requestId)
    .single()

  if (!record) return { error: 'Collaborator record not found.' }

  const canRemove =
    record.added_by === profile.id ||
    profile.role === 'manager' ||
    profile.role === 'admin'

  if (!canRemove) return { error: 'Not authorized to remove this collaborator.' }

  const { data: collaboratorProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', record.user_id)
    .single()

  const { error: deleteError } = await supabase
    .from('request_collaborators')
    .delete()
    .eq('id', collaboratorRecordId)

  if (deleteError) return { error: deleteError.message }

  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'collaborator_removed',
    metadata: {
      collaborator_id: record.user_id,
      collaborator_name: collaboratorProfile?.full_name ?? record.user_id,
    },
  })

  // Notify the removed collaborator
  if (record.user_id !== profile.id) {
    notify({
      recipientId: record.user_id,
      actorId: profile.id,
      type: 'collaborator_removed',
      title: 'You were removed as a collaborator',
      body: `${profile.full_name} removed you from a request.`,
      requestId,
      link: `/requests/${requestId}`,
    }).catch(() => {})
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')

  return {}
}

// ── Add comment ───────────────────────────────────────────────────────────────

export async function addComment(
  requestId: string,
  body: string,
  isInternal: boolean,
  hasAttachments = false
): Promise<ActionResult & { commentId?: string }> {
  const trimmed = body.trim()
  if (!trimmed && !hasAttachments) return { error: 'Comment cannot be empty.' }

  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, status, requester_id, team_id, responded_at, waiting_since, response_due_at, resolution_due_at')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.some((m) => m.team_id === request.team_id)

  // Only agents/managers may post internal notes
  const internal = isInternal && isAgent

  // First public agent comment on this request → record responded_at
  if (isAgent && !internal && !request.responded_at) {
    await supabase
      .from('requests')
      .update({ responded_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('responded_at', null)
  }

  const { data: insertedComment, error: insertError } = await supabase
    .from('request_comments')
    .insert({
      request_id: requestId,
      author_id: profile.id,
      body: trimmed,
      is_internal: internal,
    })
    .select('id')
    .single()

  if (insertError || !insertedComment) return { error: insertError?.message ?? 'Failed to post comment.' }

  const commentActivity = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'comment_added',
  })
  if (commentActivity.error) {
    return { error: commentActivity.error }
  }

  // Notify request audience about the new comment/note
  {
    const audience = await getRequestAudience(requestId)
    const notifyIds = internal
      // Internal note: only assignee + collaborators (not requester)
      ? [audience.assigneeId, ...audience.collaboratorIds]
      // Public comment: requester + assignee + collaborators
      : [audience.requesterId, audience.assigneeId, ...audience.collaboratorIds]

    const recipients = [...new Set(notifyIds.filter((id): id is string => id !== null && id !== profile.id))]
    const notifBody = trimmed ? (trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed) : '📎 Sent an attachment'

    if (recipients.length > 0) {
      notify(
        recipients.map((recipientId) => ({
          recipientId,
          actorId: profile.id,
          type: internal ? 'internal_note_added' : 'comment_added',
          title: internal
            ? `${profile.full_name} posted an internal note`
            : `${profile.full_name} commented on a request`,
          body: notifBody,
          requestId,
          link: `/requests/${requestId}?tab=conversations`,
        }))
      ).catch(() => {})
    }

    // @mention notifications — query only profiles matching mentioned first names
    // (RLS scopes to current org; no admin client needed)
    const mentionedNames = parseMentions(trimmed)
    if (mentionedNames.length > 0) {
      const mentionResults = await Promise.all(
        mentionedNames.map((n) =>
          supabase
            .from('profiles')
            .select('id, full_name')
            .eq('is_active', true)
            .ilike('full_name', `${n}%`)
            .neq('id', profile.id)
            .limit(3)
        )
      )
      const candidates = mentionResults.flatMap((r) => r.data ?? [])
      for (const firstName of mentionedNames) {
        const matched = candidates.find(
          (p) => p.full_name.toLowerCase().split(' ')[0] === firstName
        )
        if (matched) {
          notify({
            recipientId: matched.id,
            actorId: profile.id,
            type: 'mentioned',
            title: `${profile.full_name} mentioned you`,
            body: trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed,
            requestId,
            link: `/requests/${requestId}?tab=conversations`,
          }).catch(() => {})
        }
      }
    }
  }

  // Waiting-user auto-transition: requester's non-internal reply → in_progress
  // Uses admin client because the requester's RLS does not allow updating request status
  if (
    request.requester_id === profile.id &&
    request.status === 'waiting_user' &&
    !internal
  ) {
    const admin = createAdminClient()
    const now = new Date()
    const autoUpdatePayload: RequestUpdate = {
      status: 'in_progress',
      waiting_since: null,
    }

    // Extend SLA deadlines for time spent waiting
    if (request.waiting_since) {
      const pausedMs = now.getTime() - new Date(request.waiting_since).getTime()
      if (request.response_due_at) {
        autoUpdatePayload.response_due_at = new Date(
          new Date(request.response_due_at).getTime() + pausedMs
        ).toISOString()
      }
      if (request.resolution_due_at) {
        autoUpdatePayload.resolution_due_at = new Date(
          new Date(request.resolution_due_at).getTime() + pausedMs
        ).toISOString()
      }
    }

    const { error: transitionError } = await admin
      .from('requests')
      .update(autoUpdatePayload)
      .eq('id', requestId)
      .eq('requester_id', profile.id)

    if (transitionError) {
      console.error('[addComment] Auto-transition failed', transitionError.message)
    } else {
      const transitionActivity = await logActivity({
        requestId,
        actorId: profile.id,
        action: 'status_changed',
        metadata: { from: 'waiting_user', to: 'in_progress' },
      })
      if (transitionActivity.error) {
        console.error('[addComment] Auto-transition activity log failed', transitionActivity.error)
      }
    }
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/home')

  return { commentId: insertedComment.id }
}

// ── Change priority ───────────────────────────────────────────────────────────

export async function changePriority(
  requestId: string,
  newPriority: RequestPriority
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrManager =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.length > 0

  if (!isAgentOrManager) return { error: 'Not authorized to change priority.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, priority, team_id, status, created_at, waiting_since, assigned_to, service_id, form_data, service:services(sla_config, form_sections, form_fields)')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isOnTeam =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.some((m) => m.team_id === request.team_id)

  if (!isOnTeam) return { error: 'Not authorized to change priority for this team.' }

  const oldPriority = request.priority as RequestPriority
  if (oldPriority === newPriority) return {}

  // Recalculate SLA deadlines from created_at with the new priority tier — same
  // field-override > service-override resolution as request creation, so the request's
  // already-selected field values still drive the deadline under the new priority.
  const svc = request.service as unknown as {
    sla_config?: SLAConfig
    form_sections?: FormSection[]
    form_fields?: FormField[]
  }
  const allFields = resolveFormSections(svc).flatMap((s) => s.fields)
  const createdAt = new Date(request.created_at)

  let { responseDueAt: newResponseDue, resolutionDueAt: newResolutionDue } = await resolveSlaDeadlines(supabase, {
    serviceId: request.service_id,
    priority: newPriority,
    serviceSlaConfig: svc.sla_config ?? null,
    allFields,
    formData: (request.form_data ?? {}) as Record<string, unknown>,
    from: createdAt,
  })

  // Extend new deadlines by time already paused in waiting_user (if currently paused)
  if (request.waiting_since) {
    const alreadyPausedMs = Date.now() - new Date(request.waiting_since).getTime()
    if (newResponseDue) {
      newResponseDue = new Date(new Date(newResponseDue).getTime() + alreadyPausedMs).toISOString()
    }
    if (newResolutionDue) {
      newResolutionDue = new Date(new Date(newResolutionDue).getTime() + alreadyPausedMs).toISOString()
    }
  }

  const { error: updateError } = await supabase
    .from('requests')
    .update({
      priority: newPriority,
      response_due_at: newResponseDue,
      resolution_due_at: newResolutionDue,
    })
    .eq('id', requestId)

  if (updateError) return { error: updateError.message }

  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'priority_changed',
    metadata: { priority_from: oldPriority, priority_to: newPriority },
  })
  if (activityResult.error) {
    return { error: activityResult.error }
  }

  // Notify assignee about priority change (if not self-change)
  if (request.assigned_to && request.assigned_to !== profile.id) {
    notify({
      recipientId: request.assigned_to,
      actorId: profile.id,
      type: 'priority_changed',
      title: 'Request priority changed',
      body: `${profile.full_name} changed priority from ${oldPriority} to ${newPriority}.`,
      requestId,
      link: `/requests/${requestId}`,
    }).catch(() => {})
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/tasks')

  return {}
}

// ── Auto-close resolved requests ──────────────────────────────────────────────

export async function autoCloseRequests(): Promise<{ closed: number }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { closed: 0 }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'auto_close_days')
    .single()

  const autoCloseDays = parseInt(setting?.value ?? '7', 10)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - autoCloseDays)

  const { data: toClose } = await admin
    .from('requests')
    .select('id, requester_id, title')
    .eq('status', 'resolved')
    .lt('resolved_at', cutoff.toISOString())
    .limit(50)

  if (!toClose || toClose.length === 0) return { closed: 0 }

  const now = new Date().toISOString()
  let closed = 0

  for (const req of toClose) {
    const { error } = await admin
      .from('requests')
      .update({ status: 'closed', closed_at: now })
      .eq('id', req.id)

    if (!error) {
      closed++
      notify({
        recipientId: req.requester_id,
        actorId: req.requester_id, // system action — use requester as placeholder
        type: 'request_auto_closed',
        title: 'Your request was automatically closed',
        body: `Resolved requests are closed after ${autoCloseDays} days.`,
        requestId: req.id,
        link: `/requests/${req.id}`,
      }).catch(() => {})
    }
  }

  if (closed > 0) {
    revalidatePath('/requests')
    revalidatePath('/home')
    revalidatePath('/tasks')
  }

  return { closed }
}

// ── Duplicate Request ─────────────────────────────────────────────────────────

export async function duplicateRequest(requestId: string): Promise<{ id?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: src } = await supabase
    .from('requests')
    .select('title, description, service_id, team_id, priority, form_data, form_schema_snapshot')
    .eq('id', requestId)
    .single()

  if (!src) return { error: 'Request not found.' }

  const { data: newReq, error } = await admin
    .from('requests')
    .insert({
      request_no:           '', // overwritten by trg_requests_assign_no before insert
      title:                src.title + ' (copy)',
      description:          src.description,
      service_id:           src.service_id,
      team_id:              src.team_id,
      requester_id:         profile.id,
      priority:             src.priority,
      status:               'open',
      form_data:            src.form_data,
      form_schema_snapshot: src.form_schema_snapshot,
    })
    .select('id')
    .single()

  if (error || !newReq) return { error: error?.message ?? 'Failed to duplicate.' }

  await logActivity({ requestId: newReq.id, actorId: profile.id, action: 'created', metadata: { duplicated_from: requestId } }).catch(() => {})

  revalidatePath('/requests')
  return { id: newReq.id }
}

// ── Sub-requests ───────────────────────────────────────────────────────────────

export async function createSubRequest(
  parentRequestId: string,
  title: string,
  opts?: { priority?: RequestPriority; assignedTo?: string }
): Promise<{ id?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!title.trim()) return { error: 'Title is required.' }

  const isAgentOrAbove =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.length > 0
  if (!isAgentOrAbove) return { error: 'Only agents and managers can create sub-requests.' }

  const supabase = await createClient()

  const { data: parent } = await supabase
    .from('requests')
    .select('org_id, service_id, team_id, requester_id, priority, service:services(sla_config)')
    .eq('id', parentRequestId)
    .single()
  if (!parent) return { error: 'Parent request not found.' }

  const priority = opts?.priority ?? (parent.priority as RequestPriority)
  const now = new Date()
  // Sub-requests have no dynamic-form submission of their own to check field-level
  // overrides against — only the parent service's own SLA config applies.
  const slaConfig = (parent.service as unknown as { sla_config: SLAConfig } | null)?.sla_config
  const { responseDueAt, resolutionDueAt } = await resolveSlaDeadlines(supabase, {
    serviceId: parent.service_id,
    priority,
    serviceSlaConfig: slaConfig ?? null,
    from: now,
  })

  // Preserves the original requester on the sub-request (same person the parent
  // was raised for), which requests_insert's RLS (requester_id = auth.uid()) would
  // reject if the acting agent differs — so this goes through the admin client,
  // same as duplicateRequest.
  const admin = createAdminClient()
  const { data: newReq, error } = await admin
    .from('requests')
    .insert({
      request_no: '',
      title: title.trim(),
      parent_request_id: parentRequestId,
      service_id: parent.service_id,
      team_id: parent.team_id,
      org_id: parent.org_id,
      requester_id: parent.requester_id,
      assigned_to: opts?.assignedTo ?? null,
      priority,
      status: 'open',
      response_due_at: responseDueAt,
      resolution_due_at: resolutionDueAt,
    })
    .select('id, request_no, title, status, priority, resolution_due_at')
    .single()

  if (error || !newReq) return { error: error?.message ?? 'Failed to create sub-request.' }

  await logActivity({ requestId: newReq.id, actorId: profile.id, action: 'created', metadata: { parent_request_id: parentRequestId } }).catch(() => {})

  revalidatePath(`/requests/${parentRequestId}`)
  return { id: newReq.id }
}

// ── Submit for Approval ───────────────────────────────────────────────────────

export async function submitForApproval(requestId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: req } = await supabase
    .from('requests')
    .select('id, title, status, service_id, team_id, requester_id, services(approval_workflow_id)')
    .eq('id', requestId)
    .single()

  if (!req) return { error: 'Request not found.' }

  const onTeam = profile.team_members.some((m) => m.team_id === req.team_id)
  if (!['manager', 'admin'].includes(profile.role) && !onTeam && profile.id !== req.requester_id)
    return { error: 'Unauthorized.' }

  if (['resolved', 'closed', 'cancelled', 'pending_approval'].includes(req.status))
    return { error: 'Request cannot be submitted for approval in its current state.' }

  const workflowId = req.services?.approval_workflow_id ?? null

  // Check for an existing *pending* approval only — approvals.request_id has no
  // unique constraint (migration 031 deliberately allows multiple sequential
  // approval rounds per request), so an unfiltered check would permanently
  // block resubmission after a prior round was approved/rejected. Matches
  // sendAdHocApproval's check in lib/actions/approvals.ts.
  const { data: existing } = await admin
    .from('approvals')
    .select('id')
    .eq('request_id', requestId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) return { error: 'An approval is already in progress for this request.' }

  if (!workflowId) {
    // No workflow on service — look for any default workflow
    const { data: defaultWorkflow } = await supabase
      .from('approval_workflows')
      .select('id')
      .limit(1)
      .maybeSingle()
    if (!defaultWorkflow) return { error: 'No approval workflow is configured. Ask an admin to set one up.' }

    const { error: wfErr } = await admin
      .from('approvals')
      .insert({ request_id: requestId, workflow_id: defaultWorkflow.id, status: 'pending' })
    // 23505 = the approvals_one_pending_per_request unique index rejected a
    // second concurrent submission that slipped past the check above.
    if (wfErr) return { error: wfErr.code === '23505' ? 'An approval is already in progress for this request.' : wfErr.message }
  } else {
    const { error: wfErr } = await admin
      .from('approvals')
      .insert({ request_id: requestId, workflow_id: workflowId, status: 'pending' })
    if (wfErr) return { error: wfErr.code === '23505' ? 'An approval is already in progress for this request.' : wfErr.message }
  }

  const { error: stErr } = await admin
    .from('requests')
    .update({ status: 'pending_approval', updated_at: new Date().toISOString() })
    .eq('id', requestId)
  if (stErr) return { error: stErr.message }

  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'status_changed',
    metadata: { from: req.status, to: 'pending_approval' },
  }).catch(() => {})

  // Notify approvers that their review is needed
  {
    const admin = createAdminClient()
    const effectiveWorkflowId = workflowId ?? (() => {
      // workflowId may be null when a default workflow was used — re-query
      return null
    })()

    if (effectiveWorkflowId) {
      const { data: firstStep } = await admin
        .from('approval_workflow_steps')
        .select('approver_type, approver_user_id')
        .eq('workflow_id', effectiveWorkflowId)
        .order('step_order', { ascending: true })
        .limit(1)
        .single()

      if (firstStep?.approver_type === 'specific_user' && firstStep.approver_user_id && firstStep.approver_user_id !== profile.id) {
        notify({
          recipientId: firstStep.approver_user_id,
          actorId: profile.id,
          type: 'approval_requested',
          title: 'Approval required',
          body: `${req.title} has been submitted for your approval.`,
          requestId,
          link: `/requests/${requestId}?tab=approvals`,
        }).catch(() => {})
      } else if (firstStep?.approver_type === 'any_manager') {
        const { data: managers } = await admin
          .from('profiles')
          .select('id')
          .in('role', ['manager', 'admin'])
          .eq('is_active', true)
        for (const mgr of managers ?? []) {
          if (mgr.id !== profile.id) {
            notify({
              recipientId: mgr.id,
              actorId: profile.id,
              type: 'approval_requested',
              title: 'Approval required',
              body: `${req.title} has been submitted for your approval.`,
              requestId,
              link: `/requests/${requestId}?tab=approvals`,
            }).catch(() => {})
          }
        }
      }
    }
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/approvals')
  return {}
}

// ── Time entries ──────────────────────────────────────────────────────────────

export async function startTimer(requestId: string): Promise<{ id?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  // Stop any running timers for this user on this request first
  await supabase
    .from('request_time_entries')
    .update({ stopped_at: new Date().toISOString() })
    .eq('request_id', requestId)
    .eq('user_id', profile.id)
    .is('stopped_at', null)

  const { data, error } = await supabase
    .from('request_time_entries')
    .insert({ request_id: requestId, user_id: profile.id, started_at: new Date().toISOString() })
    .select('id, started_at')
    .single()

  if (error || !data) return { error: error?.message ?? 'Failed to start timer.' }
  return { id: data.id }
}

export async function stopTimer(entryId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('request_time_entries')
    .update({ stopped_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('user_id', profile.id)

  if (error) return { error: error.message }
  return {}
}

export async function getActiveTimer(requestId: string): Promise<{ id: string; started_at: string } | null> {
  const profile = await getCurrentProfile()
  if (!profile) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('request_time_entries')
    .select('id, started_at')
    .eq('request_id', requestId)
    .eq('user_id', profile.id)
    .is('stopped_at', null)
    .maybeSingle()

  return data ?? null
}

// ── Related Requests ──────────────────────────────────────────────────────────

export async function addRelatedRequest(
  requestId: string,
  query: string,
  linkType: string,
): Promise<{ error?: string; related?: unknown }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrAbove =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.length > 0
  if (!isAgentOrAbove) return { error: 'Only agents and managers can link requests.' }

  const supabase = await createClient()

  // Resolve the related request by request_no or partial title
  const safe = query.replace(/[%_]/g, '\\$&')
  const { data: found } = await supabase
    .from('requests')
    .select('id, request_no, title, status, priority')
    .or(`request_no.ilike.%${safe}%,title.ilike.%${safe}%`)
    .neq('id', requestId)
    .limit(1)
    .single()

  if (!found) return { error: 'No matching request found. Try using the request number (e.g. IT-000001).' }

  // Get org_id from the source request
  const { data: src } = await supabase
    .from('requests')
    .select('team:teams(org_id)')
    .eq('id', requestId)
    .single()

  const orgId = src?.team?.org_id
  if (!orgId) return { error: 'Could not determine org.' }

  const { data: link, error } = await supabase
    .from('related_requests')
    .insert({
      org_id: orgId,
      request_id: requestId,
      related_id: found.id,
      link_type: linkType,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'These requests are already linked.' }
    return { error: error.message }
  }

  revalidatePath(`/requests/${requestId}`)
  return {
    related: {
      id: found.id,
      link_id: link.id,
      link_type: linkType,
      created_by: profile.id,
      request_no: found.request_no,
      title: found.title,
      status: found.status,
      priority: found.priority,
    },
  }
}

export async function removeRelatedRequest(linkId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('related_requests')
    .delete()
    .eq('id', linkId)

  if (error) return { error: error.message }
  return {}
}

// ── CSAT ──────────────────────────────────────────────────────────────────────

export async function submitCsatRating(
  surveyId: string,
  rating: number,
  comment: string,
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  if (rating < 1 || rating > 5) return { error: 'Rating must be between 1 and 5.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('csat_surveys')
    .update({
      rating,
      comment: comment.trim() || null,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', surveyId)
    .eq('requester_id', profile.id)
    .is('submitted_at', null)

  if (error) return { error: error.message }
  return {}
}

// Update the "Source" of a request (stored in source_metadata.created_via).
// Merges into existing source_metadata so intake provenance fields are kept.
export async function updateRequestSource(requestId: string, source: string | null): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('requests')
    .select('source_metadata')
    .eq('id', requestId)
    .single()

  const meta = { ...((current as { source_metadata?: Record<string, unknown> | null } | null)?.source_metadata ?? {}) }
  if (source) meta.created_via = source
  else delete meta.created_via

  const { error } = await supabase
    .from('requests')
    .update({ source_metadata: meta as Json, updated_at: new Date().toISOString() } as RequestUpdate)
    .eq('id', requestId)
  if (error) return { error: error.message }

  revalidatePath('/requests')
  return {}
}
