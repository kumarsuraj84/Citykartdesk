// One secret per purpose (VAPT-030). Until now many unrelated things fell back to CRON_SECRET: the signed approval and rating links, the sign-in state of the mailbox
// connection, the mail webhooks, the worker, the log intake, even the signature on the "who is this user" header. Learning that one value opened all of them, and
// the Outlook connection even handed it to Microsoft inside a URL.
//
// Now each purpose has its own environment variable, and a missing one means "not available" (the feature is off and says so), never "use another secret".
// For a controlled switch-over there is ONE transitional switch, ALLOW_SHARED_SECRET_FALLBACK=1, which lets the purposes below fall back to CRON_SECRET again; it
// is off by default and is reported by auditSecrets() so it is not forgotten.

export type SecretPurpose = 'approval_link' | 'csat_link' | 'oauth_state' | 'intake_webhook' | 'intake_worker' | 'system_log_ingest' | 'visit_code' | 'cron'

const ENV_NAME: Record<SecretPurpose, string> = {
  approval_link: 'APPROVAL_LINK_SECRET',
  csat_link: 'CSAT_LINK_SECRET',
  oauth_state: 'OAUTH_STATE_SECRET',
  intake_webhook: 'INTAKE_WEBHOOK_TOKEN',
  intake_worker: 'INTAKE_WORKER_SECRET',
  system_log_ingest: 'SYSTEM_LOG_INGEST_SECRET',
  visit_code: 'VISIT_CODE_SECRET',
  cron: 'CRON_SECRET',
}

export const MIN_SECRET_LENGTH = 16
const clean = (v: string | undefined) => (typeof v === 'string' && v.trim() !== '' ? v : null)
export const sharedFallbackAllowed = () => process.env.ALLOW_SHARED_SECRET_FALLBACK === '1'

/** The secret for this purpose, or null when it is not configured (the caller must then refuse / switch the feature off). Never another purpose's secret. */
export function getSecret(purpose: SecretPurpose): string | null {
  const own = clean(process.env[ENV_NAME[purpose]])
  if (own) return own
  if (purpose !== 'cron' && sharedFallbackAllowed()) return clean(process.env.CRON_SECRET)
  return null
}

export const secretEnvName = (purpose: SecretPurpose) => ENV_NAME[purpose]

export type SecretIssue = { purpose: SecretPurpose | 'fallback'; env: string; problem: string }

/** What is wrong with the configured secrets, without ever returning a value: missing, too short, the same value used for two purposes, fallback switch on. */
export function auditSecrets(env: Record<string, string | undefined> = process.env): SecretIssue[] {
  const issues: SecretIssue[] = []
  const seen = new Map<string, string>()
  for (const purpose of Object.keys(ENV_NAME) as SecretPurpose[]) {
    const name = ENV_NAME[purpose]
    const v = clean(env[name])
    if (!v) { issues.push({ purpose, env: name, problem: 'not set' }); continue }
    if (v.length < MIN_SECRET_LENGTH) issues.push({ purpose, env: name, problem: `shorter than ${MIN_SECRET_LENGTH} characters` })
    const other = seen.get(v)
    if (other) issues.push({ purpose, env: name, problem: `the same value as ${other}` })
    else seen.set(v, name)
  }
  if (env.ALLOW_SHARED_SECRET_FALLBACK === '1') issues.push({ purpose: 'fallback', env: 'ALLOW_SHARED_SECRET_FALLBACK', problem: 'the transitional switch that lets purposes use CRON_SECRET is ON: remove it once every secret above is set' })
  return issues
}
