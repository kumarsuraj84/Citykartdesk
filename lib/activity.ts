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
import { logger } from '@/lib/observability/logger'
import type { ActivityAction } from '@/types'
import type { Json } from '@/types/database'

export type LogActivityInput = {
  requestId: string
  /** Nullable for activity with no real portal actor — an emailed reply from someone with
   *  no Citykart Desk account (e.g. an OEM contact); the column itself has always allowed
   *  this. */
  actorId: string | null
  action: ActivityAction
  metadata?: Record<string, unknown>
}

export type LogActivityResult = { error?: string }

/**
 * Insert a request_activity row via the admin client.
 *
 * Returns `{}` on success.
 * Returns `{ error: string }` on failure AND logs it through the structured logger
 * (event "activity.log_failed", so it reaches the System Log).
 * Never throws. A caller whose change is already saved should log and carry on when it gets
 * an error back: it must NOT report the whole action as failed (the user would retry something that already happened).
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
      logger.error({
        event: 'activity.log_failed',
        message: 'A request_activity row could not be written',
        route: 'lib/activity.ts#logActivity',
        requestId,
        actorId: actorId ?? undefined,
        errorCode: 'activity_insert_failed',
        context: { action, dbCode: error.code },
        error,
      })
      return { error: `Activity log failed: ${error.message}` }
    }

    return {}
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({
      event: 'activity.log_failed',
      message: 'A request_activity row could not be written (unexpected error)',
      route: 'lib/activity.ts#logActivity',
      requestId,
      actorId: actorId ?? undefined,
      errorCode: 'activity_unexpected_error',
      context: { action },
      error: err,
    })
    return { error: `Activity log failed: ${message}` }
  }
}
