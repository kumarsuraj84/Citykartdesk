'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logActivity } from '@/lib/activity'
import { notifyRequesterOfAssignment } from '@/lib/requests/notify-requester'
import { notify, getRequestAudience, parseMentions } from '@/lib/notifications'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import { getResolvedReopenWindowHours } from '@/lib/settings/reopenWindow'
import { getEnabledModules } from '@/lib/queries/profiles'
import { validateFieldValue, isFieldValueEmpty } from '@/lib/validation/formFields'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveServiceFormSections, isTechnicianMandatory, requesterCanSet } from '@/lib/forms/sections'
import { toCSV } from '@/lib/export/csv'
import { mapWithConcurrency } from '@/lib/async/concurrency'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { logger } from '@/lib/observability/logger'
import type { FormField, FormSection, SLAConfig, RequestPriority, RequestStatus } from '@/types'
import type { Database, Json } from '@/types/database'

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
    // "Book on behalf of" needs the admin client for the insert —
    // requests_insert's RLS (requester_id = auth.uid()) would otherwise
    // reject any requester_id other than the acting agent's own id (same
    // pattern as duplicateRequest).
    useAdminForWrites: requesterId !== user.id,
    // Location-scoped visibility only applies to a plain Requester — see
    // createRequestCore()'s own doc comment. Agent-tier actors (including
    // one raising this "on behalf of" a Requester elsewhere) are exempt,
    // matching getServices()'s filterServicesByLocation().
    actingUserRoleForLocationCheck: actingProfile?.role ?? null,
    actingUserLocationId: actingProfile?.location_id ?? null,
  })

  if (result.error) return { error: result.error }
  if (!result.requestId) return { error: 'Failed to create request.' }
  const requestId = result.requestId

  revalidatePath('/requests')
  revalidatePath('/home')

  return { requestId }
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
    .select('id, status, priority, requester_id, team_id, assigned_to, responded_at, waiting_since, response_due_at, resolution_due_at, resolved_at, form_data, form_sections_snapshot, form_schema_snapshot, cancellation_reason, reopen_deadline_at, reopen_count, paused_ms_total')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))
  const isRequester = request.requester_id === profile.id

  const currentStatus = request.status as RequestStatus
  const allowedForAgent = AGENT_TRANSITIONS[currentStatus] ?? []
  const allowedForRequester = REQUESTER_TRANSITIONS[currentStatus] ?? []

  // open/assigned → in_progress is deliberately absent from AGENT_TRANSITIONS
  // (see request-transitions.ts) so the generic status dropdown can never
  // offer it — it must go through the dedicated "Start Working" button/modal
  // instead. That button calls this same action, so it needs its own way in;
  // folding it into `agentInitiated` (rather than a parallel bypass) means
  // every downstream agentInitiated-gated check below — the mandatory first-
  // response message, the technician-mandatory-fields gate, etc. — applies
  // to it automatically instead of needing to be updated in two places.
  const isStartWorking =
    isAgent && (currentStatus === 'open' || currentStatus === 'assigned') && newStatus === 'in_progress'
  const agentInitiated = (isAgent && allowedForAgent.includes(newStatus)) || isStartWorking

  // Reopening a ticket that was cancelled because an approval was rejected
  // isn't in the static transition matrix at all (cancelled has no outgoing
  // transitions there) — it's a narrow, time-boxed exception: only the
  // requester, only when THIS cancellation was caused by an approval
  // rejection (not a technician's own cancellation), and only within the
  // window set when it was rejected. Reopening lands it back on the same
  // technician as 'assigned' so they Start Working again before resending
  // it for approval.
  const isApprovalRejectionReopen =
    isRequester &&
    currentStatus === 'cancelled' &&
    newStatus === 'assigned' &&
    request.cancellation_reason === 'approval_rejected' &&
    !!request.reopen_deadline_at &&
    new Date(request.reopen_deadline_at) > new Date()

  const isResolvedReopenByRequester =
    isRequester && !agentInitiated && currentStatus === 'resolved' && newStatus === 'open'
  // A technician reopening their own resolved ticket counts as a reopen too
  // (badge + reportable reopen_count) — just without the requester's
  // admin-configurable reopen-window deadline check (see
  // getResolvedReopenWindowHours), since they're not bound by the "did you
  // notice in time" clock the same way.
  const isResolvedReopenByAgent =
    agentInitiated && currentStatus === 'resolved' && newStatus === 'open'
  const isResolvedReopen = isResolvedReopenByRequester || isResolvedReopenByAgent

  const canTransition =
    agentInitiated ||
    (isRequester && allowedForRequester.includes(newStatus)) ||
    isApprovalRejectionReopen

  if (!canTransition) {
    if (isRequester && currentStatus === 'cancelled' && newStatus === 'assigned') {
      return {
        error: request.cancellation_reason === 'approval_rejected'
          ? 'The reopen window for this request has expired.'
          : 'This request cannot be reopened.',
      }
    }
    return { error: `Transition to "${newStatus}" is not permitted.` }
  }

  // Resolved → Open by the requester ("I'm not satisfied") is time-boxed —
  // an agent reopening their own resolved work (isResolvedReopenByAgent,
  // guarded separately below) always requires the same remark but isn't
  // bound by this admin-configurable deadline (Request Configuration → General).
  if (isResolvedReopenByRequester) {
    const reopenWindowHours = await getResolvedReopenWindowHours()
    const deadline = request.resolved_at
      ? new Date(new Date(request.resolved_at).getTime() + reopenWindowHours * 3_600_000)
      : null
    if (!deadline || deadline < new Date()) {
      return { error: 'The reopen window for this request has expired.' }
    }
    if (!comment?.trim()) {
      return { error: 'Please explain why you are reopening this request.' }
    }
  }

  // Agent reopening their own resolved ticket — no deadline, but still needs
  // to say why (surfaces in the conversation for anyone else looking at it).
  if (isResolvedReopenByAgent && !comment?.trim()) {
    return { error: 'Please explain why you are reopening this request.' }
  }

  // A technician directly cancelling a ticket must say why — the requester
  // can never reopen it (only an approval-rejected cancellation is
  // reopenable), so this remark is their only visibility into the reason.
  if (agentInitiated && newStatus === 'cancelled' && !comment?.trim()) {
    return { error: 'Please explain why you are cancelling this request.' }
  }

  // Starting work (open/assigned -> in_progress) for the very first time IS
  // the response — mandatory because it's also the first message the
  // requester actually sees from a technician, not just a status flip.
  // Re-entering in_progress later (e.g. from waiting_user) isn't gated —
  // responded_at is already set by then.
  if (agentInitiated && newStatus === 'in_progress' && !request.responded_at && !comment?.trim()) {
    return { error: 'Please add an initial response message before starting work.' }
  }

  // Waiting on User and Resolved are both messages the requester actually
  // reads, not just a status flip — mandatory for the same reason Start
  // Working's first response is.
  if (agentInitiated && newStatus === 'waiting_user' && !comment?.trim()) {
    return { error: 'Please add a message explaining what you need from the requester.' }
  }
  if (agentInitiated && newStatus === 'resolved' && !comment?.trim()) {
    return { error: 'Please add a resolution message before marking this resolved.' }
  }

  // Technician-mandatory fields (required, but hidden or read-only for the
  // requester) must be filled in before an agent can move the ticket at all —
  // only applies to the agent-initiated path; a requester reopening/cancelling
  // their own ticket is never subject to this (they can't see these fields).
  if (agentInitiated) {
    const snapshotSections = Array.isArray(request.form_sections_snapshot)
      ? (request.form_sections_snapshot as unknown as FormSection[])
      : null
    const snapshotLegacy = Array.isArray(request.form_schema_snapshot)
      ? (request.form_schema_snapshot as unknown as FormField[])
      : []
    const snapshotFields: FormField[] = snapshotSections
      ? snapshotSections.flatMap((s) => s.fields)
      : snapshotLegacy
    const formDataForCheck = (request.form_data ?? {}) as Record<string, unknown>
    // store_address is exempt the same way validateFieldValue() exempts it at
    // creation time — it's always system-populated (empty is correct for an
    // HO/Warehouse requester with no store_id) and rendered permanently inert
    // for every audience, so nobody could ever fill it in. Without this
    // exemption, marking it required+technician-only on a service would
    // permanently block every status transition on every ticket from that
    // service.
    const missing = snapshotFields.filter(
      (f) => f.type !== 'store_address' && isTechnicianMandatory(f) && isFieldValueEmpty(formDataForCheck[f.id], f.type)
    )
    if (missing.length > 0) {
      return {
        error: `Fill in the required field${missing.length > 1 ? 's' : ''} before changing status: ${missing.map((f) => f.label).join(', ')}.`,
      }
    }
  }

  const now = new Date()
  const nowIso = now.toISOString()

  // Build the status update payload
  const updatePayload: RequestUpdate = {
    status: newStatus,
    resolved_at: newStatus === 'resolved' ? nowIso : newStatus === 'open' ? null : undefined,
    closed_at:   newStatus === 'closed'   ? nowIso : newStatus === 'open' ? null : undefined,
  }

  // A technician directly cancelling a ticket is permanent (never
  // reopenable) — tagged 'manual' so it's never mistaken for the
  // approval-rejected case, which is. Same tag for a requester cancelling
  // their own ticket (there's nothing to reopen there either way).
  if (newStatus === 'cancelled') {
    updatePayload.cancellation_reason = 'manual'
    updatePayload.reopen_deadline_at = null
  }

  // Resolving a ticket opens a "not satisfied? reopen it" window for the
  // requester (admin-configurable — Request Configuration → General) —
  // reuses the same reopen_deadline_at column the approval-rejection path
  // uses, so autoCloseRequests() only needs one sweep for both cases.
  if (newStatus === 'resolved') {
    const reopenWindowHours = await getResolvedReopenWindowHours()
    updatePayload.reopen_deadline_at = new Date(now.getTime() + reopenWindowHours * 3_600_000).toISOString()
  }

  // Successfully reopening (either path) clears the reopen state and counts
  // toward reopen_count — surfaced as a distinct badge in the UI and as a
  // reportable field ("which tickets were reopened").
  if (isApprovalRejectionReopen || isResolvedReopen) {
    updatePayload.cancellation_reason = null
    updatePayload.reopen_deadline_at = null
    updatePayload.reopen_count = (request.reopen_count ?? 0) + 1
  }

  // SLA pause: entering waiting_user
  if (newStatus === 'waiting_user') {
    updatePayload.waiting_since = nowIso
  }

  // SLA resume: leaving waiting_user → extend deadlines by paused duration,
  // and credit it to the running ledger so a later priority/category/service
  // change (which recomputes deadlines from created_at) doesn't discard it.
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
    updatePayload.paused_ms_total = Number(request.paused_ms_total ?? 0) + pausedMs
  }

  // responded_at: first agent action that moves the request to an active state
  if (isAgent && !request.responded_at && (newStatus === 'in_progress' || newStatus === 'assigned')) {
    updatePayload.responded_at = nowIso
  }

  // Guard against a second transition landing on the same request between
  // this function's initial read and this write (e.g. two agents resolving
  // vs. cancelling the same ticket at once) — matches the pattern already
  // used in approveApproval/rejectApproval for the same class of race.
  //
  // requests_update's RLS policy only grants UPDATE to team members/managers —
  // a plain requester reopening their own resolved ticket (isResolvedReopenByRequester)
  // has no clause there at all (DESK-UAT-001: every such attempt hit zero RLS-visible
  // rows and surfaced as a false "changed by someone else" conflict). That one
  // transition is routed through the admin client instead, scoped by requester_id
  // the same way addComment()'s waiting_user auto-transition already does further
  // down — every other transition (agent reopen, approval-rejection reopen, all
  // normal status changes) is untouched and still goes through the RLS client.
  // The .eq('status', currentStatus) race guard applies unchanged either way, so a
  // genuine concurrent write still zero-matches and is still reported as a conflict.
  const statusUpdateClient = isResolvedReopenByRequester ? createAdminClient() : supabase
  let statusUpdateQuery = statusUpdateClient
    .from('requests')
    .update(updatePayload)
    .eq('id', requestId)
    .eq('status', currentStatus)
  if (isResolvedReopenByRequester) {
    statusUpdateQuery = statusUpdateQuery.eq('requester_id', profile.id)
  }
  const { data: updatedRow, error: updateError } = await statusUpdateQuery.select('id').maybeSingle()

  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#updateRequestStatus', fallback: 'Failed to update status.' }) }
  if (!updatedRow) {
    return { error: 'This request was just changed by someone else — please refresh and try again.' }
  }

  // Auto time-tracking: starts the instant work actually begins (→ in_progress) and
  // stops the instant it stops (leaving in_progress for any reason — waiting_user,
  // resolved, cancelled) — no manual Start/Stop Timer action for an agent to remember.
  if (isAgent && newStatus === 'in_progress' && currentStatus !== 'in_progress') {
    await supabase
      .from('request_time_entries')
      .update({ stopped_at: nowIso })
      .eq('request_id', requestId)
      .eq('user_id', profile.id)
      .is('stopped_at', null)
    const { error: insertError } = await supabase
      .from('request_time_entries')
      .insert({ request_id: requestId, user_id: profile.id, started_at: nowIso })
    // 23505 = a concurrent call already opened an entry for this user+request
    // (partial unique index) — that's "already started", not a real failure.
    if (insertError && insertError.code !== '23505') {
      console.error('[updateRequestStatus] failed to open time entry', insertError)
    }
  } else if (currentStatus === 'in_progress' && newStatus !== 'in_progress') {
    // Admin client, not the RLS-scoped one: the open entry may belong to a
    // DIFFERENT agent than the one calling this (e.g. the ticket was
    // reassigned mid-progress) — request_time_entries' UPDATE policy only
    // allows `user_id = auth.uid()`, so the RLS-scoped client would silently
    // no-op on another agent's row, leaving their timer running forever.
    const admin = createAdminClient()
    await admin
      .from('request_time_entries')
      .update({ stopped_at: nowIso })
      .eq('request_id', requestId)
      .is('stopped_at', null)
  }

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
  // Uses the same field-override > policy resolution as request creation — a
  // reopened ticket should still get the SLA its selected field values/service imply, not
  // just whatever the (removed) org-wide default used to say.
  if (
    (newStatus === 'open' && (currentStatus === 'resolved' || currentStatus === 'closed')) ||
    isApprovalRejectionReopen
  ) {
    try {
      const priority = request.priority as RequestPriority
      const { data: full } = await supabase
        .from('requests')
        .select('service_id, form_data, service:services(sla_policy:sla_policies(config), form_sections, form_fields, template:form_templates(form_sections))')
        .eq('id', requestId)
        .single()

      let resolutionDueAt: string | null = null
      if (full) {
        const svc = full.service as unknown as {
          sla_policy?: { config?: SLAConfig } | null
          form_sections?: FormSection[]
          form_fields?: FormField[]
          template?: { form_sections?: FormSection[] } | null
        }
        const allFields = resolveServiceFormSections(svc).flatMap((s) => s.fields)
        const resolved = await resolveSlaDeadlines(supabase, {
          serviceId: full.service_id,
          priority,
          servicePolicyConfig: svc.sla_policy?.config ?? null,
          allFields,
          formData: (full.form_data ?? {}) as Record<string, unknown>,
          from: new Date(),
        })
        resolutionDueAt = resolved.resolutionDueAt
      }

      // A reopen starts a brand-new SLA clock from now — any pause credit
      // accumulated against the OLD (pre-reopen) clock no longer means
      // anything and must not leak into the new one.
      //
      // Reuses statusUpdateClient (admin, scoped above, for the requester
      // reopen case) rather than the plain RLS client: by the time this runs
      // the row's status is already 'open', not 'resolved', so the same RLS
      // gap that blocked the primary update would block this follow-up write
      // too. requestId/ownership were already established by the update above.
      if (resolutionDueAt) {
        await statusUpdateClient
          .from('requests')
          .update({
            resolution_due_at: resolutionDueAt,
            resolved_at: null,
            closed_at: null,
            waiting_since: null,
            paused_ms_total: 0,
          })
          .eq('id', requestId)
      } else {
        // No applicable SLA config found — still clear the timestamps
        await statusUpdateClient
          .from('requests')
          .update({ resolved_at: null, closed_at: null, waiting_since: null, paused_ms_total: 0 })
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

  // A reopen gets its own activity entry (in addition to the generic
  // status-change one above) — carries the remark and which of the two
  // reopenable cases this was, so the conversation/history timeline makes
  // clear *why* a technician is looking at a ticket that was already
  // resolved or rejected once.
  if (isApprovalRejectionReopen || isResolvedReopen) {
    await logActivity({
      requestId,
      actorId: profile.id,
      action: 'reopened',
      metadata: {
        reason: isApprovalRejectionReopen
          ? 'approval_rejected'
          : isResolvedReopenByRequester
            ? 'unsatisfied_with_resolution'
            : 'agent_reopened',
        remark: comment?.trim() || null,
      },
    })
  }

  // D-06: when the requester and assignee are the same person, the two
  // notify() blocks below would otherwise both target them for the same
  // reopen event, producing two notification rows for one thing that
  // happened once. Tracks who's already been notified in this call so the
  // second block skips a recipient the first one already covered.
  const notifiedUserIds = new Set<string>()

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
      notifiedUserIds.add(request.requester_id)
      notify({
        recipientId: request.requester_id,
        actorId: profile.id,
        ...notifyConfig,
        requestId,
        link: `/requests/${requestId}`,
      }).catch(() => {})
    }
  }

  // Notify assignee when request is reopened (open, or back-to-assigned via
  // the approval-rejection reopen path) — unless they were already notified
  // above as the requester (D-06).
  if (
    (newStatus === 'open' || isApprovalRejectionReopen) &&
    request.assigned_to &&
    request.assigned_to !== profile.id &&
    !notifiedUserIds.has(request.assigned_to)
  ) {
    notify({
      recipientId: request.assigned_to,
      actorId: profile.id,
      type: 'request_reopened',
      title: 'Request reopened',
      body: isApprovalRejectionReopen
        ? `${profile.full_name} reopened a rejected request — it's back with you.`
        : `A request has been reopened: ${requestId}`,
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

  // Business Rules: "updated" trigger — status changes count as an edit.
  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('updated', requestId)
  } catch (e) {
    console.error('[updateRequestStatus] Business rules (updated) failed', e)
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

  if (!isOnTeam) return { error: 'Not authorized to assign requests for this team.' }

  // A plain technician (not a manager+) can only hand a ticket to a teammate
  // on the same team — never leave it unassigned, and never forward it to
  // another team's technician. Managers keep the unrestricted "forward to
  // anyone" picker for legitimate cross-team escalation.
  if (!isManager) {
    if (!assigneeId) {
      return { error: 'Technicians cannot unassign a ticket — assign it to a teammate instead.' }
    }
    const { count } = await supabase
      .from('team_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('team_id', request.team_id)
      .eq('user_id', assigneeId)
    if (!count) {
      return { error: 'You can only assign this ticket to a teammate on the same team.' }
    }
  }

  const newStatus: RequestStatus =
    request.status === 'open' && assigneeId ? 'assigned' : (request.status as RequestStatus)

  // Guard against two concurrent assignments racing (e.g. one tech "Pick
  // up"-ing while a manager reassigns to someone else in the same instant) —
  // without this, both calls report success but only the last write sticks,
  // silently leaving the loser believing they own a ticket they don't.
  let updateQuery = supabase
    .from('requests')
    .update({ assigned_to: assigneeId, status: newStatus })
    .eq('id', requestId)
  updateQuery = request.assigned_to === null
    ? updateQuery.is('assigned_to', null)
    : updateQuery.eq('assigned_to', request.assigned_to)
  const { data: updatedRow, error: updateError } = await updateQuery.select('id').maybeSingle()

  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#assignRequest', fallback: 'Failed to assign request.' }) }
  if (!updatedRow) {
    return { error: 'This request was just assigned by someone else — please refresh and try again.' }
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

export async function bulkAssignRequests(
  requestIds: string[],
  assigneeId: string | null
): Promise<BulkResult> {
  const settled = await mapWithConcurrency(requestIds, BULK_ACTION_CONCURRENCY, async (id) => ({ id, r: await assignRequest(id, assigneeId) }))
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
  const settled = await mapWithConcurrency(requestIds, BULK_ACTION_CONCURRENCY, async (id) => ({ id, r: await updateRequestStatus(id, newStatus) }))
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
  const settled = await mapWithConcurrency(requestIds, BULK_ACTION_CONCURRENCY, async (id) => ({ id, r: await changePriority(id, newPriority) }))
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
  if (requestIds.length === 0) return { error: 'No requests selected.' }

  const supabase = await createClient()
  const { data, error } = await supabase
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
    .in('id', requestIds)

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

  return { csv }
}

// ── Bulk add collaborator ───────────────────────────────────────────────────────

export async function bulkAddCollaborators(requestIds: string[], userId: string): Promise<BulkResult> {
  const settled = await Promise.all(
    requestIds.map(async (id) => ({ id, r: await addCollaborator(id, userId) }))
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

  if (!isOnTeam) return { error: 'Not authorized to add collaborators for this team.' }

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
      autoUpdatePayload.paused_ms_total = Number(request.paused_ms_total ?? 0) + pausedMs
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

// ── Change priority ───────────────────────────────────────────────────────────

export async function changePriority(
  requestId: string,
  newPriority: RequestPriority
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrManager =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  if (!isAgentOrManager) return { error: 'Not authorized to change priority.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, priority, team_id, status, created_at, waiting_since, assigned_to, service_id, form_data, paused_ms_total, service:services(sla_policy:sla_policies(config), form_sections, form_fields, template:form_templates(form_sections))')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isOnTeam =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  if (!isOnTeam) return { error: 'Not authorized to change priority for this team.' }

  const oldPriority = request.priority as RequestPriority
  if (oldPriority === newPriority) return {}

  // Recalculate SLA deadlines from created_at with the new priority tier — same
  // field-override > SLA Policy resolution as request creation, so the
  // request's already-selected field values still drive the deadline under
  // the new priority. This is a manual override — it doesn't touch the
  // request's sub-category, so a later reclassify can still re-derive
  // priority from whatever tier that sub-category carries.
  const svc = request.service as unknown as {
    sla_policy?: { config?: SLAConfig } | null
    form_sections?: FormSection[]
    form_fields?: FormField[]
    template?: { form_sections?: FormSection[] } | null
  }
  const allFields = resolveServiceFormSections(svc).flatMap((s) => s.fields)
  const createdAt = new Date(request.created_at)

  let { responseDueAt: newResponseDue, resolutionDueAt: newResolutionDue } = await resolveSlaDeadlines(supabase, {
    serviceId: request.service_id,
    priority: newPriority,
    servicePolicyConfig: svc.sla_policy?.config ?? null,
    allFields,
    formData: (request.form_data ?? {}) as Record<string, unknown>,
    from: createdAt,
  })

  // Preserve every pause this request has ever accumulated (completed ones
  // via the ledger, plus one currently in progress) on top of the fresh
  // baseline — not just a pause active at this exact moment.
  newResponseDue = withPauseCredit(newResponseDue, request.paused_ms_total, request.waiting_since)
  newResolutionDue = withPauseCredit(newResolutionDue, request.paused_ms_total, request.waiting_since)

  const { error: updateError } = await supabase
    .from('requests')
    .update({
      priority: newPriority,
      response_due_at: newResponseDue,
      resolution_due_at: newResolutionDue,
    })
    .eq('id', requestId)

  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#changePriority', fallback: 'Failed to change priority.' }) }

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

  // Business Rules: "updated" trigger — a priority change counts as an edit.
  // The rule engine's own set_priority/set_status actions write directly via the
  // admin client rather than calling back into changePriority()/
  // updateRequestStatus(), so this can't recurse into itself.
  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('updated', requestId)
  } catch (e) {
    console.error('[changePriority] Business rules (updated) failed', e)
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/tasks')

  return {}
}

// ── Reclassify (correct a wrongly-submitted service/category/sub-category) ────

export async function reclassifyRequest(
  requestId: string,
  newServiceId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  // Moving a ticket to a different Service entirely is manager+ only — a
  // technician (plain agent) may only reclassify Category/Sub Category
  // within the current service, via updateRequestCategory below.
  const isManagerTier =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  if (!isManagerTier) return { error: 'Not authorized to change the service — only Category/Sub Category can be changed.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, service_id, team_id, priority, status, created_at, waiting_since, assigned_to, paused_ms_total')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isOnTeam = isManagerTier

  if (!isOnTeam) return { error: 'Not authorized to reclassify requests for this team.' }

  if (request.service_id === newServiceId) return {}

  const { data: newService } = await supabase
    .from('services')
    .select('id, name, team_id, sla_policy:sla_policies(config)')
    .eq('id', newServiceId)
    .eq('is_active', true)
    .single()

  if (!newService) return { error: 'Selected service not found.' }

  // The originally submitted form_data belongs to the OLD service's field schema
  // (field ids are per-service, generated fresh for every service) — it can't be
  // remapped onto the new service's fields, so this recomputes SLA from the new
  // service's own mapped SLA Policy only (no field-level override lookup) and
  // leaves form_data as-is, a historical record of what was actually submitted.
  // Priority itself is left unchanged (there's no sub-category left post-move
  // to derive a tier from) — the SLA clock still runs from the original
  // created_at, same as changePriority.
  const newServicePolicy = newService.sla_policy as unknown as { config?: SLAConfig } | null
  const createdAt = new Date(request.created_at)
  let { responseDueAt: newResponseDue, resolutionDueAt: newResolutionDue } = await resolveSlaDeadlines(supabase, {
    serviceId: newServiceId,
    priority: request.priority as RequestPriority,
    servicePolicyConfig: newServicePolicy?.config ?? null,
    from: createdAt,
  })

  newResponseDue = withPauseCredit(newResponseDue, request.paused_ms_total, request.waiting_since)
  newResolutionDue = withPauseCredit(newResolutionDue, request.paused_ms_total, request.waiting_since)

  // requests_update's RLS WITH CHECK pins service_id/team_id to their current
  // value (they're normally immutable post-creation) — this is the one
  // deliberate, narrow exception, gated by the isAgentOrManager/isOnTeam checks
  // above rather than by RLS, same pattern as duplicateRequest.
  const movedTeams = newService.team_id !== request.team_id

  const admin = createAdminClient()
  const { error: updateError } = await admin
    .from('requests')
    .update({
      service_id: newServiceId,
      team_id: newService.team_id,
      response_due_at: newResponseDue,
      resolution_due_at: newResolutionDue,
      // The old category/sub-category were tagged to the OLD service — they
      // may not even be valid options for the new one, so they're cleared
      // rather than left stale. Use updateRequestCategory() afterward to set
      // the correct classification for the new service.
      category_id: null,
      sub_category_id: null,
      // A move to a different team invalidates the current assignee — they may
      // not even be a member of the new team, and requests_select's RLS grants
      // visibility via team membership, not via assigned_to, so leaving a stale
      // assignee here would silently orphan the ticket (still shown as
      // "assigned" to someone who can no longer see or act on it).
      ...(movedTeams && request.assigned_to ? { assigned_to: null } : {}),
    })
    .eq('id', requestId)

  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#reclassifyRequest', fallback: 'Failed to reclassify request.' }) }

  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'reclassified',
    metadata: { service_to: newService.name, category_cleared: true },
  })
  if (activityResult.error) return { error: activityResult.error }

  // Moved to a different team — let that team know work landed on their queue.
  if (movedTeams) {
    const { data: teamMembers } = await admin
      .from('team_members')
      .select('user_id')
      .eq('team_id', newService.team_id)
    for (const member of teamMembers ?? []) {
      if (member.user_id !== profile.id) {
        notify({
          recipientId: member.user_id,
          actorId: profile.id,
          type: 'request_created',
          title: `Request reclassified to ${newService.name}`,
          body: `${profile.full_name} moved this request to your team.`,
          requestId,
          link: `/requests/${requestId}`,
        }).catch(() => {})
      }
    }
  }

  // Business Rules: "updated" trigger — a reclassification is an edit, and rules
  // conditioned on service_id/category_id should get a chance to re-evaluate.
  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('updated', requestId)
  } catch (e) {
    console.error('[reclassifyRequest] Business rules (updated) failed', e)
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  return {}
}

// ── Change category/sub-category (same service) ─────────────────────────────
// The common reclassify path now that category is decoupled from service:
// correcting which of the CURRENT service's tagged sub-categories applies,
// without moving the ticket to a different service/team. reclassifyRequest()
// above is the rarer "wrong service entirely" case.

export async function updateRequestCategory(
  requestId: string,
  subCategoryId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const isAgentOrManager =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'

  if (!isAgentOrManager) return { error: 'Not authorized to reclassify requests.' }

  const { data: request } = await supabase
    .from('requests')
    .select('id, service_id, team_id, priority, created_at, waiting_since, sub_category_id, assigned_to, paused_ms_total, service:services(sla_policy:sla_policies(config))')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isOnTeam =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  if (!isOnTeam) return { error: 'Not authorized to reclassify requests for this team.' }

  if (request.sub_category_id === subCategoryId) return {}

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
  const { error: updateError } = await admin
    .from('requests')
    .update({
      category_id: subCat.category_id,
      sub_category_id: subCat.id,
      priority: newPriority,
      response_due_at: newResponseDue,
      resolution_due_at: newResolutionDue,
      assigned_to: null,
    })
    .eq('id', requestId)

  if (updateError) return { error: sanitizeError(updateError, { route: 'requests.ts#updateRequestCategory', fallback: 'Failed to update category.' }) }

  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'reclassified',
    metadata:
      newPriority !== oldPriority
        ? { sub_category_to: subCat.name, priority_from: oldPriority, priority_to: newPriority }
        : { sub_category_to: subCat.name },
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
  // This runs fire-and-forget on every Home page load by any manager+ — it
  // must never sweep another tenant's data just because it was incidentally
  // triggered by someone in a different org (createAdminClient() below
  // bypasses RLS entirely, so this filter is the ONLY thing scoping it).
  if (!profile.org_id) return { closed: 0 }

  const admin = createAdminClient()

  // Finalizes both reopenable-terminal-state cases once their window lapses:
  // resolved (admin-configurable reopen window if unsatisfied — Request
  // Configuration → General, see getResolvedReopenWindowHours) and
  // cancelled-via-approval-rejection (fixed 48h to reopen).
  // reopen_deadline_at is the single column both paths set (see
  // updateRequestStatus/rejectApproval), so one sweep covers
  // both — this supersedes the old app_settings.auto_close_days-driven sweep,
  // which only ever covered resolved tickets on a much longer, admin-set
  // day-based timer.
  const nowIso = new Date().toISOString()
  const { data: toClose } = await admin
    .from('requests')
    .select('id, requester_id, title, status, reopen_deadline_at')
    .eq('org_id', profile.org_id)
    .in('status', ['resolved', 'cancelled'])
    .not('reopen_deadline_at', 'is', null)
    .lt('reopen_deadline_at', nowIso)
    .limit(50)

  if (!toClose || toClose.length === 0) return { closed: 0 }

  let closed = 0

  for (const req of toClose) {
    // Guard against a reopen landing between the SELECT above and this
    // UPDATE: if the request was reopened in that window, its status and/or
    // reopen_deadline_at will have already changed, so this conditional
    // update simply matches zero rows instead of clobbering the reopen.
    const { data: updated, error } = await admin
      .from('requests')
      .update({ status: 'closed', closed_at: nowIso, reopen_deadline_at: null })
      .eq('id', req.id)
      .eq('status', req.status)
      .eq('reopen_deadline_at', req.reopen_deadline_at)
      .select('id')
      .maybeSingle()

    if (!error && updated) {
      closed++
      notify({
        recipientId: req.requester_id,
        actorId: req.requester_id, // system action — use requester as placeholder
        type: 'request_auto_closed',
        title: 'Your request was automatically closed',
        body: req.status === 'resolved'
          ? 'The reopen window has passed since this request was resolved.'
          : 'The reopen window has passed since this request was rejected.',
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
    .select('title, description, service_id, team_id, priority, form_data, form_schema_snapshot, form_sections_snapshot')
    .eq('id', requestId)
    .single()

  if (!src) return { error: 'Request not found.' }

  const { data: newReq, error } = await admin
    .from('requests')
    .insert({
      request_no:             '', // overwritten by trg_requests_assign_no before insert
      title:                  src.title + ' (copy)',
      description:            src.description,
      service_id:             src.service_id,
      team_id:                src.team_id,
      requester_id:           profile.id,
      priority:               src.priority,
      status:                 'open',
      form_data:              src.form_data,
      form_schema_snapshot:   src.form_schema_snapshot,
      form_sections_snapshot: src.form_sections_snapshot,
    })
    .select('id')
    .single()

  if (error || !newReq) return { error: sanitizeError(error, { route: 'requests.ts#duplicateRequest', fallback: 'Failed to duplicate.' }) }

  await logActivity({ requestId: newReq.id, actorId: profile.id, action: 'created', metadata: { duplicated_from: requestId } }).catch(() => {})

  revalidatePath('/requests')
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
    .select('id, title, status, service_id, team_id, requester_id, waiting_since, services(approval_workflow_id)')
    .eq('id', requestId)
    .single()

  if (!req) return { error: 'Request not found.' }

  const onTeam = profile.role === 'agent' && profile.team_members.some((m) => m.team_id === req.team_id)
  if (!['manager', 'admin', 'platform_owner'].includes(profile.role) && !onTeam && profile.id !== req.requester_id)
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
    // No workflow on service — look for any default workflow
    const { data: defaultWorkflow } = await supabase
      .from('approval_workflows')
      .select('id')
      .limit(1)
      .maybeSingle()
    if (!defaultWorkflow) return { error: 'No approval workflow is configured. Ask an admin to set one up.' }
    usedWorkflowId = defaultWorkflow.id
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

  if (!workflowId) {
    const { error: wfErr } = await admin
      .from('approvals')
      .insert({ request_id: requestId, workflow_id: usedWorkflowId, status: 'pending' })
    // 23505 = the approvals_one_pending_per_request unique index rejected a
    // second concurrent submission that slipped past the check above.
    if (wfErr) return { error: wfErr.code === '23505' ? 'An approval is already in progress for this request.' : sanitizeError(wfErr, { route: 'requests.ts#submitForApproval', fallback: 'Failed to submit for approval.' }) }
  } else {
    const { error: wfErr } = await admin
      .from('approvals')
      .insert({ request_id: requestId, workflow_id: workflowId, status: 'pending' })
    if (wfErr) return { error: wfErr.code === '23505' ? 'An approval is already in progress for this request.' : sanitizeError(wfErr, { route: 'requests.ts#submitForApproval', fallback: 'Failed to submit for approval.' }) }
  }

  // Put the request on hold — SLA pauses the same way sendAdHocApproval()
  // does (and "Waiting on User" does): without this, a request submitted for
  // approval through this path kept its clock running for the entire
  // approval wait, unlike the ad-hoc-approval path, which correctly pauses
  // it. pre_approval_status remembers what it actually was so a later full
  // approval resumes there instead of always forcing in_progress.
  const { error: stErr } = await admin
    .from('requests')
    .update({
      status: 'pending_approval',
      pre_approval_status: req.status,
      updated_at: new Date().toISOString(),
      waiting_since: req.waiting_since ?? new Date().toISOString(),
    })
    .eq('id', requestId)
  if (stErr) return { error: sanitizeError(stErr, { route: 'requests.ts#submitForApproval', fallback: 'Failed to submit for approval.' }) }

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

  if (error) return { error: sanitizeError(error, { route: 'requests.ts#submitCsatRating', fallback: 'Failed to submit rating.' }) }
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
  if (error) return { error: sanitizeError(error, { route: 'requests.ts#updateRequestSource', fallback: 'Failed to update source.' }) }

  revalidatePath('/requests')
  return {}
}
