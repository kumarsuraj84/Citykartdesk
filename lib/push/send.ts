import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''
export const PUSH_ENABLED = !!VAPID_PUBLIC_KEY && !!VAPID_PRIVATE_KEY

if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:support@citykart.org',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  )
}

export type PushPayload = { title: string; body: string; link?: string }

/**
 * Delivers a browser push notification to every device the user has
 * subscribed on. Silently no-ops if VAPID isn't configured (push not set
 * up yet) — same "unconfigured channel is a no-op" pattern as EMAIL_ENABLED.
 * A dead subscription (410 Gone / 404, e.g. permission revoked or browser
 * data cleared) is deleted so it stops being retried on every future event.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!PUSH_ENABLED) return

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (!subs || subs.length === 0) return

  const json = JSON.stringify({
    title: payload.title,
    body: payload.body,
    link: payload.link ?? '/notifications',
  })

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json
        )
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', s.id)
        } else {
          console.error('[sendPushToUser] delivery failed', e)
        }
      }
    })
  )
}
