import 'server-only'
import { flushSystemLog, recordSystemLog } from './record'
import type { Source } from './shape'

export interface AuditEntry {
  action: string
  entityType?: string | null
  entityId?: string | null
  entityLabel?: string | null
  before?: unknown
  after?: unknown
  message?: string | null
  detail?: unknown
  actorId?: string | null
  orgId?: string | null
  /** Sign-in, role, password, deactivation and similar belong to the security category. */
  category?: 'audit' | 'security'
  source?: Source
  outcome?: 'success' | 'failure' | 'denied'
  severity?: 'info' | 'warning'
}

/**
 * Record WHO did WHAT (with before and after values) on purpose, from the application. The database triggers also record row changes,
 * but only the application knows the actor when it uses the server's own client, and the intent ("an administrator reset this password").
 * Never throws; written before this returns, so the row exists by the time the action reports success.
 */
export async function recordAudit(e: AuditEntry): Promise<void> {
  try {
    await recordSystemLog({
      category: e.category ?? 'audit',
      source: e.source ?? 'server_action',
      action: e.action,
      severity: e.severity ?? 'info',
      outcome: e.outcome ?? 'success',
      entityType: e.entityType, entityId: e.entityId, entityLabel: e.entityLabel,
      before: e.before, after: e.after, message: e.message, detail: e.detail,
      actorId: e.actorId, orgId: e.orgId,
    })
    await flushSystemLog()
  } catch { /* never fail the action over a log */ }
}
