'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { markRequestNotificationsRead } from '@/lib/actions/notifications'

/**
 * Opening this ticket and seeing its status/conversation already is reading whatever
 * it was notified about — silently clears any unread notification bell entries for
 * this one request (only the viewer's own) once per visit, and refreshes the nav
 * badge count so the bell/queue counters don't keep saying "unread".
 */
export function MarkRequestNotificationsRead({ requestId }: { requestId: string }) {
  const router = useRouter()
  const firedFor = useRef<string | null>(null)

  useEffect(() => {
    if (firedFor.current === requestId) return
    firedFor.current = requestId
    markRequestNotificationsRead(requestId)
      .then((res) => { if (res.updated) router.refresh() })
      .catch(() => {})
  }, [requestId, router])

  return null
}
