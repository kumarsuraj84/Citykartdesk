// How long the System Log and the Event Log are kept, as an administrator sets it in Platform Settings > Retention (saved in app_settings, so no database change is
// needed). The nightly jobs read these numbers: errors and events leave the System Log (moved to its archive, never dropped) after `system_log` days, and Event Log
// rows are deleted after `event_log` days. The Audit Log has its own row in the same Retention list.

export type LogKind = 'system_log' | 'event_log'

export const LOG_RETENTION: Record<LogKind, { key: string; fallback: number; min: number; max: number }> = {
  system_log: { key: 'retention_system_log_days', fallback: 180, min: 30, max: 3650 },
  event_log: { key: 'retention_event_log_days', fallback: 90, min: 7, max: 3650 },
}

export const LOG_RETENTION_KEYS: string[] = Object.values(LOG_RETENTION).map((x) => x.key)

/** The days to keep, from what was saved: anything missing, not a whole number or out of range gives the usual number. */
export function logRetentionDays(kind: LogKind, saved: string | null | undefined): number {
  const r = LOG_RETENTION[kind]
  const n = Number(saved)
  return Number.isInteger(n) && n >= r.min && n <= r.max ? n : r.fallback
}

/** What an administrator typed, checked; the message is for the screen. */
export function checkLogRetentionDays(kind: LogKind, days: number): string | null {
  const r = LOG_RETENTION[kind]
  if (!Number.isInteger(days)) return 'Enter a whole number of days.'
  if (days < r.min) return `Keep at least ${r.min} days.`
  if (days > r.max) return `Keep at most ${r.max} days.`
  return null
}

/** Reads both numbers (the nightly jobs and the Retention screen). */
export async function readLogRetention(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (t: string) => any },
): Promise<Record<LogKind, number>> {
  let rows: { key: string; value: string }[] = []
  try {
    const { data } = await admin.from('app_settings').select('key, value').in('key', LOG_RETENTION_KEYS)
    rows = data ?? []
  } catch { /* the usual numbers apply */ }
  const get = (k: string) => rows.find((r) => r.key === k)?.value
  return { system_log: logRetentionDays('system_log', get(LOG_RETENTION.system_log.key)), event_log: logRetentionDays('event_log', get(LOG_RETENTION.event_log.key)) }
}
