'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { canSeeHealth } from '@/lib/health/access'
import { CHECK_BY_KEY } from '@/lib/health/catalog'
import { logAdminAudit } from './admin/audit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** Switch one health check on or off (for example the Zoho sync, once Zoho is switched off for good). Platform owners only. */
export async function setHealthCheckEnabled(checkKey: string, enabled: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canSeeHealth(profile.role)) return { error: 'Only a platform owner can change this.' }
  if (!CHECK_BY_KEY.has(checkKey)) return { error: 'Unknown check.' }
  if (checkKey === 'app' && !enabled) return { error: 'The app check cannot be switched off.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('health_check_settings').upsert({ check_key: checkKey, enabled: !!enabled, updated_at: new Date().toISOString(), updated_by: profile.id }, { onConflict: 'check_key' })
  if (error) return { error: 'Could not save. Please try again.' }
  if (profile.org_id) await logAdminAudit({ orgId: profile.org_id as string, actorId: profile.id, entityType: 'health_check', entityId: null, action: enabled ? 'health_check_on' : 'health_check_off', metadata: { check: checkKey } })
  revalidatePath('/health')
  return {}
}
