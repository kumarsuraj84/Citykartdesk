'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReview, logIntakeAudit } from './_shared'
import { requireModuleEnabled } from '@/lib/actions/moduleGuard'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { collectFields, buildFormData } from '@/lib/intake/autofill'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkType = 'request' | 'task' | 'approval' | 'informational' | 'ignore'
type IntakePriority = 'low' | 'medium' | 'high' | 'urgent'
type RequestPriority = 'low' | 'medium' | 'high' | 'urgent'
type TaskPriority = 'low' | 'medium' | 'high'
// Classifications that create no work item — just record the decision.
type NoWorkType = 'informational' | 'ignore'

interface Decision {
  final_type: WorkType
  final_department: string | null
  final_category: string | null
  final_subcategory: string | null
  final_priority: IntakePriority
  decision_notes?: string
}

export type WorkPayload =
  | {
      type: 'request'; title: string; description: string; service_id: string; team_id: string
      /** Selected from the service's own tagged Sub-Categories (see
       *  getTaggedSubCategoriesForService()) — re-validated server-side
       *  against that exact set by createRequestCore(), never trusted as-is. */
      sub_category_id?: string
      /** Reviewer-supplied values for whichever requester-mandatory fields
       *  the entity autofill (buildFormData()) couldn't fill — merged on top
       *  of the autofilled values, then re-validated server-side by
       *  createRequestCore() via validateRequesterFormCompletion() exactly
       *  like every other channel. */
      additional_form_data?: Record<string, unknown>
    }
  | { type: 'task';     title: string; description: string; team_id: string }
  | {
      type: 'approval'; title: string; description: string; service_id: string; team_id: string
      sub_category_id?: string
      additional_form_data?: Record<string, unknown>
    }
  | { type: 'informational' }
  | { type: 'ignore' }

export type WorkResult =
  | { ok: true;  workType: Exclude<WorkType, NoWorkType>; workId: string; workNo?: string; workUrl: string }
  | { ok: true;  workType: NoWorkType }
  | { ok: false; error: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapPriorityToRequest(p: IntakePriority): RequestPriority { return p }
function mapPriorityToTask(p: IntakePriority): TaskPriority {
  // task_priority enum has no 'urgent' — cap at 'high'
  return p === 'urgent' ? 'high' : p
}

function buildSourceMetadata(review: {
  id: string
  message_id: string
  suggested_type: string | null
  suggested_department: string | null
  suggested_priority: string | null
  suggested_confidence: number | null
  was_overridden: boolean
}): Record<string, unknown> {
  return {
    intake_review_id:     review.id,
    intake_message_id:    review.message_id,
    suggested_type:       review.suggested_type,
    suggested_department: review.suggested_department,
    suggested_priority:   review.suggested_priority,
    suggested_confidence: review.suggested_confidence,
    was_overridden:       review.was_overridden,
    created_via:          'intake',
  }
}

// F3 entity-autofill (collectFields/buildFormData) now lives in
// lib/intake/autofill.ts — a plain module (not inside this 'use server'
// file) so the Review UI can import and run the exact same pure functions
// client-side for a live "what's still missing" preview, instead of
// duplicating this logic.

// ── Main action ───────────────────────────────────────────────────────────────

// Approves a review and optionally creates a work item in one atomic operation.
// Reads final_* columns only — completely provider-agnostic.
export async function approveAndCreate(
  reviewId: string,
  decision: Decision,
  payload: WorkPayload,
): Promise<WorkResult> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { ok: false, error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { ok: false, error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient

  // Load the review and its current state. Scope to the caller's org so a review
  // from another tenant can never be acted on (the admin client bypasses RLS).
  const { data: review, error: rErr } = await admin
    .from('intake_reviews')
    .select(`
      id, state, org_id, message_id, thread_id,
      suggested_type, suggested_department, suggested_priority, suggested_confidence,
      final_type, final_priority
    `)
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)
    .maybeSingle()

  if (rErr || !review) return { ok: false, error: 'Review not found.' }
  if (review.state === 'converted') return { ok: false, error: 'Review already converted to a work item.' }
  if (review.state === 'rejected')  return { ok: false, error: 'Rejected reviews cannot be converted.' }

  const now = new Date().toISOString()
  const wasOverridden =
    decision.final_type       !== review.suggested_type       ||
    decision.final_department !== review.suggested_department ||
    decision.final_priority   !== review.suggested_priority

  // ── 1. Claim if still pending ──────────────────────────────────────────────
  if (review.state === 'pending') {
    await admin.from('intake_reviews').update({
      state: 'in_review',
      assigned_reviewer_id: profile.id,
    }).eq('id', reviewId)
  }

  // ── 2. No-work types (informational / ignore): approve, create nothing ─────
  if (payload.type === 'informational' || payload.type === 'ignore') {
    await admin.from('intake_reviews').update({
      state: 'approved',
      final_type:        decision.final_type,
      final_department:  decision.final_department,
      final_category:    decision.final_category,
      final_subcategory: decision.final_subcategory,
      final_priority:    decision.final_priority,
      decision_notes:    decision.decision_notes ?? null,
      was_overridden:    wasOverridden,
      reviewed_by:       profile.id,
      reviewed_at:       now,
    }).eq('id', reviewId)
    await admin.from('intake_messages').update({ status: 'actioned' }).eq('id', review.message_id)
    await logIntakeAudit({
      orgId: review.org_id, actorId: profile.id, entityId: reviewId,
      action: 'review_approved', metadata: { final_type: decision.final_type, work: 'none' },
    })
    revalidatePath('/intake/queue'); revalidatePath('/intake/inbox')
    return { ok: true, workType: payload.type }
  }

  // ── 3. Create work item ────────────────────────────────────────────────────

  const sourceMetadata = buildSourceMetadata({
    ...review,
    was_overridden: wasOverridden,
  })

  if (payload.type === 'request' || payload.type === 'approval') {
    // Verify service and team exist in this org. Pull the form schema so we can
    // pre-fill form_data (F3) — createRequestCore() re-resolves the service
    // itself for the actual snapshot/SLA/title/priority derivation below, so
    // this fetch exists only to feed buildFormData(), a purely intake-specific
    // pre-processing step the core knows nothing about.
    const [{ data: svc }, { data: team }, { data: cls }] = await Promise.all([
      admin.from('services').select('id, name, team_id, form_fields, form_sections, template:form_templates(form_sections)').eq('id', payload.service_id).maybeSingle(),
      admin.from('teams').select('id').eq('id', payload.team_id).maybeSingle(),
      admin.from('intake_classifications').select('entities').eq('message_id', review.message_id).eq('is_final', true).maybeSingle(),
    ])
    if (!svc) return { ok: false, error: 'Selected service not found.' }
    if (!team) return { ok: false, error: 'Selected team not found.' }

    // Autofill the service's fields from extracted entities + the email text,
    // then layer the reviewer's own answers for whatever the autofill
    // couldn't reliably infer (select/radio/multiselect/checkbox/phone/toggle,
    // or a text field with an unrecognized label) on top — see WorkPayload's
    // additional_form_data doc comment. Reviewer-supplied values win.
    const entities = (cls?.entities ?? {}) as Parameters<typeof buildFormData>[1]
    const resolvedFields = collectFields(svc)
    const autoFilledFormData = buildFormData(resolvedFields, entities, payload.title, payload.description || '')
    const formData = { ...autoFilledFormData, ...(payload.additional_form_data ?? {}) }

    // Shared ticket-creation core (lib/requests/create-request-core.ts) — the
    // same path lib/actions/requests.ts#createRequest() uses for the portal.
    // This is a deliberate behavior change from the previous direct insert,
    // requested explicitly by the Stage 1 brief ("Tickets created from Email
    // Intake should also correctly receive SLA / priority / Business Rules /
    // assignment / activity / normal notifications / normal validation."):
    //   - requests.response_due_at/resolution_due_at are now actually set
    //     (previously always null for every intake-created ticket — see
    //     lib/sla/resolve.ts's own doc comment on this exact gap).
    //   - runRulesForTrigger('created', ...) now fires (previously never
    //     called for this path), so Business Rules auto-assignment/priority/
    //     status/notify now applies to intake-created tickets too.
    //   - the shared mandatory-field completion gate
    //     (validateRequesterFormCompletion) now applies: a service whose
    //     required select/radio/multiselect/toggle/phone/checkbox field isn't
    //     populated by buildFormData()'s conservative text/date/number/email-
    //     only autofill, or a service with tagged Sub-Categories, will
    //     surface a clear "<Field> is required."/"Category is required."
    //     error here instead of silently creating an incomplete ticket the
    //     way the old direct insert did. Stage 1.1 gave the Review UI a way
    //     to resolve this before conversion — see additional_form_data/
    //     sub_category_id above and getServiceRequesterForm() below — so this
    //     is reachable only if the reviewer submits without addressing what
    //     the UI already showed them as missing, or via a direct call to this
    //     action bypassing the UI.
    //
    // subCategoryId is passed straight through and NOT pre-validated here —
    // createRequestCore() re-validates it against this exact service's
    // tagged Sub-Category set (service_sub_category_tags), which is itself
    // implicitly org-scoped (a sub-category can only ever be tagged to one
    // service, in one org — see the discovery/security review notes on this
    // exclusivity constraint), so a cross-org or otherwise-invalid id is
    // rejected there, not trusted from the reviewer's submission.
    const coreResult = await createRequestCore({
      client: admin,
      orgId: review.org_id,
      requesterId: profile.id,
      actingUserId: profile.id,
      serviceId: payload.service_id,
      subCategoryId: payload.sub_category_id ?? null,
      formData,
      description: payload.description || null,
      source: 'email_intake',
      intakeMessageId: review.message_id,
      sourceMetadata,
      useAdminForWrites: true,
      // Email Intake lets a reviewer route to a different team than the
      // service's own default — a real, pre-existing capability of this one
      // channel (see WorkPayload's team_id), preserved unchanged.
      teamIdOverride: payload.team_id,
      // decision.final_priority is the reviewer's confirmed-or-overridden
      // classification (see approveAndCreate()'s own wasOverridden check
      // just above), not a raw, unreviewed value straight from the original
      // message — trusted the same way createRequestCore()'s own doc comment
      // on priorityOverride describes. Preserves this channel's pre-existing
      // priority behavior exactly; without this, routing through the shared
      // core would silently discard the reviewer's priority decision in
      // favor of the service's bare default.
      priorityOverride: mapPriorityToRequest(decision.final_priority),
    })

    if (coreResult.error || !coreResult.requestId || !coreResult.requestNo) {
      return { ok: false, error: coreResult.error ?? 'Failed to create request.' }
    }
    const req = { id: coreResult.requestId, request_no: coreResult.requestNo }

    let approvalId: string | null = null

    if (payload.type === 'approval') {
      // Find a workflow (prefer service's workflow, fall back to default).
      const { data: svcWithWf } = await admin
        .from('services')
        .select('approval_workflow_id')
        .eq('id', payload.service_id)
        .maybeSingle()

      const workflowId =
        (svcWithWf as { approval_workflow_id?: string | null } | null)?.approval_workflow_id ??
        (await admin.from('approval_workflows').select('id').eq('org_id', review.org_id).limit(1).maybeSingle()).data?.id ??
        null

      if (workflowId) {
        const { data: appr } = await admin
          .from('approvals')
          .insert({ request_id: req.id, workflow_id: workflowId, status: 'pending' })
          .select('id')
          .single()
        approvalId = appr?.id ?? null
        // createRequestCore() always creates the ticket 'open' (matching the
        // portal's own createRequest(), which never auto-enters approval
        // either — see its doc comment). The 'approval' payload type's extra
        // "start life already pending_approval" behavior is specific to this
        // one channel, so it's applied here as a follow-up, exactly the way
        // the portal's own submitForApproval() is already a separate step
        // from creation, not folded into the shared core.
        if (approvalId) {
          await admin.from('requests').update({ status: 'pending_approval' }).eq('id', req.id)
        }
      }
    }

    // Update review: mark converted, store reverse links, persist final classification.
    await admin.from('intake_reviews').update({
      state:              'converted',
      final_type:         decision.final_type,
      final_department:   decision.final_department,
      final_category:     decision.final_category,
      final_subcategory:  decision.final_subcategory,
      final_priority:     decision.final_priority,
      decision_notes:     decision.decision_notes ?? null,
      was_overridden:     wasOverridden,
      reviewed_by:        profile.id,
      reviewed_at:        now,
      created_request_id: req.id,
      created_approval_id: approvalId,
    }).eq('id', reviewId)

    await admin.from('intake_messages').update({ status: 'actioned' }).eq('id', review.message_id)
    await logIntakeAudit({
      orgId: review.org_id, actorId: profile.id, entityId: reviewId,
      action: 'review_converted', metadata: { work_type: payload.type, request_id: req.id, approval_id: approvalId },
    })
    revalidatePath('/intake/queue'); revalidatePath('/intake/inbox')

    return {
      ok:      true,
      workType: payload.type,
      workId:   req.id,
      workNo:   req.request_no,
      workUrl:  `/requests/${req.id}`,
    }
  }

  if (payload.type === 'task') {
    const { data: team } = await admin
      .from('teams')
      .select('id')
      .eq('id', payload.team_id)
      .maybeSingle()
    if (!team) return { ok: false, error: 'Selected team not found.' }

    const taskPriority = mapPriorityToTask(decision.final_priority)

    const { data: task, error: taskErr } = await admin
      .from('tasks')
      .insert({
        title:             payload.title,
        description:       payload.description || null,
        task_type:         'team',
        team_id:           payload.team_id,
        created_by:        profile.id,
        org_id:            review.org_id,
        priority:          taskPriority,
        status:            'open',
        intake_message_id: review.message_id,
        source_metadata:   sourceMetadata,
      })
      .select('id')
      .single()

    if (taskErr || !task) return { ok: false, error: taskErr?.message ?? 'Failed to create task.' }

    await admin.from('intake_reviews').update({
      state:           'converted',
      final_type:       decision.final_type,
      final_department: decision.final_department,
      final_category:   decision.final_category,
      final_subcategory: decision.final_subcategory,
      final_priority:   decision.final_priority,
      decision_notes:   decision.decision_notes ?? null,
      was_overridden:   wasOverridden,
      reviewed_by:      profile.id,
      reviewed_at:      now,
      created_task_id:  task.id,
    }).eq('id', reviewId)

    await admin.from('intake_messages').update({ status: 'actioned' }).eq('id', review.message_id)
    await logIntakeAudit({
      orgId: review.org_id, actorId: profile.id, entityId: reviewId,
      action: 'review_converted', metadata: { work_type: 'task', task_id: task.id },
    })
    revalidatePath('/intake/queue'); revalidatePath('/intake/inbox')

    return {
      ok:      true,
      workType: 'task',
      workId:   task.id,
      workUrl:  `/tasks/${task.id}`,
    }
  }

  return { ok: false, error: 'Unhandled payload type.' }
}

// Converts a message to work directly from the inbox (no prior review required).
// Creates or reuses the intake_review row, then creates the work item.
export async function convertToWork(
  messageId: string,
  payload: Exclude<WorkPayload, { type: 'ignore' | 'informational' }>,
): Promise<WorkResult> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { ok: false, error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { ok: false, error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient

  // Get the message, scoped to the caller's org (admin client bypasses RLS).
  const { data: msg } = await admin
    .from('intake_messages')
    .select('id, org_id, thread_id')
    .eq('id', messageId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!msg) return { ok: false, error: 'Message not found.' }

  // Get or create a review for this message — keep the full suggested snapshot so
  // we can preserve the classified priority/department instead of flattening it.
  const reviewCols = 'id, state, suggested_type, suggested_department, suggested_category, suggested_subcategory, suggested_priority'
  let { data: review } = await admin
    .from('intake_reviews')
    .select(reviewCols)
    .eq('message_id', messageId)
    .maybeSingle()

  if (!review) {
    const { data: created } = await admin
      .from('intake_reviews')
      .insert({
        org_id: msg.org_id,
        message_id: messageId,
        thread_id: msg.thread_id ?? null,
        state: 'in_review',
        assigned_reviewer_id: profile.id,
        // No prior classification: seed suggested == final so the conversion
        // isn't spuriously flagged as an override.
        suggested_type: payload.type,
        suggested_priority: 'medium',
        suggested_confidence: 0,
        final_type: payload.type,
        final_priority: 'medium',
        was_overridden: false,
      })
      .select(reviewCols)
      .single()
    review = created
  }

  if (!review) return { ok: false, error: 'Could not create review record.' }
  if (review.state === 'converted') return { ok: false, error: 'Already converted.' }

  // Build the decision from the review's suggested snapshot — preserves the
  // classified priority/department/category; only the work type reflects the
  // reviewer's explicit choice. approveAndCreate recomputes was_overridden from
  // these, so it's true only when the chosen type differs from the suggestion.
  const decision: Decision = {
    final_type: payload.type,
    final_department: review.suggested_department ?? null,
    final_category: review.suggested_category ?? null,
    final_subcategory: review.suggested_subcategory ?? null,
    final_priority: (review.suggested_priority as IntakePriority | null) ?? 'medium',
  }

  return approveAndCreate(review.id, decision, payload)
}

// ── Reclassify: Change classification after conversion ────────────────────────
// Allows changing Approval→Task, Task→Request, priority, department, etc
// even after the work item was created. Marks the decision change in audit log.
export async function reclassifyReview(
  reviewId: string,
  newDecision: Partial<Decision>,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { ok: false, error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { ok: false, error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient

  // Load the review
  const { data: review } = await admin
    .from('intake_reviews')
    .select('id, state, org_id, final_type, final_priority, final_department, final_category, final_subcategory')
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)
    .maybeSingle()

  if (!review) return { ok: false, error: 'Review not found.' }
  if (review.state !== 'converted') return { ok: false, error: 'Review must be in converted state to reclassify.' }

  const oldType = review.final_type
  const newType = newDecision.final_type ?? oldType

  // Update the review with new classification
  await admin
    .from('intake_reviews')
    .update({
      final_type:        newType,
      final_priority:    newDecision.final_priority ?? review.final_priority,
      final_department:  newDecision.final_department ?? review.final_department,
      final_category:    newDecision.final_category ?? review.final_category,
      final_subcategory: newDecision.final_subcategory ?? review.final_subcategory,
      decision_notes:    newDecision.decision_notes ?? null,
    })
    .eq('id', reviewId)

  // Log the reclassification
  await logIntakeAudit({
    orgId: review.org_id,
    actorId: profile.id,
    entityId: reviewId,
    action: 'review_reclassified',
    metadata: {
      old_type: oldType,
      new_type: newType,
      old_priority: review.final_priority,
      new_priority: newDecision.final_priority,
    },
  })

  revalidatePath('/intake/queue')
  revalidatePath('/intake/inbox')
  revalidatePath('/intake/review')

  return {
    ok: true,
    message: `Classification updated: ${oldType} → ${newType}`,
  }
}
