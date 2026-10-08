// The one place a ticket's status changes. Every rule (who may move it where, mandatory remarks, SLA pause and resume,
// reopen window, activity log, notifications, business rules) lives here. It is not a server action: callers pass the
// acting person in, so a signed-in screen (lib/actions/requests.ts) and a one-off e-mail link (lib/actions/csatPublic.ts,
// where the requester proved who they are with a signed token) share exactly the same rules.

import { revalidatePath } from 'next/cache'
import type { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify } from '@/lib/notifications'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import { STATUS_LABELS } from '@/lib/constants/requests'
import { getResolvedReopenWindowHours } from '@/lib/settings/reopenWindow'
import { isFieldValueEmpty } from '@/lib/validation/formFields'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveServiceFormSections, isTechnicianMandatory } from '@/lib/forms/sections'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { buildFirstResponseMessage } from '@/lib/requests/first-response'
import { issueCsat } from '@/lib/csat/issue'
import type { FormField, FormSection, SLAConfig, RequestPriority, RequestStatus, ProfileWithTeams } from '@/types'
import type { Database } from '@/types/database'

type RequestUpdate = Database['public']['Tables']['requests']['Update']
type ActionResult = { error?: string }

/** Who is changing the status, and the database client that is allowed to read what they may read. */
export interface StatusActor {
  supabase: Awaited<ReturnType<typeof createClient>>
  profile: ProfileWithTeams
}

export async function applyStatusChange(
  actor: StatusActor,
  requestId: string,
  newStatus: RequestStatus,
  commentInput?: string
): Promise<ActionResult> {
  // Reassigned below for a first "Start Working", which posts an automatic first-response message.
  let comment = commentInput
  const { supabase, profile } = actor

  const { data: request } = await supabase
    .from('requests')
    .select('id, request_no, status, priority, requester_id, team_id, assigned_to, responded_at, waiting_since, response_due_at, resolution_due_at, resolved_at, form_data, form_sections_snapshot, form_schema_snapshot, cancellation_reason, reopen_deadline_at, reopen_count, paused_ms_total')
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
    // The stored reopen_deadline_at (set once, at the moment this was resolved) is the
    // single source of truth — it's also exactly what the requester's own "Xh Ym left to
    // reopen" countdown displays (ResolvedReopenBanner). Recomputing from
    // resolved_at + the CURRENT admin setting here used to silently disagree with that
    // display whenever the setting was changed after this particular ticket was resolved
    // (a since-shortened window would let a "this has expired" banner still succeed here;
    // a since-lengthened one would reject a reopen the banner was still counting down).
    const deadline = request.reopen_deadline_at ? new Date(request.reopen_deadline_at) : null
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
  // A requester cancelling their own ticket must say why too, for the same
  // reason the other requester-readable transitions (reopen, etc.) do —
  // the technician's only visibility into why it was pulled.
  if (newStatus === 'cancelled' && !comment?.trim()) {
    return { error: 'Please explain why you are cancelling this request.' }
  }

  // Starting work (open/assigned -> in_progress) for the very first time IS
  // the response — it's also the first message the requester actually sees from a
  // technician, not just a status flip. The technician doesn't have to type it: if they
  // didn't supply one, an automatic message is posted to the conversation in their name.
  // Re-entering in_progress later (e.g. from waiting_user) isn't affected —
  // responded_at is already set by then.
  if (agentInitiated && newStatus === 'in_progress' && !request.responded_at && !comment?.trim()) {
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', request.requester_id)
      .maybeSingle()
    comment = buildFirstResponseMessage({
      requesterName: requesterProfile?.full_name,
      technicianName: profile.full_name,
      requestNo: request.request_no,
    })
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

  // "Hold due to Purchase from HO" — technician-only both ways (see
  // request-transitions.ts), each direction needs its own remark: one
  // explaining the hold, a separate one explaining what changed on resume.
  if (agentInitiated && newStatus === 'hold_purchase_ho' && !comment?.trim()) {
    return { error: 'Please add a note explaining the purchase hold.' }
  }
  if (agentInitiated && currentStatus === 'hold_purchase_ho' && newStatus === 'in_progress' && !comment?.trim()) {
    return { error: 'Please add a note before moving this back to In Progress.' }
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

  // SLA pause: entering waiting_user or hold_purchase_ho
  if (newStatus === 'waiting_user' || newStatus === 'hold_purchase_ho') {
    updatePayload.waiting_since = nowIso
  }

  // SLA resume: leaving waiting_user or hold_purchase_ho → extend deadlines by
  // paused duration, and credit it to the running ledger so a later
  // priority/category/service change (which recomputes deadlines from
  // created_at) doesn't discard it.
  if ((currentStatus === 'waiting_user' || currentStatus === 'hold_purchase_ho') && request.waiting_since) {
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
  // requests_update's RLS policy only grants UPDATE to team members/managers — a
  // plain requester (not a team member, not a manager+) has NO clause there at all,
  // for ANY transition, not just reopening. First caught for resolved-ticket reopen
  // (DESK-UAT-001) and then again for approval-rejection reopen — both patched by
  // routing that one specific case through the admin client. Still missed the general
  // case: a requester cancelling their own *open* ticket (REQUESTER_TRANSITIONS['open']
  // includes 'cancelled') hit the exact same zero-RLS-rows conflict, because by that
  // point `agentInitiated` is false but the update still went through the RLS-scoped
  // client. The real invariant is simpler than "which specific transition is this":
  // by this point `canTransition` is already true, so if `agentInitiated` is false the
  // action MUST be requester-initiated (either an allowed REQUESTER_TRANSITIONS entry
  // or isApprovalRejectionReopen — both requester-only) — so every requester-initiated
  // path, not just the two reopen ones, needs the same admin-client-scoped-by-requester_id
  // bypass. The .eq('status', currentStatus) race guard applies unchanged either way, so
  // a genuine concurrent write still zero-matches and is still reported as a conflict.
  const requesterInitiated = !agentInitiated
  const statusUpdateClient = requesterInitiated ? createAdminClient() : supabase
  let statusUpdateQuery = statusUpdateClient
    .from('requests')
    .update(updatePayload)
    .eq('id', requestId)
    .eq('status', currentStatus)
  if (requesterInitiated) {
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

  // CSAT: start the survey and send the ONE e-mail for a resolution ("resolved" + stars + reopen link).
  // Uses the admin client because csat_surveys' INSERT policy only allows admin/platform_owner directly; this
  // must succeed regardless of who resolved the request. When that e-mail goes out, the plain "resolved" e-mail
  // below is skipped (the bell notification still appears); when it cannot (CSAT off, no link secret, no
  // address), the plain e-mail is sent as before so the requester always hears that it is resolved.
  let csatEmailed = false
  if (newStatus === 'resolved' && request.requester_id && profile.org_id) {
    try {
      const admin = createAdminClient()
      const { data: titleRow } = await admin.from('requests').select('title').eq('id', requestId).maybeSingle()
      const csat = await issueCsat(admin as never, {
        id: requestId, requestNo: request.request_no, title: titleRow?.title ?? '', orgId: profile.org_id, requesterId: request.requester_id,
      }, {
        resolutionNote: comment ?? '', resolverName: profile.full_name, reopenDeadlineIso: (updatePayload.reopen_deadline_at as string | null | undefined) ?? null,
        wasReopened: (request.reopen_count ?? 0) > 0, nowIso,
      })
      csatEmailed = csat.emailed
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
    metadata: { from: currentStatus, to: newStatus, ...(comment?.trim() ? { remark: comment.trim() } : {}) },
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
    const notifyStatuses: Record<string, { type: import('@/lib/notifications').NotifyInput['type']; title: string; body: string; skipEmail?: boolean }> = {
      in_progress:  { type: 'status_changed',    title: 'Your request is in progress',       body: `${profile.full_name} is working on it.` },
      waiting_user: { type: 'status_changed',    title: 'Action required on your request',   body: `${profile.full_name} is waiting for your response.` },
      hold_purchase_ho: { type: 'status_changed', title: 'Your request is on hold — pending purchase from HO', body: `${profile.full_name} put this on hold pending a Head Office purchase.` },
      resolved:     { type: 'request_resolved',  title: 'Your request has been resolved',    body: `${profile.full_name} marked it resolved.`, skipEmail: csatEmailed },
      // Closing needs nothing from the requester, so it shows in the bell only (no e-mail).
      closed:       { type: 'request_closed',    title: 'Your request has been closed',      body: `Request ${request.id} is now closed.`, skipEmail: true },
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
        // The status-changed email template shows "from X to Y" — without these the
        // email rendered with both blank ("changed from  to ").
        metadata: {
          oldStatus: STATUS_LABELS[currentStatus] ?? currentStatus,
          newStatus: STATUS_LABELS[newStatus] ?? newStatus,
          comment: comment?.trim() || undefined,
        },
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
        : `${profile.full_name} reopened this request — it's back with you.`,
      requestId,
      link: `/requests/${requestId}`,
      // Without this the email rendered with blank "changed from  to " (same class of
      // gap already fixed for in_progress/waiting_user) — and now shows the requester's
      // own note on why it's not actually fixed.
      metadata: {
        oldStatus: STATUS_LABELS[currentStatus] ?? currentStatus,
        newStatus: STATUS_LABELS[newStatus] ?? newStatus,
        comment: comment?.trim() || undefined,
      },
    }).catch(() => {})
  }

  // The two self-service reopen paths (resolved -> open, and approval-rejected -> assigned)
  // are both something the REQUESTER does to their OWN ticket — the block above skips
  // notifying them precisely because they're the actor, but they still asked for this and
  // deserve a "yes, it went through, and here's who has it now" confirmation, same as any
  // other assignment. Not folded into notifyRequesterOfAssignment (that's for someone ELSE
  // assigning the ticket) since the message here is about reopening, not first assignment.
  if ((isResolvedReopenByRequester || isApprovalRejectionReopen) && request.assigned_to) {
    const { data: assignee } = await supabase.from('profiles').select('full_name').eq('id', request.assigned_to).maybeSingle()
    notify({
      recipientId: profile.id,
      actorId: profile.id,
      type: 'request_reopened',
      title: 'Your request has been reopened',
      body: `It's back with ${assignee?.full_name || 'the technician'}.`,
      requestId,
      link: `/requests/${requestId}`,
      metadata: {
        oldStatus: STATUS_LABELS[currentStatus] ?? currentStatus,
        newStatus: STATUS_LABELS[newStatus] ?? newStatus,
        comment: comment?.trim() || undefined,
        assigneeName: assignee?.full_name || undefined,
      },
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

