'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReview, logIntakeAudit } from './_shared'

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
  | { type: 'request';  title: string; description: string; service_id: string; team_id: string }
  | { type: 'task';     title: string; description: string; team_id: string }
  | { type: 'approval'; title: string; description: string; service_id: string; team_id: string }
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

// F3: pre-fill a service's form fields from entities the classifier extracted
// (intake_classifications.entities) plus the email subject/body. Conservative —
// only fills text/textarea/date/number/email where the label is a clear match;
// selects/radios/checkboxes are left for the reviewer (can't infer reliably).
type SvcField = { id: string; type: string; label?: string; order?: number }

function collectFields(svc: { form_fields?: unknown; form_sections?: unknown }): SvcField[] {
  const sections = Array.isArray(svc.form_sections) ? (svc.form_sections as { order?: number; fields?: SvcField[] }[]) : null
  if (sections?.length) {
    return [...sections]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .flatMap((s) => [...(s.fields ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
  }
  return Array.isArray(svc.form_fields) ? (svc.form_fields as SvcField[]) : []
}

function buildFormData(
  fields: SvcField[],
  entities: { refs?: string[]; amounts?: string[]; dates?: string[]; emails?: string[] },
  subject: string,
  body: string,
): Record<string, unknown> {
  const fd: Record<string, unknown> = {}
  const refs = entities.refs ?? []
  let refIdx = 0
  for (const f of fields) {
    const label = (f.label ?? '').toLowerCase()
    let v: string | undefined
    switch (f.type) {
      case 'textarea':
        if (/detail|descri|note|summary|message|reason|issue|comment/.test(label)) v = body
        break
      case 'text':
        if (/subject|title/.test(label)) v = subject
        else if (/invoice|order|\bref|account|ticket|number|\bid\b|\bpo\b/.test(label) && refs[refIdx]) v = refs[refIdx++]
        break
      case 'date':
        if (entities.dates?.[0]) v = entities.dates[0]
        break
      case 'number':
        if (/amount|cost|price|total|sum|value/.test(label) && entities.amounts?.[0]) v = entities.amounts[0].replace(/[^\d.]/g, '')
        break
      case 'email':
        if (entities.emails?.[0]) v = entities.emails[0]
        break
    }
    if (v !== undefined && v !== '') fd[f.id] = v
  }
  return fd
}

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
    // snapshot it and pre-fill form_data (F3).
    const [{ data: svc }, { data: team }, { data: cls }] = await Promise.all([
      admin.from('services').select('id, name, team_id, form_fields, form_sections').eq('id', payload.service_id).maybeSingle(),
      admin.from('teams').select('id').eq('id', payload.team_id).maybeSingle(),
      admin.from('intake_classifications').select('entities').eq('message_id', review.message_id).eq('is_final', true).maybeSingle(),
    ])
    if (!svc) return { ok: false, error: 'Selected service not found.' }
    if (!team) return { ok: false, error: 'Selected team not found.' }

    const requestPriority = mapPriorityToRequest(decision.final_priority)
    const status = payload.type === 'approval' ? 'pending_approval' : 'open'

    // Autofill the service's fields from extracted entities + the email text.
    const entities = (cls?.entities ?? {}) as Parameters<typeof buildFormData>[1]
    const formData = buildFormData(collectFields(svc), entities, payload.title, payload.description || '')

    const { data: req, error: reqErr } = await admin
      .from('requests')
      .insert({
        request_no:             '',
        title:                  payload.title,
        description:            payload.description || null,
        service_id:             payload.service_id,
        team_id:                payload.team_id,
        requester_id:           profile.id,
        org_id:                 review.org_id,
        priority:               requestPriority,
        status,
        form_data:              formData,
        form_schema_snapshot:   svc.form_fields ?? [],
        form_sections_snapshot: svc.form_sections ?? [],
        intake_message_id:      review.message_id,
        source_metadata:        sourceMetadata,
      })
      .select('id, request_no')
      .single()

    if (reqErr || !req) return { ok: false, error: reqErr?.message ?? 'Failed to create request.' }

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
        (await admin.from('approval_workflows').select('id').limit(1).maybeSingle()).data?.id ??
        null

      if (workflowId) {
        const { data: appr } = await admin
          .from('approvals')
          .insert({ request_id: req.id, workflow_id: workflowId, status: 'pending' })
          .select('id')
          .single()
        approvalId = appr?.id ?? null
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
