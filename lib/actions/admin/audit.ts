import { createAdminClient } from '@/lib/supabase/admin'
import { recordAudit } from '@/lib/syslog/audit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** Append an entry to the generic admin-configuration audit trail. Best-effort; never throws. */
export async function logAdminAudit(entry: {
  orgId: string
  actorId: string | null
  entityType: string
  entityId: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = createAdminClient() as unknown as AnyClient
    await admin.from('admin_audit_log').insert({
      org_id: entry.orgId,
      actor_id: entry.actorId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      metadata: entry.metadata ?? {},
    })
  } catch {
    /* audit is best-effort — don't fail the action over a logging error */
  }
  // the same entry goes to the System Log, where it is chained and carries the actor's role and the request context
  await recordAudit({ action: entry.action, entityType: entry.entityType, entityId: entry.entityId, after: entry.metadata, orgId: entry.orgId, actorId: entry.actorId, source: 'admin' })
}
