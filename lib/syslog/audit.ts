import 'server-only'
import { flushSystemLog, recordSystemLog } from './record'
import type { Source } from './shape'
import { redactLoginName } from '@/lib/security/login-name'

// An entry of the security category may carry what a person TYPED into a sign-in box (a login name). Whatever is not shaped like an e-mail address is kept
// only as a fingerprint, because people sometimes type their password there and this trail is append-only (audit A-16). Only the keys that hold typed text are looked at.
const TYPED_KEYS = /^(email|login|username|user_name|typed|attempted_login|identifier)$/i
export function scrubTypedLogin(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => scrubTypedLogin(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = typeof v === 'string' && TYPED_KEYS.test(k) ? redactLoginName(v) : scrubTypedLogin(v, depth + 1)
  }
  return out
}

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
      ...(e.category === 'security'
        ? { before: scrubTypedLogin(e.before), after: scrubTypedLogin(e.after), message: e.message, detail: scrubTypedLogin(e.detail) }
        : { before: e.before, after: e.after, message: e.message, detail: e.detail }),
      actorId: e.actorId, orgId: e.orgId,
    })
    await flushSystemLog()
  } catch { /* never fail the action over a log */ }
}
