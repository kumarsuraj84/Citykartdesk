'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireModuleEnabled } from '@/lib/actions/moduleGuard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

export async function starReview(
  reviewId: string,
  starred: boolean,
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !INTAKE_ROLES.includes(profile.role)) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const supabase: AnyClient = createAdminClient()
  const { error } = await supabase
    .from('intake_reviews')
    .update({ is_starred: starred })
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }
  revalidatePath('/intake/inbox')
  return {}
}

export async function escalateReview(
  reviewId: string,
  escalated: boolean,
  note?: string,
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !INTAKE_ROLES.includes(profile.role)) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const supabase: AnyClient = createAdminClient()
  const { error } = await supabase
    .from('intake_reviews')
    .update({
      is_escalated: escalated,
      escalation_note: escalated ? (note ?? null) : null,
    })
    .eq('id', reviewId)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }
  revalidatePath('/intake/inbox')
  revalidatePath(`/intake/review/${reviewId}`)
  return {}
}
