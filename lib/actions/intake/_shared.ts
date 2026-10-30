import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/observability/logger'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// intake.review ≈ agent+. Enforced in server actions AND in RLS (defence in depth).
export function canReview(role: string | null | undefined): boolean {
  return !!role && ['agent', 'manager', 'admin', 'platform_owner'].includes(role)
}

// Append an entry to the intake audit trail. Best-effort; never throws.
export async function logIntakeAudit(entry: {
  orgId: string
  actorId: string | null
  entityId: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = createAdminClient() as unknown as AnyClient
    // The database client never throws for a failed write: it hands the failure back in `error`. The old try/catch around the bare await therefore never caught
    // anything, and a lost audit entry vanished without a trace. The audit stays best-effort, but a failure is now logged.
    const { error } = await admin.from('intake_audit_log').insert({
      org_id: entry.orgId,
      actor_id: entry.actorId,
      entity_type: 'review',
      entity_id: entry.entityId,
      action: entry.action,
      metadata: entry.metadata ?? {},
    })
    if (error) logger.error({ event: 'intake.audit_write_failed', message: 'An intake audit entry could not be written.', orgId: entry.orgId, errorCode: error.code, context: { action: entry.action, entityId: entry.entityId }, error })
  } catch (e) {
    /* audit is best-effort — don't fail the action over a logging error */
    logger.error({ event: 'intake.audit_write_failed', message: 'An intake audit entry could not be written.', orgId: entry.orgId, context: { action: entry.action }, error: e })
  }
}

/** Logs the error of a database write whose result a caller does not otherwise act on, and hands the error back so a caller that cares can. */
export function loggedWriteError(where: string, result: { error?: { message?: string; code?: string } | null } | null | undefined): { message?: string; code?: string } | null {
  const error = result?.error ?? null
  if (error) logger.error({ event: 'intake.write_failed', message: `A database write failed in ${where}.`, errorCode: error.code, context: { where }, error })
  return error
}
