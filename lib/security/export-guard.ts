// Every export of organisation data is limited per person and written to the audit trail (VAPT-051 / VA-ADM-15).
// The audit entry records who, what kind of export, how many rows and which filters - never the exported contents.
import { sharedRateLimited } from '@/lib/security/shared-limits'
import { recordAudit } from '@/lib/syslog/audit'

/** How many exports one person may start per hour, per kind. High enough for real work, low enough to stop a scripted drain of the data. */
export const EXPORT_LIMIT_PER_HOUR = 30

export const EXPORT_LIMIT_MESSAGE = 'You have exported a lot in the last hour. Please wait a while and try again.'

/** True when this person may start another export of this kind now. Counted in the database, so it holds across restarts and processes. */
export async function exportAllowed(userId: string, kind: string): Promise<boolean> {
  return !(await sharedRateLimited(`export:${kind}:${userId}`, EXPORT_LIMIT_PER_HOUR, 3600))
}

export async function auditExportEvent(
  profile: { id: string; org_id: string | null },
  kind: string,
  rows: number | null,
  filters?: unknown,
): Promise<void> {
  try {
    await recordAudit({
      category: 'security',
      action: `data.exported.${kind}`,
      entityType: kind,
      message: rows == null ? 'export started' : `${rows} rows exported`,
      after: { rows, filters: filters ?? null },
      actorId: profile.id,
      orgId: profile.org_id,
    })
  } catch { /* an audit failure must not break the export the person is entitled to; recordAudit logs its own failure */ }
}

/** Basic shape check of a Report Builder configuration before it reaches the query and workbook code. Returns an error message or null. */
export function checkReportConfigShape(config: unknown): string | null {
  if (!config || typeof config !== 'object') return 'The report settings are not valid.'
  const c = config as { mode?: unknown; columns?: unknown; pivot?: unknown }
  if (c.mode !== 'table' && c.mode !== 'pivot') return 'The report type is not valid.'
  if (!Array.isArray(c.columns) || c.columns.length > 80 || c.columns.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 100)) return 'The report columns are not valid.'
  let size = 0
  try { size = JSON.stringify(c.pivot ?? null).length } catch { return 'The report settings are not valid.' }
  if (size > 20_000) return 'The report settings are too large.'
  return null
}
