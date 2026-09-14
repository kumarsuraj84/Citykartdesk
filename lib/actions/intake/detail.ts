'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { getIntakeReview } from '@/lib/queries/intake'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireModuleEnabled } from '@/lib/actions/moduleGuard'
import type { IntakeReviewDetail } from '@/lib/queries/intake'

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

export type ReviewDetailBundle = {
  review: IntakeReviewDetail
  attachments: { id: string; file_name: string; file_size: number; mime_type: string | null; signedUrl: string | null }[]
  thread: { id: string; subject: string | null; from_address: string | null; received_at: string | null }[]
  services: {
    id: string; name: string; team_id: string | null
    form_fields: unknown; form_sections: unknown
    template: { form_sections: unknown } | null
  }[]
  teams: { id: string; name: string }[]
  subCategoriesByService: Record<string, { id: string; name: string }[]>
  entities: { refs?: string[]; amounts?: string[]; dates?: string[]; emails?: string[] }
}

// Loads everything the 3-pane reading/AI panel needs for one review, mirroring
// the /intake/review/[id] route (app/(app)/intake/review/[id]/page.tsx — keep
// both in sync) so the workspace can render it inline without a navigation.
// Returns null if not found or unauthorized.
export async function loadReviewDetail(reviewId: string): Promise<ReviewDetailBundle | null> {
  const profile = await getCurrentProfile()
  if (!profile || !INTAKE_ROLES.includes(profile.role)) return null
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return null

  const admin = createAdminClient()
  const [{ review, attachments, thread }, { data: services }, { data: teams }] = await Promise.all([
    getIntakeReview(reviewId),
    admin
      .from('services')
      .select('id, name, team_id, form_fields, form_sections, template:form_templates(form_sections)')
      .eq('org_id', profile.org_id ?? '')
      .eq('is_active', true)
      .order('name'),
    admin.from('teams').select('id, name').eq('org_id', profile.org_id ?? '').eq('is_active', true).order('name'),
  ])
  if (!review) return null

  const serviceIds = (services ?? []).map((s) => s.id)

  // See app/(app)/intake/review/[id]/page.tsx's matching comment: no org_id
  // column on the junction table, but a Sub-Category can only ever be tagged
  // to one (already org-scoped) service, so this can't surface another org's.
  const { data: subCategoryTags } = serviceIds.length
    ? await admin
        .from('service_sub_category_tags')
        .select('service_id, sub_category:service_sub_categories(id, name, is_active)')
        .in('service_id', serviceIds)
    : { data: [] as { service_id: string; sub_category: { id: string; name: string; is_active: boolean } | null }[] }

  const subCategoriesByService: Record<string, { id: string; name: string }[]> = {}
  for (const row of subCategoryTags ?? []) {
    const sub = row.sub_category as { id: string; name: string; is_active: boolean } | null
    if (!sub || !sub.is_active) continue
    ;(subCategoriesByService[row.service_id] ??= []).push({ id: sub.id, name: sub.name })
  }

  const { data: finalClassification } = await admin
    .from('intake_classifications')
    .select('entities')
    .eq('message_id', review.message_id)
    .eq('is_final', true)
    .maybeSingle()
  const entities = (finalClassification?.entities ?? {}) as {
    refs?: string[]; amounts?: string[]; dates?: string[]; emails?: string[]
  }

  const signedAttachments = await Promise.all(
    attachments.map(async (a) => {
      // { download: ... } forces Content-Disposition: attachment — defense
      // in depth beyond the upload-time allowlist/magic-byte check, so an
      // inbound attachment can never render inline (and execute, for an
      // HTML/SVG part) in the reviewer's browser even if it slipped through.
      const { data } = await admin.storage.from('intake-attachments').createSignedUrl(a.storage_path, 300, { download: a.file_name })
      return { ...a, signedUrl: data?.signedUrl ?? null }
    })
  )

  return {
    review,
    attachments: signedAttachments,
    thread,
    services: (services ?? []) as ReviewDetailBundle['services'],
    teams: (teams ?? []) as { id: string; name: string }[],
    subCategoriesByService,
    entities,
  }
}
