// Citykart Desk push notification service worker.
// Kept deliberately minimal — no offline caching/PWA behavior, just the two
// events push notifications require.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = { title: 'Citykart Desk', body: '', link: '/notifications' }
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() }
    } catch {
      data.body = event.data.text()
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/citykart-desk-icon.png',
      badge: '/citykart-desk-icon.png',
      data: { link: data.link },
      tag: data.link,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = event.notification.data?.link || '/notifications'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((allClients) => {
      for (const client of allClients) {
        if (client.url.includes(link) && 'focus' in client) return client.focus()
      }
      const anyClient = allClients.find((c) => 'focus' in c)
      if (anyClient) {
        anyClient.navigate(link)
        return anyClient.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(link)
    })
  )
})
