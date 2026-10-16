'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { recordAudit } from '@/lib/syslog/audit'
import { POLICY_OPTIONS, type PolicyKey } from '@/lib/permissions/matrix'
import { loadPolicies, invalidatePolicies, requireCapability } from '@/lib/permissions/policies'

/** Change one "who may change what" switch. Platform owners only; every change is written to the audit trail. */
export async function setPolicy(key: string, value: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  const denied = await requireCapability(profile, 'platform.policies.write')
  if (denied || !profile) return { error: denied ?? 'Unauthorized.' }
  if (!(key in POLICY_OPTIONS) || !(POLICY_OPTIONS[key as PolicyKey] as readonly string[]).includes(value)) return { error: 'That is not a valid setting.' }

  const before = (await loadPolicies())[key as PolicyKey]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('app_settings').upsert({ key: `policy.${key}`, value }, { onConflict: 'key' })
  if (error) return { error: 'Could not save the setting. Please try again.' }
  invalidatePolicies()
  await recordAudit({ category: 'security', action: 'policy.changed', entityType: 'policy', entityLabel: key, before: { value: before }, after: { value }, actorId: profile.id, orgId: profile.org_id ?? undefined })
  revalidatePath('/admin/settings')
  return {}
}
