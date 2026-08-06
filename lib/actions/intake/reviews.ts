'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

type WorkType = 'request' | 'task' | 'approval' | 'ignore'
type Priority = 'low' | 'medium' | 'high' | 'urgent'

// intake.review ≈ agent+. Enforced here and in RLS (defence in depth).
function canReview(role: string): boolean {
  return ['agent', 'manager', 'admin', 'platform_owner'].includes(role)
}

async function logIntakeAudit(entry: {
  orgId: string; actorId: string | null; entityId: string | null; action: string; metadata?: Record<string, unknown>
}) {
  const admin = createAdminClient() as unknown as AnyClient
  await admin.from('intake_audit_log').insert({
    org_id: entry.orgId, actor_id: entry.actorId,
    entity_type: 'review', entity_id: entry.entityId, action: entry.action, metadata: entry.metadata ?? {},
  })
}

// Claim a pending review for triage.
export async function claimReview(reviewId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase
    .from('intake_reviews')
    .update({ state: 'in_review', assigned_reviewer_id: profile.id })
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)
    .in('state', ['pending', 'in_review'])

  if (error) return { error: error.message }
  await logIntakeAudit({ orgId: profile.org_id!, actorId: profile.id, entityId: reviewId, action: 'review_claimed' })
  revalidatePath(`/intake/review/${reviewId}`)
  revalidatePath('/intake/queue')
  return {}
}

export async function assignReviewer(reviewId: string, userId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase
    .from('intake_reviews')
    .update({ assigned_reviewer_id: userId, state: 'in_review' })
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }
  await logIntakeAudit({ orgId: profile.org_id!, actorId: profile.id, entityId: reviewId, action: 'review_assigned', metadata: { userId } })
  revalidatePath(`/intake/review/${reviewId}`)
  return {}
}

export interface ReviewDecision {
  final_type: WorkType
  final_department: string | null
  final_category: string | null
  final_subcategory: string | null
  final_priority: Priority
  decision_notes?: string
}

// Approve (with the suggestion unchanged) OR Modify (with edited final values) —
// both terminate in state='approved'. was_overridden flags whether the reviewer
// changed anything vs the engine's suggestion (feeds the future learning loop).
export async function approveReview(reviewId: string, decision: ReviewDecision): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }

  const supabase = (await createClient()) as unknown as AnyClient

  // Load suggestion to compute was_overridden.
  const { data: existing } = await supabase
    .from('intake_reviews')
    .select('suggested_type, suggested_department, suggested_category, suggested_subcategory, suggested_priority')
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!existing) return { error: 'Review not found.' }

  const wasOverridden =
    existing.suggested_type !== decision.final_type ||
    (existing.suggested_department ?? null) !== (decision.final_department ?? null) ||
    (existing.suggested_category ?? null) !== (decision.final_category ?? null) ||
    (existing.suggested_subcategory ?? null) !== (decision.final_subcategory ?? null) ||
    existing.suggested_priority !== decision.final_priority

  const { error } = await supabase
    .from('intake_reviews')
    .update({
      state: 'approved',
      final_type: decision.final_type,
      final_department: decision.final_department,
      final_category: decision.final_category,
      final_subcategory: decision.final_subcategory,
      final_priority: decision.final_priority,
      was_overridden: wasOverridden,
      decision_notes: decision.decision_notes ?? null,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }
  await logIntakeAudit({
    orgId: profile.org_id!, actorId: profile.id, entityId: reviewId,
    action: wasOverridden ? 'review_modified' : 'review_approved',
    metadata: { final_type: decision.final_type, final_priority: decision.final_priority, was_overridden: wasOverridden },
  })
  revalidatePath('/intake/queue')
  revalidatePath(`/intake/review/${reviewId}`)
  return {}
}

// Reject = the "Ignore" branch. Marks the message rejected too.
export async function rejectReview(reviewId: string, notes?: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { data: review, error } = await supabase
    .from('intake_reviews')
    .update({
      state: 'rejected',
      decision_notes: notes ?? null,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)
    .select('message_id')
    .single()

  if (error) return { error: error.message }

  // Reflect on the source message.
  await supabase.from('intake_messages').update({ status: 'rejected' }).eq('id', review.message_id).eq('org_id', profile.org_id)

  await logIntakeAudit({ orgId: profile.org_id!, actorId: profile.id, entityId: reviewId, action: 'review_rejected' })
  revalidatePath('/intake/queue')
  revalidatePath(`/intake/review/${reviewId}`)
  return {}
}
