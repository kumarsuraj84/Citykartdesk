// Health & Performance (platform monitoring): the list of checks and their limits. Pure (no database), so the wording and the limits are easy to test and to change.
// Visible to PLATFORM OWNERS only (lib/health/access.ts): nobody else sees the page, the menu entry or the alert.

export type CheckGroup = 'core' | 'sync'
export type CheckDef = {
  key: string
  label: string
  group: CheckGroup
  /** who measures it: 'probe' = the one-minute probe on the app server (it can say "down" even when the app is dead), 'app' = the app itself */
  by: 'probe' | 'app'
  /** one plain line: what "good" means */
  good: string
}

export const CHECKS: CheckDef[] = [
  { key: 'app', label: 'CK Desk app', group: 'core', by: 'probe', good: 'the app answers its health address' },
  { key: 'database', label: 'Database', group: 'core', by: 'app', good: 'a simple question is answered by the database' },
  { key: 'auth', label: 'Sign-in service', group: 'core', by: 'app', good: 'the sign-in service answers' },
  { key: 'storage', label: 'File service', group: 'core', by: 'app', good: 'the file service answers' },
  { key: 'postgrest', label: 'Data service (PostgREST)', group: 'core', by: 'probe', good: 'the data service answers' },
  { key: 'proxy', label: 'Gateway (proxy)', group: 'core', by: 'probe', good: 'the gateway in front of the services answers' },
  { key: 'nas_files', label: 'File storage (NAS)', group: 'core', by: 'probe', good: 'the NAS folder of CK Desk files can be opened' },
  { key: 'sync_zoho', label: 'Zoho sync', group: 'sync', by: 'app', good: 'a good Zoho sync run in the last 30 minutes' },
  { key: 'sync_google_sheets', label: 'Google Sheet syncs (AC, Genset, CVM, PMS)', group: 'sync', by: 'app', good: 'every sheet checked in the last 26 hours without an error' },
  { key: 'sync_email', label: 'E-mail intake poll', group: 'sync', by: 'app', good: 'every active mailbox polled in the last 20 minutes' },
  { key: 'sync_weather', label: 'Weather (daily)', group: 'sync', by: 'app', good: 'today\'s weather loaded' },
]

export const CHECK_BY_KEY = new Map(CHECKS.map((c) => [c.key, c]))
export const labelOf = (key: string) => CHECK_BY_KEY.get(key)?.label ?? key

/** An incident opens after this many failed checks IN A ROW (one lost answer is not an outage). */
export const INCIDENT_AFTER = 3

/** How old a sync may be before it counts as late. */
export const SYNC_LIMITS = { zohoMinutes: 30, emailMinutes: 20, sheetsHours: 26 } as const

/** A check that has no sample for this long (the probe stopped) is shown as "no data", not as good. */
export const STALE_AFTER_MINUTES = 5
