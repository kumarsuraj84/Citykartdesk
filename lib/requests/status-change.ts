// The one place a ticket's status changes. Every rule (who may move it where, mandatory remarks, SLA pause and resume,
// reopen window, activity log, notifications, business rules) lives here. It is not a server action: callers pass the
// acting person in, so a signed-in screen (lib/actions/requests.ts) and a one-off e-mail link (lib/actions/csatPublic.ts,
// where the requester proved who they are with a signed token) share exactly the same rules.

import { revalidatePath } from 'next/cache'
import type { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'
import { notify, getRequestAudience } from '@/lib/notifications'
import { logger } from '@/lib/observability/logger'
import { pauseCreditMs, shiftDeadlineByCredit } from '@/lib/sla/business-hours'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS, VENDOR_TRANSITIONS } from '@/lib/constants/request-transitions'
import { vendorRoleOf } from '@/lib/vendor/access'
import { clearOemTicketOnReopen } from '@/lib/vendor/ticket-fields'
import { cancelOpenRequest } from '@/lib/vendor/requests'
import { tellVendorHoldEnded, tellVendorReopened } from '@/lib/vendor/ticket-notify'
import { STATUS_LABELS, isClosedLikeStatus } from '@/lib/constants/requests'
import { getResolvedReopenWindowHours } from '@/lib/settings/reopenWindow'
import { isFieldValueEmpty } from '@/lib/validation/formFields'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { resolveServiceFormSections, isTechnicianMandatory, fieldAppliesToCategory } from '@/lib/forms/sections'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { buildFirstResponseMessage } from '@/lib/requests/first-response'
import { issueCsat } from '@/lib/csat/issue'
import { resendOemOnReopen } from '@/lib/requests/master-routing'
import type { FormField, FormSection, SLAConfig, RequestPriority, RequestStatus, ProfileWithTeams } from '@/types'
import type { Database } from '@/types/database'
import { checkResolutionNote } from '@/lib/requests/resolution-note'

type RequestUpdate = Database['public']['Tables']['requests']['Update']
/** commentId: the conversation message written for this change (when there was one), so a caller can tie a file (FSR, quote, PO document) to it. */
type ActionResult = { error?: string; commentId?: string }

/** Who is changing the status, and the database client that is allowed to read what they may read. */
export interface StatusActor {
  supabase: Awaited<ReturnType<typeof createClient>>
  profile: ProfileWithTeams
}

/**
 * Set only by the vendor screens (lib/actions/vendor.ts), after they checked the stage rules (OEM ticket number, resolution + FSR, hold request ...).
 * A vendor technician can change a ticket ONLY with one of these; the ordinary status screens and actions never pass it.
 */
export type VendorFlow = 'start' | 'resolve' | 'hold' | 'resume'

export interface StatusChangeOptions {
  vendorFlow?: VendorFlow
  /**
   * Set only by the PO approval screen (lib/actions/vendor-po.ts) AFTER it proved that the person is the PO approver of this very request:
   * 'approve' moves a held ticket back to In Progress, 'reject' cancels it exactly like a rejected approval does (the store may reopen it within 48 hours).
   */
  poDecision?: 'approve' | 'reject'
}

/**
 * Runs one step that comes AFTER the status has already been changed (timer, vendor mail, survey, notification ...). The change is committed, so a failure here must not be
 * reported to the user as a failed status change (they would retry something that already happened): it is logged as an error with the request id, and the rest carries on (H-03).
 */
async function followUp<T>(requestId: string, step: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    logger.error({
      event: 'status_change.follow_up_failed',
      message: `The status was changed, but the follow-up step "${step}" failed`,
      route: 'lib/requests/status-change.ts#applyStatusChange',
      requestId,
      errorCode: 'status_change_follow_up_failed',
      context: { step },
      error: e,
    })
    return undefined
  }
}

/**
 * Stops the open timer(s) of a ticket (B-07). Admin client, not the RLS-scoped one: the open entry may belong to a DIFFERENT agent than the one calling this (the ticket was
 * reassigned mid-progress), and request_time_entries' UPDATE policy only allows `user_id = auth.uid()`. Pass a userId to stop only that person's timer.
 * Never throws; a failure is logged with the request id.
 */
export async function stopOpenTimeEntries(requestId: string, stoppedAtIso: string, userId?: string): Promise<{ error?: string }> {
  try {
    let q = createAdminClient().from('request_time_entries').update({ stopped_at: stoppedAtIso }).eq('request_id', requestId).is('stopped_at', null)
    if (userId) q = q.eq('user_id', userId)
    const { error } = await q
    if (error) throw error
    return {}
  } catch (e) {
    logger.error({
      event: 'time_entries.stop_failed',
      message: 'The open timer of a ticket could not be stopped',
      route: 'lib/requests/status-change.ts#stopOpenTimeEntries',
      requestId,
      errorCode: 'time_entry_stop_failed',
      error: e,
    })
    return { error: 'Could not stop the timer.' }
  }
}

const PO_DECISION_MOVES: Record<'approve' | 'reject', RequestStatus> = { approve: 'in_progress', reject: 'cancelled' }

const VENDOR_FLOW_MOVES: Record<VendorFlow, { from: RequestStatus[]; to: RequestStatus }> = {
  start:   { from: ['open', 'assigned'], to: 'in_progress' },
  resolve: { from: ['in_progress'], to: 'resolved' },
  hold:    { from: ['in_progress'], to: 'hold_purchase_ho' },
  resume:  { from: ['hold_purchase_ho'], to: 'in_progress' },
}

type SlaResetResult = { ok: true } | { ok: false; error: unknown }

/**
 * REOPEN: recalculate resolution_due_at from the current time and clear the resolution timestamps and the pause ledger of the clock that just ended.
 * Uses the same field-override > policy resolution as request creation — a reopened ticket should still get the SLA its selected field values/service imply.
 * Uses the server's client (the requester who reopens has no write right, and the SLA tables must be readable whoever calls); the caller already checked who may reopen.
 * Never throws: it reports whether the reset was written.
 */
async function resetSlaAfterReopen(db: ReturnType<typeof createAdminClient>, requestId: string, priority: RequestPriority): Promise<SlaResetResult> {
  try {
    const { data: full, error: readError } = await db
      .from('requests')
      .select('service_id, form_data, service:services(sla_policy:sla_policies(config), form_sections, form_fields, template:form_templates(form_sections))')
      .eq('id', requestId)
      .single()
    if (readError || !full) return { ok: false, error: readError ?? new Error('ticket not found') }

    const svc = full.service as unknown as {
      sla_policy?: { config?: SLAConfig } | null
      form_sections?: FormSection[]
      form_fields?: FormField[]
      template?: { form_sections?: FormSection[] } | null
    }
    const allFields = resolveServiceFormSections(svc).flatMap((sec) => sec.fields)
    const resolved = await resolveSlaDeadlines(db, {
      serviceId: full.service_id,
      priority,
      servicePolicyConfig: svc.sla_policy?.config ?? null,
      allFields,
      formData: (full.form_data ?? {}) as Record<string, unknown>,
      from: new Date(),
    })

    // A reopen starts a brand-new SLA clock from now — any pause credit accumulated against the OLD (pre-reopen) clock no longer means
    // anything and must not leak into the new one. With no applicable SLA config the timestamps are still cleared.
    const { error: writeError } = await db
      .from('requests')
      .update({
        ...(resolved.resolutionDueAt ? { resolution_due_at: resolved.resolutionDueAt } : {}),
        resolved_at: null,
        closed_at: null,
        waiting_since: null,
        paused_ms_total: 0,
      })
      .eq('id', requestId)
    return writeError ? { ok: false, error: writeError } : { ok: true }
  } catch (e) {
    return { ok: false, error: e }
  }
}

export async function applyStatusChange(
  actor: StatusActor,
  requestId: string,
  newStatus: RequestStatus,
  commentInput?: string,
  options: StatusChangeOptions = {}
): Promise<ActionResult> {
  // Reassigned below for a first "Start Working", which posts an automatic first-response message.
  let comment = commentInput
  const { supabase, profile } = actor

  // the PO approver is not necessarily on the ticket's team, so a PO decision (already authorised by its own screen) reads the ticket with the server's key
  const { data: request } = await (options.poDecision ? createAdminClient() : supabase)
    .from('requests')
    .select('id, request_no, status, priority, requester_id, team_id, assigned_to, responded_at, waiting_since, response_due_at, resolution_due_at, resolved_at, form_data, category_id, form_sections_snapshot, form_schema_snapshot, cancellation_reason, reopen_deadline_at, reopen_count, paused_ms_total')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  // A vendor (OEM engineer) works only the tickets assigned to him and only through the vendor screens; a vendor manager only looks.
  const vendorKind = vendorRoleOf(profile)
  const isVendorTech = vendorKind === 'technician' && request.assigned_to === profile.id
  const currentStatus = request.status as RequestStatus
  if (vendorKind) {
    const move = options.vendorFlow ? VENDOR_FLOW_MOVES[options.vendorFlow] : null
    if (!isVendorTech || !move || move.to !== newStatus || !move.from.includes(currentStatus)) {
      return { error: 'Please use the vendor screens to change this ticket.' }
    }
  } else if (options.vendorFlow) {
    return { error: 'Transition is not permitted.' }
  }
  const isPoDecision = !!options.poDecision
  if (isPoDecision && (vendorKind || currentStatus !== 'hold_purchase_ho' || PO_DECISION_MOVES[options.poDecision!] !== newStatus)) {
    return { error: 'Transition is not permitted.' }
  }

  const isAgent =
    isVendorTech ||
    isPoDecision ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))
  const isRequester = request.requester_id === profile.id

  const allowedForAgent = (isPoDecision ? [PO_DECISION_MOVES[options.poDecision!]] : isVendorTech ? VENDOR_TRANSITIONS[currentStatus] : AGENT_TRANSITIONS[currentStatus]) ?? []
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
  // the resolution note must say what was wrong and what was done, and must not carry a password (lib/requests/resolution-note.ts)
  if (agentInitiated && newStatus === 'resolved') {
    const problem = checkResolutionNote(comment)
    if (problem) return { error: problem }
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
  if (agentInitiated && !isVendorTech && !isPoDecision) {   // a vendor's stage rules (OEM number, resolution, FSR) were checked by the vendor screens; a PO decision is not technician work
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
      (f) => f.type !== 'store_address' && fieldAppliesToCategory(f, (request as { category_id?: string | null }).category_id) && isTechnicianMandatory(f) && isFieldValueEmpty(formDataForCheck[f.id], f.type)
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
    // a rejected PO cancels the ticket the way a rejected approval does: the store may reopen it within 48 hours (see lib/approvals/decision.ts)
    if (options.poDecision === 'reject') {
      updatePayload.cancellation_reason = 'approval_rejected'
      updatePayload.reopen_deadline_at = new Date(now.getTime() + 48 * 3_600_000).toISOString()
    }
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
    // The whole pause is credited here, once. (A re-classification while paused no longer adds the running pause itself: it used to, and this then credited it again.)
    // Credited in business time when the calendar has gaps (deadlines are counted in business minutes), plain wall-clock time otherwise; the same number
    // goes into the deadline and into the ledger.
    const creditMs = await pauseCreditMs(new Date(request.waiting_since), now)
    if (request.response_due_at) {
      updatePayload.response_due_at = (await shiftDeadlineByCredit(new Date(request.response_due_at), creditMs)).toISOString()
    }
    if (request.resolution_due_at) {
      updatePayload.resolution_due_at = (await shiftDeadlineByCredit(new Date(request.resolution_due_at), creditMs)).toISOString()
    }
    updatePayload.waiting_since = null
    updatePayload.paused_ms_total = Number(request.paused_ms_total ?? 0) + creditMs
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
  // Every ticket write is made with the server's own key, after the role and transition checks above (migration 165: a signed-in user has no direct write right).
  const statusUpdateClient = createAdminClient()
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

  // A Citykart technician ends a hold that a vendor had asked for (parts / PO): that request is closed as cancelled, so nothing stays "pending" on a ticket that moved on.
  if (currentStatus === 'hold_purchase_ho' && !options.vendorFlow && !isPoDecision) {
    await followUp(requestId, 'end the vendor hold request', async () => {
      const closed = await cancelOpenRequest(requestId, profile.id, 'The hold was ended by Citykart.')
      // the vendor who asked is told (mail and bell); nothing is sent when the ticket is not with a vendor
      if (closed) await tellVendorHoldEnded(requestId, profile.id, profile.full_name, comment?.trim() ?? '', closed)
    })
  }

  // Auto time-tracking: starts the instant work actually begins (→ in_progress) and
  // stops the instant it stops (leaving in_progress for any reason — waiting_user,
  // resolved, cancelled) — no manual Start/Stop Timer action for an agent to remember.
  if (isAgent && !isVendorTech && !isPoDecision && newStatus === 'in_progress' && currentStatus !== 'in_progress') {
    const { error: closeError } = await supabase
      .from('request_time_entries')
      .update({ stopped_at: nowIso })
      .eq('request_id', requestId)
      .eq('user_id', profile.id)
      .is('stopped_at', null)
    if (closeError) {
      logger.error({ event: 'time_entries.close_previous_failed', message: 'An earlier open timer could not be closed before a new one was opened', route: 'lib/requests/status-change.ts#applyStatusChange', requestId, errorCode: 'time_entry_stop_failed', error: closeError })
    }
    const { error: insertError } = await supabase
      .from('request_time_entries')
      .insert({ request_id: requestId, user_id: profile.id, started_at: nowIso })
    // 23505 = a concurrent call already opened an entry for this user+request
    // (partial unique index) — that's "already started", not a real failure.
    if (insertError && insertError.code !== '23505') {
      logger.error({ event: 'time_entries.open_failed', message: 'The timer could not be started', route: 'lib/requests/status-change.ts#applyStatusChange', requestId, errorCode: 'time_entry_start_failed', error: insertError })
    }
  } else if ((currentStatus === 'in_progress' && newStatus !== 'in_progress') || isClosedLikeStatus(newStatus)) {
    // Leaving in_progress for ANY status stops the timer, and so does finishing the ticket whatever it was before (B-07: a timer left open by an earlier move must not run on).
    await stopOpenTimeEntries(requestId, nowIso)
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
      logger.error({ event: 'status_change.csat_failed', message: 'The status was changed to resolved, but the CSAT survey could not be created', route: 'lib/requests/status-change.ts#applyStatusChange', requestId, errorCode: 'csat_issue_failed', error: e })
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
    // One try, and ONE more if it fails: the ticket is already reopened, and without this reset it keeps the deadline (and pause credit) of the clock that just ended.
    // If both tries fail it is logged as an error with the request id, so the ticket can be corrected; the reopen itself is not undone.
    let slaReset = await resetSlaAfterReopen(statusUpdateClient, requestId, request.priority as RequestPriority)
    if (!slaReset.ok) slaReset = await resetSlaAfterReopen(statusUpdateClient, requestId, request.priority as RequestPriority)
    if (!slaReset.ok) {
      logger.error({
        event: 'status_change.reopen_sla_reset_failed',
        message: 'The ticket was reopened but its SLA clock could not be reset (tried twice)',
        route: 'lib/requests/status-change.ts#applyStatusChange',
        requestId,
        errorCode: 'reopen_sla_reset_failed',
        error: slaReset.error,
      })
    }
  }

  // Activity log — status change must be recorded
  const activityResult = await logActivity({
    requestId,
    actorId: profile.id,
    action: 'status_changed',
    metadata: { from: currentStatus, to: newStatus, ...(comment?.trim() ? { remark: comment.trim() } : {}) },
  })
  // B-15: the status HAS changed by now. A failed history entry is already logged by logActivity(); telling the user "error" for a change that went through made them retry
  // (and fail, or repeat it). So carry on.
  if (activityResult.error) {
    logger.error({ event: 'status_change.activity_missing', message: 'The status was changed but its history entry could not be written', route: 'lib/requests/status-change.ts#applyStatusChange', requestId, errorCode: 'activity_insert_failed' })
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

  // A resolved ticket that is reopened is not fixed, so the OEM is e-mailed again like for a new ticket (only tickets the sheets sent to an OEM in the first place).
  if (isResolvedReopen) {
    // a vendor must enter the OEM's NEW ticket number (the old one is replaced), so the two boxes are emptied first; the old number stays in the conversation
    await followUp(requestId, 'clear the OEM ticket number', () => clearOemTicketOnReopen(requestId))
    await followUp(requestId, 'e-mail the OEM again', () => resendOemOnReopen({ requestId, actorId: profile.id, reason: comment?.trim() ?? '' }))
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
      closed:       { type: 'request_closed',    title: 'Your request has been closed',      body: `${request.request_no ? `Request ${request.request_no}` : 'Your request'} is now closed.`, skipEmail: true },   // the ticket number, never the internal id
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

  // B-14: a ticket that is cancelled or resolved is also news for the technician who has it (a vendor technician included) and for its collaborators, not only for the requester.
  // Never the person who did it, and never someone already told above. Bell only: the e-mail wording of these two events is written for the requester.
  if (newStatus === 'cancelled' || newStatus === 'resolved') {
    await followUp(requestId, 'tell the technician and collaborators', async () => {
      const audience = await getRequestAudience(requestId)
      const recipients = [...new Set([audience.assigneeId, ...audience.collaboratorIds].filter((id): id is string => !!id && id !== profile.id && !notifiedUserIds.has(id)))]
      if (recipients.length === 0) return
      for (const id of recipients) notifiedUserIds.add(id)
      await notify(recipients.map((recipientId) => ({
        recipientId,
        actorId: profile.id,
        type: (newStatus === 'cancelled' ? 'request_cancelled' : 'request_resolved') as import('@/lib/notifications').NotifyInput['type'],
        title: newStatus === 'cancelled' ? `Request ${request.request_no} was cancelled` : `Request ${request.request_no} was resolved`,
        body: newStatus === 'cancelled' ? `${profile.full_name} cancelled the request.` : `${profile.full_name} marked it resolved.`,
        requestId,
        link: `/requests/${requestId}`,
        skipEmail: true,
      })))
    })
  }

  // Notify assignee when request is reopened (open, or back-to-assigned via
  // the approval-rejection reopen path) — unless they were already notified
  // above as the requester (D-06).
  // a vendor technician gets his own, clearly marked "REOPENED" mail (and bell) instead of the plain one; he must enter the new OEM ticket number after a resolved ticket is reopened
  const reopenedForVendor = (isResolvedReopen || isApprovalRejectionReopen) && !!request.assigned_to && request.assigned_to !== profile.id && !notifiedUserIds.has(request.assigned_to)
    && !!(await followUp(requestId, 'tell the vendor it was reopened', () => tellVendorReopened(requestId, profile.id, profile.full_name, comment?.trim() ?? '', (request.reopen_count ?? 0) + 1, isResolvedReopen)))
  if (reopenedForVendor && request.assigned_to) notifiedUserIds.add(request.assigned_to)
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
    const { data: assignee } = await supabase.from('profiles').select('full_name').eq('id', request.assigned_to).maybeSingle()   // (a missing name only changes the wording below)
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
  let writtenCommentId: string | undefined
  if (comment?.trim()) {
    const { data: written, error: commentError } = await createAdminClient().from('request_comments').insert({
      request_id: requestId,
      author_id: profile.id,
      body: comment.trim(),
      is_internal: false,
    }).select('id').single()
    writtenCommentId = written?.id
    if (commentError) {
      logger.error({ event: 'status_change.comment_failed', message: 'The status was changed but its comment could not be saved', route: 'lib/requests/status-change.ts#applyStatusChange', requestId, errorCode: 'comment_insert_failed', error: commentError })
      // Status was updated and logged — do not roll back for a failed comment
    }
  }

  // Business Rules: "updated" trigger — status changes count as an edit.
  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('updated', requestId)
  } catch (e) {
    logger.error({ event: 'status_change.rules_failed', message: 'The status was changed but the Business Rules (updated) failed', route: 'lib/requests/status-change.ts#applyStatusChange', requestId, errorCode: 'business_rules_failed', error: e })
  }

  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/requests')
  revalidatePath('/home')

  return { commentId: writtenCommentId }
}

