'use client'

import { useEffect } from 'react'
import { isPushSupported, enablePushOnThisDevice } from '@/lib/push/client'

// Once per browser/device, not once per page — a user who dismissed or
// denied it on their phone shouldn't get asked again on their laptop, but
// they also shouldn't be asked again on every single page load of the same
// browser once they've been asked once (granted, denied, or ignored).
const STORAGE_KEY = 'push-auto-prompted'

/**
 * Requests push permission automatically the first time a signed-in user
 * opens the app in a given browser — instead of requiring a manual visit to
 * Profile → Notifications. Renders nothing. Safe to mount unconditionally:
 * no-ops when push isn't supported, isn't configured (no VAPID key), the
 * browser has already decided (granted/denied), or this browser has already
 * been asked once before.
 */
export function AutoPushPrompt() {
  useEffect(() => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey || !isPushSupported()) return
    if (Notification.permission !== 'default') return
    if (localStorage.getItem(STORAGE_KEY)) return

    // Mark "already asked" only once the browser actually commits to a
    // decision — requestPermission() can resolve to 'default' itself (e.g.
    // no user gesture in this context) without ever showing a real dialog,
    // and a thrown error (service worker registration failing, a flaky
    // save-subscription call) means the user was never asked at all either
    // way. Setting the flag synchronously before this resolved would wrongly
    // burn the one-time prompt on an attempt nobody actually saw.
    enablePushOnThisDevice(vapidKey)
      .then(({ permission }) => {
        if (permission !== 'default') localStorage.setItem(STORAGE_KEY, '1')
      })
      .catch(() => {
        // Silent — the user can still turn it on later from Profile → Notifications.
      })
  }, [])

  return null
}
