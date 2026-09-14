'use client'

import { subscribeToPush, unsubscribeFromPush } from '@/lib/actions/push'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

/**
 * Requests notification permission and, if granted, registers the service
 * worker and stores a push subscription for this device. Shared by the
 * profile page's manual toggle and the one-time auto-prompt on login, so
 * both go through the exact same subscribe path.
 */
export async function enablePushOnThisDevice(vapidKey: string): Promise<{ ok: boolean; permission: NotificationPermission }> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, permission }

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
  })
  const raw = subscription.toJSON()
  const result = await subscribeToPush({
    endpoint: subscription.endpoint,
    keys: { p256dh: raw.keys?.p256dh ?? '', auth: raw.keys?.auth ?? '' },
    userAgent: navigator.userAgent,
  })
  return { ok: !result.error, permission }
}

export async function disablePushOnThisDevice(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await unsubscribeFromPush(subscription.endpoint)
    await subscription.unsubscribe()
  }
}
