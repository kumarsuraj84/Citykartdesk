'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { ALL_NOTIFICATION_EVENT_TYPES } from '@/lib/constants/notification-rules'

export type NotificationRuleValues = {
  event_type: string
  email: boolean
  in_app: boolean
  push: boolean
}

/**
 * Every event type in the catalog, with saved overrides merged in. A type
 * with no saved row defaults to every channel on — matches notify()'s own
 * "missing row = always on" behavior, so this list is always a complete,
 * accurate picture of what will actually happen.
 */
export async function getNotificationRules(): Promise<NotificationRuleValues[]> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id) return ALL_NOTIFICATION_EVENT_TYPES.map((event_type) => ({ event_type, email: true, in_app: true, push: true }))

  const admin = createAdminClient()
  const { data } = await admin
    .from('notification_rules')
    .select('event_type, email, in_app, push')
    .eq('org_id', profile.org_id)

  const saved = new Map((data ?? []).map((r) => [r.event_type, r]))
  return ALL_NOTIFICATION_EVENT_TYPES.map((event_type) => {
    const row = saved.get(event_type)
    return {
      event_type,
      email: row?.email ?? true,
      in_app: row?.in_app ?? true,
      push: row?.push ?? true,
    }
  })
}

export async function saveNotificationRules(rules: NotificationRuleValues[]): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Unauthorized.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }

  const validTypes = new Set(ALL_NOTIFICATION_EVENT_TYPES)
  const rows = rules
    .filter((r) => validTypes.has(r.event_type))
    .map((r) => ({
      org_id: profile.org_id!,
      event_type: r.event_type,
      email: r.email,
      in_app: r.in_app,
      push: r.push,
      updated_at: new Date().toISOString(),
    }))
  if (rows.length === 0) return { error: 'No valid rules to save.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('notification_rules')
    .upsert(rows, { onConflict: 'org_id,event_type' })

  if (error) return { error: error.message }
  revalidatePath('/admin/request-config')
  return {}
}
