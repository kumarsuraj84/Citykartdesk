'use server'

import { sanitizeError } from '@/lib/observability/sanitize-error'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { isAcceptablePushEndpoint } from '@/lib/push/endpoint'

export type PushSubscriptionInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string
}

export async function subscribeToPush(sub: PushSubscriptionInput): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { error: 'Invalid subscription.' }
  if (!isAcceptablePushEndpoint(sub.endpoint)) return { error: 'Invalid subscription.' } // D-025: public https push services only

  // Written by the server (migration 170: a signed-in user cannot write this table through the data API, which would skip the address check above).
  // Upsert on endpoint: the same browser/device re-subscribing (e.g. after clearing site data) should replace its old row, not accumulate one per permission grant.
  // An endpoint already stored for ANOTHER person is refused (it would take that person's notifications over).
  const admin = createAdminClient()
  const { data: existing } = await admin.from('push_subscriptions').select('user_id').eq('endpoint', sub.endpoint).maybeSingle()
  if (existing && existing.user_id !== profile.id) return { error: 'Invalid subscription.' }
  const { error } = await admin.from('push_subscriptions').upsert(
    {
      user_id: profile.id,
      org_id: profile.org_id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: sub.userAgent ?? null,
    },
    { onConflict: 'endpoint' }
  )

  if (error) return { error: sanitizeError(error, { route: 'push.ts', fallback: 'Something went wrong. Please try again.' }) }
  return {}
}

export async function unsubscribeFromPush(endpoint: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', profile.id)

  if (error) return { error: sanitizeError(error, { route: 'push.ts', fallback: 'Something went wrong. Please try again.' }) }
  return {}
}

/** Whether the current user has at least one active push subscription — drives the profile toggle's initial state. */
export async function hasPushSubscription(): Promise<boolean> {
  const profile = await getCurrentProfile()
  if (!profile) return false

  const supabase = await createClient()
  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)

  return (count ?? 0) > 0
}
