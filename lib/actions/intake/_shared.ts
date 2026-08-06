import { createAdminClient } from '@/lib/supabase/admin'

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
    await admin.from('intake_audit_log').insert({
      org_id: entry.orgId,
      actor_id: entry.actorId,
      entity_type: 'review',
      entity_id: entry.entityId,
      action: entry.action,
      metadata: entry.metadata ?? {},
    })
  } catch {
    /* audit is best-effort — don't fail the action over a logging error */
  }
}
