'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { getIntakeReview } from '@/lib/queries/intake'
import { createAdminClient } from '@/lib/supabase/admin'
import type { IntakeReviewDetail } from '@/lib/queries/intake'

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

export type ReviewDetailBundle = {
  review: IntakeReviewDetail
  attachments: { id: string; file_name: string; file_size: number; mime_type: string | null; signedUrl: string | null }[]
  thread: { id: string; subject: string | null; from_address: string | null; received_at: string | null }[]
  services: { id: string; name: string; team_id: string | null }[]
  teams: { id: string; name: string }[]
}

// Loads everything the 3-pane reading/AI panel needs for one review, mirroring
// the /intake/review/[id] route so the workspace can render it inline without a
// navigation. Returns null if not found or unauthorized.
export async function loadReviewDetail(reviewId: string): Promise<ReviewDetailBundle | null> {
  const profile = await getCurrentProfile()
  if (!profile || !INTAKE_ROLES.includes(profile.role)) return null

  const admin = createAdminClient()
  const [{ review, attachments, thread }, { data: services }, { data: teams }] = await Promise.all([
    getIntakeReview(reviewId),
    admin.from('services').select('id, name, team_id').eq('is_active', true).order('name'),
    admin.from('teams').select('id, name').eq('is_active', true).order('name'),
  ])
  if (!review) return null

  const signedAttachments = await Promise.all(
    attachments.map(async (a) => {
      const { data } = await admin.storage.from('intake-attachments').createSignedUrl(a.storage_path, 300)
      return { ...a, signedUrl: data?.signedUrl ?? null }
    })
  )

  return {
    review,
    attachments: signedAttachments,
    thread,
    services: (services ?? []) as { id: string; name: string; team_id: string | null }[],
    teams: (teams ?? []) as { id: string; name: string }[],
  }
}
