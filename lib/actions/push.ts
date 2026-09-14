'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'

export type PushSubscriptionInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string
}

export async function subscribeToPush(sub: PushSubscriptionInput): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { error: 'Invalid subscription.' }

  const supabase = await createClient()
  // Upsert on endpoint: the same browser/device re-subscribing (e.g. after
  // clearing site data) should replace its old row, not accumulate one per
  // permission grant.
  const { error } = await supabase.from('push_subscriptions').upsert(
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

  if (error) return { error: error.message }
  return {}
}

export async function unsubscribeFromPush(endpoint: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', profile.id)

  if (error) return { error: error.message }
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
