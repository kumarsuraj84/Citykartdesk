'use server'

import { revalidatePath } from 'next/cache'
import { isVendor } from '@/lib/vendor/access'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logActivity } from '@/lib/activity'
import { notifyRequesterOfAssignment } from '@/lib/requests/notify-requester'
import { notify, getRequestAudience, parseMentions } from '@/lib/notifications'
import { applyStatusChange } from '@/lib/requests/status-change'
import { autoCloseDueRequests } from '@/lib/requests/auto-close'
import { notifyLowRating } from '@/lib/csat/alerts'
import { getEnabledModules } from '@/lib/queries/profiles'
import { validateFieldValue } from '@/lib/validation/formFields'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { requesterCanSet } from '@/lib/forms/sections'
import { toCSV } from '@/lib/export/csv'
import { mapWithConcurrency } from '@/lib/async/concurrency'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { logger } from '@/lib/observability/logger'
import type { FormField, FormSection, SLAConfig, RequestPriority, RequestStatus } from '@/types'
import type { Database, Json } from '@/types/database'
import { inBatches } from '@/lib/queries/in-batches'
import { exportAllowed, auditExportEvent, EXPORT_LIMIT_MESSAGE } from '@/lib/security/export-guard'
import { submissionKey, claimSubmission, releaseSubmission, findSubmittedTicket } from '@/lib/requests/submission-key'

type RequestUpdate = Database['public']['Tables']['requests']['Update']

// ── Helpers ───────────────────────────────────────────────────────────────────

type ActionResult = { error?: string }

/**
 * Applies accumulated pause credit — every completed waiting_user/
 * pending_approval pause this request has ever had (paused_ms_total), plus
 * one currently in progress, if any — on top of a freshly-recomputed due
 * date. Without this, recomputing a due date from created_at (priority
 * change, reclassify, category change) silently discards every pause that
 * had already completed before the change, not just the active one.
 */
function withPauseCredit(
  dueAtIso: string | null,
  pausedMsTotal: number | string | null | undefined,
  currentlyWaitingSince: string | null
): string | null {
  if (!dueAtIso) return null
  const creditMs =
    Number(pausedMsTotal ?? 0) +
    (currentlyWaitingSince ? Date.now() - new Date(currentlyWaitingSince).getTime() : 0)
  if (creditMs === 0) return dueAtIso
  return new Date(new Date(dueAtIso).getTime() + creditMs).toISOString()
}

// ── Create request ────────────────────────────────────────────────────────────
// The actual business logic (service/template resolution, mandatory-field
// validation, title/priority/SLA derivation, insert, Business Rules,
// activity, OEM auto-routing, notifications) lives in createRequestCore()
// (lib/requests/create-request-core.ts) — shared with Email Intake, and
// eventually WhatsApp, so every channel gets identical governed behavior.
// This function is the thin, web-specific adapter: authenticate the browser
// session, resolve "book on behalf of", parse the submitted FormData, then
// hand off to the core.

type CreateRequestResult =
  | { requestId: string; error?: never }
  | { error: string; requestId?: never }

export async function createRequest(formData: FormData): Promise<CreateRequestResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to submit a request.' }
  // an OEM engineer (vendor login) works tickets; he does not raise them
  if (isVendor(await getCurrentProfile())) return { error: 'A vendor login cannot raise requests.' }

  const enabledModules = await getEnabledModules()
  if (!enabledModules.includes('requests')) return { error: 'The Requests module is not enabled for your organisation.' }

  const serviceId = formData.get('service_id') as string | null
  if (!serviceId) return { error: 'Service is required.' }

  // "Book on behalf of" — an agent/manager can raise a request for someone else.
  // Ordinary requesters never see this field client-side, but re-check server-side
  // regardless: honor the override only for agents/managers, and only once the
  // target profile is confirmed to exist in the same org.
  let requesterId = user.id
  const actingProfile = await getCurrentProfile()
  const requesterOverride = (formData.get('requester_id') as string | null) || null
  if (requesterOverride && requesterOverride !== user.id) {
    const isAgentOrManager =
      !!actingProfile &&
      (actingProfile.role === 'agent' ||
        actingProfile.role === 'manager' ||
        actingProfile.role === 'admin' ||
        actingProfile.role === 'platform_owner')
    if (!isAgentOrManager) return { error: 'Not authorized to raise a request on behalf of another user.' }

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', requesterOverride)
      .eq('org_id', actingProfile.org_id ?? '')
      .eq('is_active', true)
      .single()
    if (!targetProfile) return { error: 'Selected requester not found in your organisation.' }

    requesterId = requesterOverride
  }

  const projectId = (formData.get('project_id') as string | null) || null
  const submittedSubCategoryId = (formData.get('sub_category_id') as string | null) || null

  const rawFormData = formData.get('form_data') as string | null
  let parsedFormData: Record<string, unknown> = {}
  if (rawFormData) {
    try {
      parsedFormData = JSON.parse(rawFormData) as Record<string, unknown>
    } catch {
      return { error: 'Invalid form data.' }
    }
  }

  // org_id for the insert — looked up by requesterId (not the acting user) so
  // a "book on behalf of" submission resolves to the actual requester's own
  // org (already validated to match the acting user's org above; for a
  // self-submission requesterId === user.id, so this is just the caller's
  // own org either way).
  const { data: requesterProfile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', requesterId)
    .single()
  const orgId = requesterProfile?.org_id
  if (!orgId) return { error: 'Requester profile not found.' }

  // Double-submit protection: the same person sending the same service with the same answers again within a few seconds (a double click, a retry after a slow
  // answer, a second tab) gets the first ticket back instead of a duplicate. Claimed atomically in the database, so simultaneous submissions make one ticket.
  const submissionId = submissionKey({ requesterId, serviceId, subCategoryId: submittedSubCategoryId, projectId, formData: parsedFormData })
  if (!(await claimSubmission(submissionId))) {
    const existing = await findSubmittedTicket(requesterId, submissionId)
    if (existing) return { requestId: existing }
    return { error: 'Your request is already being submitted. Please wait a moment and check My Requests.' }
  }

  const result = await createRequestCore({
    client: supabase,
    orgId,
    requesterId,
    actingUserId: user.id,
    serviceId,
    subCategoryId: submittedSubCategoryId,
    formData: parsedFormData,
    projectId,
    source: 'web',
    sourceMetadata: { submission_key: submissionId },
    // A ticket is always inserted by the server (VAPT VA-DB-02): the database gives a signed-in user no direct INSERT on requests, so the
    // service, form, priority and routing chosen here cannot be skipped by calling the data API. Who the requester is was checked above.
    useAdminForWrites: true,
    // Location-scoped visibility only applies to a plain Requester — see
    // createRequestCore()'s own doc comment. Agent-tier actors (including
    // one raising this "on behalf of" a Requester elsewhere) are exempt,
    // matching getServices()'s filterServicesByLocation().
    actingUserRoleForLocationCheck: actingProfile?.role ?? null,
    actingUserLocationId: actingProfile?.location_id ?? null,
  })

  if (result.error) { await releaseSubmission(submissionId); return { error: result.error } }
  if (!result.requestId) { await releaseSubmission(submissionId); return { error: 'Failed to create request.' } }
  const requestId = result.requestId

  revalidatePath('/requests')
  revalidatePath('/home')

  return { requestId }
}

// ── Update request status ─────────────────────────────────────────────────────

export async function updateRequestStatus(
  requestId: string,
  newStatus: RequestStatus,
  commentInput?: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  return applyStatusChange({ supabase, profile }, requestId, newStatus, commentInput)
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
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  if (!isAgentOrManager) return { error: 'Not authorized to assign requests.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, status, assigned_to, team_id')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isManager = ['manager', 'admin', 'platform_owner'].includes(profile.role)

  // Verify caller is on the request's team (defence-in-depth; RLS also enforces)
  const isOnTeam =
    isManager ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  if (!isOnTeam) return { error: 'Not authorized to assign requests for this technician group.' }

  // A plain technician (not a manager+) can only hand a ticket to a teammate
  // on the same team — never leave it unassigned, and never forward it to
  // another team's technician. Managers keep the unrestricted "forward to
  // anyone" picker for legitimate cross-team escalation.
  if (!isManager) {
    if (!assigneeId) {
      return { error: 'Technicians cannot unassign a ticket — assign it to a technician group member instead.' }
    }
    const { count } = await supabase
      .from('team_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('team_id', request.team_id)
      .eq('user_id', assigneeId)
    if (!count) {
      return { error: 'You can only assign this ticket to a member of the same technician group.' }
    }
  }

  // The new assignee must be an active member of staff of this organisation (VAPT VAPT-055): a manager could name anybody, even a plain requester
  // or a deactivated person, who then could not even open the ticket.
  if (assigneeId) {
    const { data: target } = await createAdminClient().from('profiles').select('id, role, is_active, org_id').eq('id', assigneeId).maybeSingle()
    if (!target || !target.is_active || target.org_id !== profile.org_id || !['agent', 'manager', 'admin', 'platform_owner'].includes(target.role as string)) {
      return { error: 'A ticket can only be assigned to an active technician or manager of this organisation.' }
    }
  }

  const newStatus: RequestStatus =
    request.status === 'open' && assigneeId ? 'assigned' : (request.status as RequestStatus)

  // Guard against two concurrent assignments racing (e.g. one tech "Pick
  // up"-ing while a manager reassigns to someone else in the same instant) —
  // without this, both calls report success but only the last write sticks,
  // silently leaving the loser believing they own a ticket they don't.
  // Written with the server's own key after the checks above: a signed-in user has no direct write right on tickets (migration 165).
  let updateQuery = createAdminClient()
    .from('requests')
    .update({ assigned_to: assigneeId, status: newStatus })
    .eq('id', requestId)
  updateQuery = request.assigned_to === null
    ? updateQuery.is('assigned_to', null)
    : updateQuery.eq('assigned_to', request.assigned_to)
  // ...and the status must still be the one we read (D-044): a ticket resolved, closed or put on hold in the same instant must not be
  // quietly moved to "assigned" by a stale read.
  updateQuery = updateQuery.eq('status', request.status)
  const { data: updatedRow, error: updateError } = await updateQuery.select('id').maybeSingle()

  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#assignRequest', fallback: 'Failed to assign request.' }) }
  if (!updatedRow) {
    return { error: 'This request was just changed by someone else — please refresh and try again.' }
  }

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

  // The requester hears who now owns their ticket
  if (assigneeId) {
    notifyRequesterOfAssignment({ requestId, assigneeId, actorId: profile.id, reassigned: request.assigned_to !== null }).catch(() => {})
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

// A bulk action can be run over hundreds of selected requests at once — each
// one fans out into several DB round trips (read, write, activity log,
// notify, business-rules trigger), so an unbounded Promise.all over the
// whole selection risked exhausting the DB connection pool. Bounded instead.
const BULK_ACTION_CONCURRENCY = 10

/** Most requests one bulk action accepts (D-050): the list comes from the browser, so its size and content are checked here. */
const MAX_BULK_REQUESTS = 500
const BULK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanBulkIds(ids: unknown): { ids: string[] } | { error: string } {
  if (!Array.isArray(ids)) return { error: 'No requests selected.' }
  const unique = [...new Set(ids.filter((v): v is string => typeof v === 'string' && BULK_ID.test(v)))]
  if (unique.length === 0) return { error: 'No requests selected.' }
  if (unique.length > MAX_BULK_REQUESTS) return { error: `Select at most ${MAX_BULK_REQUESTS} requests at once.` }
  return { ids: unique }
}
const bulkRefused = (error: string): BulkResult => ({ succeeded: [], failed: [{ id: '', error }] })

export async function bulkAssignRequests(
  requestIds: string[],
  assigneeId: string | null
): Promise<BulkResult> {
  const picked = cleanBulkIds(requestIds)
  if ('error' in picked) return bulkRefused(picked.error)
  const settled = await mapWithConcurrency(picked.ids, BULK_ACTION_CONCURRENCY, async (id) => ({ id, r: await assignRequest(id, assigneeId) }))
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
  const picked = cleanBulkIds(requestIds)
  if ('error' in picked) return bulkRefused(picked.error)
  const settled = await mapWithConcurrency(picked.ids, BULK_ACTION_CONCURRENCY, async (id) => ({ id, r: await updateRequestStatus(id, newStatus) }))
  const result: BulkResult = { succeeded: [], failed: [] }
  for (const { id, r } of settled) {
    if (r.error) result.failed.push({ id, error: r.error })
    else result.succeeded.push(id)
  }
  return result
}

// ── Bulk export (selected rows, RLS-scoped) ────────────────────────────────────
// Distinct from lib/actions/export.ts's exportRequests(), which is org-wide and
// gated to admin/manager/platform_owner. This one exports exactly the rows the
// caller selected in the table — rows they can already see, by definition — so
// it stays open to any authenticated user, enforced by RLS on the query itself
// rather than a role check.

export async function bulkExportRequests(requestIds: string[]): Promise<{ csv?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  const picked = cleanBulkIds(requestIds)
  if ('error' in picked) return { error: picked.error }
  if (!(await exportAllowed(profile.id, 'bulk_requests'))) return { error: EXPORT_LIMIT_MESSAGE }

  const supabase = await createClient()
  const { data, error } = await inBatches(picked.ids, (batch) => supabase
    .from('requests')
    .select(`
      request_no, title, status, priority, created_at, updated_at, resolution_due_at,
      service:services (name),
      category:service_categories (name),
      sub_category:service_sub_categories (name),
      team:teams (name),
      requester:profiles!requests_requester_id_fkey (full_name),
      assignee:profiles!requests_assigned_to_fkey (full_name)
    `)
    .in('id', batch))

  if (error) return { error: sanitizeError(error, { route: 'requests.ts#bulkExportRequests', fallback: 'Failed to export requests.' }) }

  type Row = {
    request_no: string; title: string; status: string; priority: string
    created_at: string; updated_at: string; resolution_due_at: string | null
    service: { name: string } | null
    category: { name: string } | null
    sub_category: { name: string } | null
    team: { name: string } | null
    requester: { full_name: string } | null
    assignee: { full_name: string } | null
  }

  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
    request_no: r.request_no,
    title: r.title,
    status: r.status,
    priority: r.priority,
    category: r.category?.name ?? '',
    sub_category: r.sub_category?.name ?? '',
    service: r.service?.name ?? '',
    team: r.team?.name ?? '',
    requester: r.requester?.full_name ?? '',
    assignee: r.assignee?.full_name ?? 'Unassigned',
    created_at: r.created_at,
    updated_at: r.updated_at,
    resolution_due_at: r.resolution_due_at ?? '',
  }))

  const csv = toCSV(rows, [
    { key: 'request_no', label: 'Request No' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'service', label: 'Service' },
    { key: 'team', label: 'Team' },
    { key: 'requester', label: 'Requester' },
    { key: 'assignee', label: 'Technician' },
    { key: 'created_at', label: 'Created' },
    { key: 'updated_at', label: 'Updated' },
    { key: 'resolution_due_at', label: 'Resolution Due' },
  ])

  await auditExportEvent(profile, 'bulk_requests', rows.length, { requested: picked.ids.length })
  return { csv }
}

// ── Bulk add collaborator ───────────────────────────────────────────────────────

export async function bulkAddCollaborators(requestIds: string[], userId: string): Promise<BulkResult> {
  const picked = cleanBulkIds(requestIds)
  if ('error' in picked) return bulkRefused(picked.error)
  const settled = await mapWithConcurrency(picked.ids, BULK_ACTION_CONCURRENCY, async (id) => ({ id, r: await addCollaborator(id, userId) }))
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

/** Same as searchOrgMembers but restricted to agent-tier roles — used by the
 *  Assignee picker's "forward to anyone" search, since only an agent/manager/
 *  admin/platform_owner can actually be assigned a request and act on it. */
export async function searchAgentTierMembers(
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
    .in('role', ['agent', 'manager', 'admin', 'platform_owner'])
    .ilike('full_name', `%${safe}%`)
    .order('full_name')
    .limit(10)
  return (data ?? []) as { id: string; full_name: string }[]
}

export async function addCollaborator(
  requestId: string,
  userId: string
): Promise<ActionResult & { id?: string }> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrManager =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

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
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  if (!isOnTeam) return { error: 'Not authorized to add collaborators for this technician group.' }

  if (request.assigned_to === userId) {
    return { error: 'Technician is already the primary owner.' }
  }

  // Fetch collaborator (RLS-scoped to the caller's org — also validates the target is a
  // user in the same org, since a cross-org id returns no visible profile).
  const { data: collaboratorProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single()

  if (!collaboratorProfile) return { error: 'User not found in your organization.' }

  const { data: inserted, error: insertError } = await supabase
    .from('request_collaborators')
    .insert({ request_id: requestId, user_id: userId, added_by: profile.id })
    .select('id')
    .single()

  if (insertError) {
    if (insertError.code === '23505') return { error: 'Already a collaborator.' }
    return { error: sanitizeError(insertError, { route: 'requests.ts#addCollaborator', fallback: 'Failed to add collaborator.' }) }
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

  return { id: inserted.id }
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
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

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

  if (deleteError) return { error: sanitizeError(deleteError, { route: 'requests.ts#removeCollaborator', fallback: 'Failed to remove collaborator.' }) }

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
    .select('id, status, requester_id, team_id, responded_at, waiting_since, response_due_at, resolution_due_at, paused_ms_total')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  // Only agents/managers may post internal notes
  const internal = isInternal && isAgent

  // First public agent comment on this request → record responded_at
  if (isAgent && !internal && !request.responded_at) {
    await createAdminClient()
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

  if (insertError || !insertedComment) return { error: sanitizeError(insertError, { route: 'requests.ts#addComment', fallback: 'Failed to post comment.' }) }

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

    let recipients = [...new Set(notifyIds.filter((id): id is string => id !== null && id !== profile.id))]
    // An internal note is staff-only: its text must not reach an ordinary user who is only a collaborator on the ticket (VAPT VA-INT-03).
    const staffIds = await staffAmong(supabase, recipients)
    if (internal) recipients = recipients.filter((id) => staffIds.has(id))
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
        // Only someone who may read the comment is told what it says: for an internal note that is staff, otherwise staff or a person on the ticket.
        const mentionedStaff = matched ? (await staffAmong(supabase, [matched.id])).has(matched.id) : false
        const mentionedOnTicket = matched ? [audience.requesterId, audience.assigneeId, ...audience.collaboratorIds].includes(matched.id) : false
        if (matched && (internal ? mentionedStaff : (mentionedStaff || mentionedOnTicket))) {
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
      autoUpdatePayload.paused_ms_total = Number(request.paused_ms_total ?? 0) + pausedMs
    }

    // Only while it is STILL waiting on the user (D-044): if the technician moved it on in the meantime (hold, resolved...), this must not
    // force it back to in progress or extend the deadlines a second time.
    const { data: resumed, error: transitionError } = await admin
      .from('requests')
      .update(autoUpdatePayload)
      .eq('id', requestId)
      .eq('requester_id', profile.id)
      .eq('status', 'waiting_user')
      .select('id')
      .maybeSingle()

    if (transitionError) {
      console.error('[addComment] Auto-transition failed', transitionError.message)
    } else if (resumed) {
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

// addComment inserts an empty-body comment as an attachment carrier when the
// user posts files with no text — if every attachment upload then fails, that
// leaves a permanent blank bubble with nothing to show for it. Called by
// CommentForm only in that exact case (empty body, zero successful uploads),
// scoped to the comment's own author so it can't be used to delete anyone
// else's comment.
export async function deleteEmptyComment(commentId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { data: comment } = await supabase
    .from('request_comments')
    .select('id, request_id, author_id, body')
    .eq('id', commentId)
    .single()

  if (!comment) return {}
  if (comment.author_id !== profile.id || comment.body.trim() !== '') return { error: 'Cannot remove this comment.' }

  const { count } = await supabase
    .from('request_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId)
  if (count && count > 0) return {}

  await supabase.from('request_comments').delete().eq('id', commentId)
  revalidatePath(`/requests/${comment.request_id}`)
  return {}
}

const STAFF_ROLES = ['agent', 'manager', 'admin', 'platform_owner']
/** Which of these people are staff (technician, manager, admin, platform owner)? Used to keep internal-note text away from ordinary users. */
async function staffAmong(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data } = await supabase.from('profiles').select('id, role').in('id', ids)
  return new Set((data ?? []).filter((p) => STAFF_ROLES.includes(p.role as string)).map((p) => p.id as string))
}

// ── The priority of a ticket cannot be changed by hand ──────────────────────────
// It comes from the sub-category (and the SLA that goes with it), or from a Business Rule. Changing the sub-category re-derives it in updateRequestCategory().
// There is deliberately no changePriority() / bulkChangePriority(): no role, manager and admin included, can override it (tests/unit/no-priority-change.test.ts).

// ── The service of a ticket cannot be changed ───────────────────────────────────
// Every service has its own form with its own mandatory fields, so a ticket moved to another service would be missing what that service needs. Nobody changes
// it, whatever their role: a ticket raised against the wrong service is cancelled and raised again in the right one. Only the category and sub-category
// (inside the same service) can be changed, by a technician or manager, which is what sends the ticket to the right person (updateRequestCategory below).

// ── Change category/sub-category (same service) ─────────────────────────────
// The common reclassify path now that category is decoupled from service:
// correcting which of the CURRENT service's tagged sub-categories applies,
// without moving the ticket to a different service/team. reclassifyRequest()
// above is the rarer "wrong service entirely" case.

export async function updateRequestCategory(
  requestId: string,
  subCategoryId: string,
  reason: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  // Moving a ticket to another sub-category moves its priority and deadlines, so the reason is mandatory and is kept in the history (VAPT-056 / VA-TKT-12).
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (why.length < 10) return { error: 'Please say why the sub-category is being changed (at least 10 characters).' }
  if (why.length > 500) return { error: 'The reason is too long (500 characters at most).' }

  const isAgentOrManager =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  if (!isAgentOrManager) return { error: 'Not authorized to reclassify requests.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, status, service_id, team_id, priority, created_at, waiting_since, sub_category_id, assigned_to, paused_ms_total, response_due_at, resolution_due_at, service:services(sla_policy:sla_policies(config))')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isOnTeam =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  if (!isOnTeam) return { error: 'Not authorized to reclassify requests for this technician group.' }

  if (request.sub_category_id === subCategoryId) return {}

  // A finished ticket is not re-classified: it would move deadlines and priority of work that is already done (VAPT-056 / VA-TKT-12).
  if (['resolved', 'closed', 'cancelled'].includes(request.status)) return { error: 'A resolved, closed or cancelled ticket cannot be re-classified. Re-open it first.' }

  // Validate the new sub-category is actually tagged to this request's service.
  const { data: tag } = await supabase
    .from('service_sub_category_tags')
    .select('sub_category:service_sub_categories(id, name, category_id, sla_priority)')
    .eq('service_id', request.service_id)
    .eq('sub_category_id', subCategoryId)
    .single()
  const subCat = tag?.sub_category as { id: string; name: string; category_id: string; sla_priority: RequestPriority | null } | null
  if (!subCat) return { error: 'Selected category is not valid for this service.' }

  // Priority is re-derived from the new sub-category's assigned tier when it
  // has one — same "not mandatory" rule as createRequest — otherwise it's
  // left as whatever it already was.
  const oldPriority = request.priority as RequestPriority
  const newPriority = subCat.sla_priority ?? oldPriority

  const createdAt = new Date(request.created_at)
  const requestService = request.service as unknown as { sla_policy?: { config?: SLAConfig } | null } | null
  let { responseDueAt: newResponseDue, resolutionDueAt: newResolutionDue } = await resolveSlaDeadlines(supabase, {
    serviceId: request.service_id,
    priority: newPriority,
    servicePolicyConfig: requestService?.sla_policy?.config ?? null,
    from: createdAt,
  })

  newResponseDue = withPauseCredit(newResponseDue, request.paused_ms_total, request.waiting_since)
  newResolutionDue = withPauseCredit(newResolutionDue, request.paused_ms_total, request.waiting_since)

  // The old assignment was made for the OLD category (directly or via a
  // Business Rule) and may not make sense for the new one — e.g. Kaushlesh
  // covers IT H/W & S/W, not Genisys, so reclassifying into Genisys must not
  // leave it sitting in his queue. Clear it first and let the Business Rules
  // re-run below decide the new owner from scratch: a matching rule
  // reassigns it, and if nothing matches it's left unassigned rather than
  // silently stuck with whoever had it before.
  const admin = createAdminClient()
  const { data: updated, error: updateError } = await admin
    .from('requests')
    .update({
      category_id: subCat.category_id,
      sub_category_id: subCat.id,
      priority: newPriority,
      response_due_at: newResponseDue,
      resolution_due_at: newResolutionDue,
      assigned_to: null,
      // An "assigned" ticket that loses its owner goes back to "open" (VAPT-055 / VA-TKT-11) instead of staying "assigned" to nobody;
      // the Business Rules below then decide the new owner.
      ...(request.status === 'assigned' ? { status: 'open' as const } : {}),
    })
    .eq('id', requestId)
    // only if nobody changed the status since it was read (VAPT-058 / VA-TKT-15)
    .eq('status', request.status)
    .select('id')

  if (!updateError && (!updated || updated.length === 0)) return { error: 'The ticket was changed by someone else just now. Please refresh and try again.' }
  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#updateRequestCategory', fallback: 'Failed to update category.' }) }

  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'reclassified',
    metadata:
      {
        sub_category_to: subCat.name,
        sub_category_from: request.sub_category_id,
        reason: why,
        ...(newPriority !== oldPriority ? { priority_from: oldPriority, priority_to: newPriority } : {}),
        // the deadlines before and after, so a change of deadline through re-classification can always be seen (VAPT-056)
        response_due_from: request.response_due_at, response_due_to: newResponseDue,
        resolution_due_from: request.resolution_due_at, resolution_due_to: newResolutionDue,
      },
  })
  if (activityResult.error) return { error: activityResult.error }

  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('updated', requestId)
  } catch (e) {
    console.error('[updateRequestCategory] Business rules (updated) failed', e)
  }

  // No rule matched the new category and reassigned it — surface the
  // unassignment explicitly instead of leaving it implicit in the diff
  // between "before" and "after" screens.
  if (request.assigned_to) {
    const { data: after } = await admin.from('requests').select('assigned_to').eq('id', requestId).single()
    if (!after?.assigned_to) {
      await logActivity({
        requestId,
        actorId: profile.id,
        action: 'assigned',
        metadata: { assigned_to: null, reason: 'category_changed_no_matching_rule' },
      })
    }
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  return {}
}

// ── Edit submitted form data ────────────────────────────────────────────────
// The intake form fields (e.g. "Reason for request", "Mobile Number") are
// captured once at submission time and were otherwise permanently read-only —
// reclassify only ever touches service/category/sub_category. This lets an
// agent correct a mistyped or outdated field value after the fact, validated
// against the same form_schema_snapshot/form_sections_snapshot the request was
// actually submitted with (not the service's current, possibly-since-edited
// form) so validation can't reject a value that was legitimately valid then.
//
// Accepts either the full editable field set (the Details tab's multi-field
// form) or a single field (the sidebar's inline per-row editor) — only the
// keys actually present in formDataJson are validated/merged, so a one-field
// save never trips "required" on sibling fields it didn't touch.

export async function updateRequestFormData(
  requestId: string,
  formDataJson: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, team_id, form_schema_snapshot, form_sections_snapshot')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isOnTeam =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  if (!isOnTeam) return { error: 'Not authorized to edit this request.' }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(formDataJson) as Record<string, unknown>
  } catch {
    return { error: 'Invalid form data.' }
  }

  const sections = Array.isArray(request.form_sections_snapshot)
    ? (request.form_sections_snapshot as unknown as FormSection[])
    : null
  const legacyFields = Array.isArray(request.form_schema_snapshot)
    ? (request.form_schema_snapshot as unknown as FormField[])
    : []
  const allFields: FormField[] = sections
    ? [...sections].sort((a, b) => a.order - b.order).flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))
    : legacyFields

  if (allFields.length === 0) return { error: 'This request has no editable submitted information.' }

  // File-type fields live in request_attachments, never in form_data — not
  // part of this edit surface, same exclusion createRequest itself applies.
  // A technician may only correct fields the requester never filled in
  // themselves (technician-only/mandatory fields) — enforced here too, not
  // just hidden in the UI, since this is the actual write boundary.
  const editableFields = allFields.filter((f) => f.type !== 'file' && !requesterCanSet(f))

  // Only the fields actually present in this payload are touched — lets a
  // caller save one field at a time without re-submitting (and re-validating)
  // every other field on the form.
  const fieldsToUpdate = editableFields.filter((f) => Object.prototype.hasOwnProperty.call(parsed, f.id))
  if (fieldsToUpdate.length === 0) return { error: 'No editable fields to update.' }

  for (const field of fieldsToUpdate) {
    const err = validateFieldValue(field, parsed[field.id], 'technician')
    if (err) return { error: err }
  }

  // Merged atomically in Postgres (form_data || patch, in a single UPDATE) —
  // NOT read-modify-write in JS. The sidebar makes single-field saves a
  // one-click action, so two agents correcting different fields on the same
  // request close together is a real scenario; a JS-side merge of a
  // previously-fetched snapshot would let whichever save lands second
  // silently clobber the other's edit. See migration 107.
  const patch: Record<string, unknown> = {}
  for (const field of fieldsToUpdate) patch[field.id] = parsed[field.id]

  const admin = createAdminClient()
  const { error: updateError } = await admin.rpc('merge_request_form_data', {
    p_request_id: requestId,
    p_patch: patch as Json,
  })

  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#updateRequestFormData', fallback: 'Failed to update request.' }) }

  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'form_data_updated',
  })
  if (activityResult.error) return { error: activityResult.error }

  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('updated', requestId)
  } catch (e) {
    console.error('[updateRequestFormData] Business rules (updated) failed', e)
  }

  revalidatePath(`/requests/${requestId}`)
  return {}
}

// ── Auto-close resolved requests ──────────────────────────────────────────────

export async function autoCloseRequests(): Promise<{ closed: number }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { closed: 0 }
  // This runs fire-and-forget on every Home page load by any manager+ — it must never sweep another tenant's
  // data just because it was incidentally triggered by someone in a different org.
  if (!profile.org_id) return { closed: 0 }

  // Finalizes both reopenable-terminal-state cases once their window lapses (resolved: admin-configurable window,
  // see getResolvedReopenWindowHours; cancelled-via-approval-rejection: fixed 48h). The sweep itself now lives in
  // lib/requests/auto-close.ts, shared with the scheduled job (/api/csat/run) so tickets close on time even when
  // no manager opens Home.
  const closed = await autoCloseDueRequests(createAdminClient(), profile.org_id, 50)
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
  if (!profile || !profile.org_id) return { error: 'Not authenticated.' }

  const supabase = await createClient()

  // The caller must be able to see the original ticket (row-level security); nothing else of it is trusted.
  const { data: src } = await supabase
    .from('requests')
    .select('title, service_id, sub_category_id, form_data')
    .eq('id', requestId)
    .single()

  if (!src) return { error: 'Request not found.' }

  // A copy is a NEW ticket, so it goes through the same creation path as any other (VAPT-054 / VA-TKT-10): the service must still exist and be
  // allowed for this person, the form is re-validated, and priority and deadlines are worked out again from the service and sub-category. It no
  // longer copies the old priority, deadlines, team or the technician-only answers, and it is not made with the server key without those checks.
  const title = (src.title + ' (copy)').slice(0, 120)
  const result = await createRequestCore({
    client: supabase,
    orgId: profile.org_id,
    requesterId: profile.id,
    actingUserId: profile.id,
    serviceId: src.service_id,
    subCategoryId: src.sub_category_id ?? null,
    formData: (src.form_data ?? {}) as Record<string, unknown>,
    source: 'web',
    sourceMetadata: { duplicated_from: requestId },
    useAdminForWrites: true,
    actingUserRoleForLocationCheck: profile.role,
    actingUserLocationId: profile.location_id ?? null,
    titleOverride: title,
  })
  if (result.error || !result.requestId) return { error: result.error ?? 'Failed to duplicate.' }

  await logActivity({ requestId: result.requestId, actorId: profile.id, action: 'created', metadata: { duplicated_from: requestId } }).catch(() => {})

  revalidatePath('/requests')
  return { id: result.requestId }
}

// ── Submit for Approval ───────────────────────────────────────────────────────

export async function submitForApproval(requestId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: req } = await supabase
    .from('requests')
    .select('id, title, status, service_id, team_id, requester_id, waiting_since, services(approval_workflow_id)')
    .eq('id', requestId)
    .single()

  if (!req) return { error: 'Request not found.' }

  const onTeam = profile.role === 'agent' && profile.team_members.some((m) => m.team_id === req.team_id)
  // Only staff of the ticket send it for approval: a requester could otherwise freeze their own ticket and pause its SLA (VAPT VA-TKT-05).
  if (!['manager', 'admin', 'platform_owner'].includes(profile.role) && !onTeam)
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

  // Declared as `string` (not inferred from `workflowId: string | null`) and
  // assigned exactly once per branch below — TypeScript can't narrow a `let`
  // reassigned inside a conditional back to non-null once the block ends
  // (the reassignment in the `if` branch and the untouched-but-truthy value
  // in the implicit `else` aren't connected for CFA purposes), so leaving
  // this as `let usedWorkflowId = workflowId` left every later read of it
  // typed `string | null` even though it's always populated by this point.
  let usedWorkflowId: string
  if (workflowId) {
    usedWorkflowId = workflowId
  } else {
    // The service has no approval route. Do NOT pick "any" workflow (it used to be a random one, often another ticket's ad-hoc route, whose
    // approvers would then gain access to this ticket): use "Send for approval" with named approvers, or ask an admin to set a route (VAPT VA-TKT-05).
    return { error: 'This service has no approval workflow. Send the ticket for approval with named approvers, or ask an admin to set up a workflow for the service.' }
  }

  // Product Decision D — a workflow with zero configured steps must never
  // silently act as a valid approval gate. Before this check, submitForApproval()
  // would insert the `approvals` row and flip the request to pending_approval
  // regardless of whether the resolved workflow had any steps at all — for a
  // stepless workflow (e.g. the "Manager Approval" flow bound to live
  // services with no steps ever added), the request then parked in
  // pending_approval permanently: no approver was ever notified, no error
  // was ever shown to the submitter, and resolveApprovalContext() (the
  // approve/reject entry point) would forever report "Approval workflow has
  // no steps," so the ticket could never be un-stuck by normal means.
  // Failing here — before the request's state changes at all — means the
  // submitter gets a clear, actionable error instead of a silently stuck
  // ticket, and preserves the workflow/service-binding records untouched
  // (per Decision D: "do not delete it, do not silently infer a manager step").
  const { count: stepCount } = await admin
    .from('approval_workflow_steps')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', usedWorkflowId)
  if (!stepCount || stepCount === 0) {
    logger.error({
      event: 'approvals.workflow_configuration_incomplete',
      message: 'submitForApproval() blocked: resolved workflow has zero steps',
      route: 'requests.ts#submitForApproval',
      requestId,
      errorCode: 'approval_workflow_no_steps',
      context: { workflowId: usedWorkflowId },
    })
    return { error: 'This request’s approval workflow is not fully configured (no approval steps set up). Contact an admin to complete its setup before submitting for approval.' }
  }

  const { data: createdApproval, error: wfErr } = await admin
    .from('approvals')
    .insert({ request_id: requestId, workflow_id: workflowId || usedWorkflowId, status: 'pending', requested_by: profile.id })
    .select('id')
    .single()
  // 23505 = the approvals_one_pending_per_request unique index rejected a
  // second concurrent submission that slipped past the check above.
  if (wfErr || !createdApproval) return { error: wfErr?.code === '23505' ? 'An approval is already in progress for this request.' : sanitizeError(wfErr, { route: 'requests.ts#submitForApproval', fallback: 'Failed to submit for approval.' }) }

  // Put the request on hold — SLA pauses the same way sendAdHocApproval()
  // does (and "Waiting on User" does): without this, a request submitted for
  // approval through this path kept its clock running for the entire
  // approval wait, unlike the ad-hoc-approval path, which correctly pauses
  // it. pre_approval_status remembers what it actually was so a later full
  // approval resumes there instead of always forcing in_progress.
  const { data: moved, error: stErr0 } = await admin
    .from('requests')
    .update({
      status: 'pending_approval',
      pre_approval_status: req.status,
      updated_at: new Date().toISOString(),
      waiting_since: req.waiting_since ?? new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', req.status)   // only if the status is still the one that was read (VAPT-058)
    .select('id')
  // nobody moved the ticket in the meantime: if somebody did, the approval is taken back below like for any other failure
  const stErr = stErr0 ?? (moved && moved.length > 0 ? null : { message: 'The ticket changed while it was being submitted.', code: 'STATUS_RACE' })
  if (stErr) {
    // The approval exists but the ticket never moved to "pending approval": take the approval back, otherwise the ticket would be blocked
    // ("an approval is already in progress") with nobody to decide it (D-045).
    await admin.from('approvals').delete().eq('id', createdApproval.id)
    return { error: sanitizeError(stErr, { route: 'requests.ts#submitForApproval', fallback: 'Failed to submit for approval.' }) }
  }

  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'status_changed',
    metadata: { from: req.status, to: 'pending_approval' },
  }).catch(() => {})

  // Notify approvers that their review is needed
  {
    const admin = createAdminClient()

    if (usedWorkflowId) {
      const { data: firstStep } = await admin
        .from('approval_workflow_steps')
        .select('approver_type, approver_user_id, approver:profiles!approval_workflow_steps_approver_user_id_fkey(full_name)')
        .eq('workflow_id', usedWorkflowId)
        .order('step_order', { ascending: true })
        .limit(1)
        .single()

      let approverNames: string[] = []

      if (firstStep?.approver_type === 'specific_user' && firstStep.approver_user_id) {
        approverNames = firstStep.approver ? [firstStep.approver.full_name] : []
        if (firstStep.approver_user_id !== profile.id) {
          notify({
            recipientId: firstStep.approver_user_id,
            actorId: profile.id,
            type: 'approval_requested',
            title: 'Approval required',
            body: `${req.title} has been submitted for your approval.`,
            requestId,
            link: `/requests/${requestId}?tab=approvals`,
          }).catch(() => {})
        }
      } else if (firstStep?.approver_type === 'any_manager') {
        const { data: managers } = await admin
          .from('profiles')
          .select('id, full_name')
          .in('role', ['manager', 'admin'])
          .eq('is_active', true)
        approverNames = (managers ?? []).map((m) => m.full_name)
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

      if (approverNames.length > 0) {
        await logActivity({
          requestId,
          actorId: profile.id,
          action: 'approval_requested',
          metadata: { approver_names: approverNames },
        }).catch(() => {})
      }
    }
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/approvals')
  return {}
}

// ── Time entries ──────────────────────────────────────────────────────────────
// Entries are created/closed automatically by updateRequestStatus (see the
// in_progress transitions above) — there's no manual start/stop action.

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
    profile.role === 'platform_owner'
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
    return { error: sanitizeError(error, { route: 'requests.ts#addRelatedRequest', fallback: 'Failed to link request.' }) }
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

  if (error) return { error: sanitizeError(error, { route: 'requests.ts#removeRelatedRequest', fallback: 'Failed to remove link.' }) }
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
  const { data: saved, error } = await supabase
    .from('csat_surveys')
    .update({
      rating,
      comment: comment.trim() || null,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', surveyId)
    .eq('requester_id', profile.id)
    .is('submitted_at', null)
    .select('request_id')
    .maybeSingle()

  if (error) return { error: sanitizeError(error, { route: 'requests.ts#submitCsatRating', fallback: 'Failed to submit rating.' }) }
  if (saved) await notifyLowRating(createAdminClient(), { requestId: saved.request_id, rating, comment, requesterId: profile.id })
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
    .select('source_metadata, team_id')
    .eq('id', requestId)
    .single()
  // Only the technician group of the ticket, or a manager / administrator, may change where a ticket came from (this used to rest on row security alone).
  const sourceTeamId = (current as { team_id?: string } | null)?.team_id
  const mayEditSource = !!current && (['manager', 'admin', 'platform_owner'].includes(profile.role) || (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === sourceTeamId)))
  if (!mayEditSource) return { error: 'Not authorized to change the source of this request.' }

  const meta = { ...((current as { source_metadata?: Record<string, unknown> | null } | null)?.source_metadata ?? {}) }
  if (source) meta.created_via = source
  else delete meta.created_via

  const { error } = await createAdminClient()
    .from('requests')
    .update({ source_metadata: meta as Json, updated_at: new Date().toISOString() } as RequestUpdate)
    .eq('id', requestId)
  if (error) return { error: sanitizeError(error, { route: 'requests.ts#updateRequestSource', fallback: 'Failed to update source.' }) }

  revalidatePath('/requests')
  return {}
}
