/**
 * Reliable activity logging helper.
 *
 * All request_activity writes must flow through logActivity().
 * Every write is awaited and the error is inspected — no fire-and-forget.
 *
 * This module uses the service-role admin client and must only be called
 * from server-side code ('use server' actions or server components).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { ActivityAction } from '@/types'
import type { Json } from '@/types/database'

export type LogActivityInput = {
  requestId: string
  actorId: string
  action: ActivityAction
  metadata?: Record<string, unknown>
}

export type LogActivityResult = { error?: string }

/**
 * Insert a request_activity row via the admin client.
 *
 * Returns `{}` on success.
 * Returns `{ error: string }` on failure AND logs to stderr.
 * Never throws.
 */
export async function logActivity({
  requestId,
  actorId,
  action,
  metadata = {},
}: LogActivityInput): Promise<LogActivityResult> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('request_activity').insert({
      request_id: requestId,
      actor_id: actorId,
      action,
      metadata: metadata as unknown as Json,
    })

    if (error) {
      console.error('[logActivity] Insert failed', {
        requestId,
        actorId,
        action,
        supabaseError: error.message,
        code: error.code,
      })
      return { error: `Activity log failed: ${error.message}` }
    }

    return {}
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[logActivity] Unexpected error', { requestId, action, message })
    return { error: `Activity log failed: ${message}` }
  }
}
