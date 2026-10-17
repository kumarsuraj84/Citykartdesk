// Checks the secrets in an environment file WITHOUT printing any value:  node scripts/check-secrets.mjs <path to the app's .env.local>
// Reports secrets that are missing, shorter than 16 characters, or used for two purposes, and whether the transitional ALLOW_SHARED_SECRET_FALLBACK switch is on
// (VAPT-030). The owner runs it on the server before a release; the assessment never reads the real file.
import { readFileSync } from 'node:fs'
import { argv, exit } from 'node:process'

const file = argv[2]
if (!file) { console.error('usage: node scripts/check-secrets.mjs <env file>'); exit(2) }
const env = {}
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

// keep in step with lib/secrets.ts
const NAMES = ['APPROVAL_LINK_SECRET', 'CSAT_LINK_SECRET', 'OAUTH_STATE_SECRET', 'INTAKE_WEBHOOK_TOKEN', 'INTAKE_WORKER_SECRET', 'SYSTEM_LOG_INGEST_SECRET', 'CRON_SECRET']
const issues = []
const seen = new Map()
for (const name of NAMES) {
  const v = env[name]
  if (!v) { issues.push(`${name}: not set`); continue }
  if (v.length < 16) issues.push(`${name}: shorter than 16 characters`)
  if (seen.has(v)) issues.push(`${name}: the same value as ${seen.get(v)}`); else seen.set(v, name)
}
// Other settings that decide whether the protections work (VAPT-066 / VAPT-044 / VAPT-065 / VAPT-042)
const hops = Number(env.TRUSTED_PROXY_HOPS ?? 0)
if (!Number.isInteger(hops) || hops < 1) issues.push('TRUSTED_PROXY_HOPS: not set (1 when one reverse proxy is in front of the app). Without it the caller\'s address is unknown: per-address limits are off and no address is written to the logs')
if (env.ATTACHMENT_SCANNER && !env.ATTACHMENT_SCANNER_HOST) issues.push('ATTACHMENT_SCANNER is set but ATTACHMENT_SCANNER_HOST is missing: uploads will be refused as "cannot be checked"')
if (!env.ATTACHMENT_SCANNER) issues.push('ATTACHMENT_SCANNER: not set - uploaded files are NOT checked by a virus scanner (type, signature and macro checks only). A decision for the owner')
if ((env.GMAIL_PUSH_OIDC_AUDIENCE ? 1 : 0) !== (env.GMAIL_PUSH_OIDC_EMAIL ? 1 : 0)) issues.push('GMAIL_PUSH_OIDC_AUDIENCE and GMAIL_PUSH_OIDC_EMAIL must be set together')
if (!env.GMAIL_PUSH_OIDC_AUDIENCE) issues.push('GMAIL_PUSH_OIDC_*: not set - Gmail push deliveries are checked by the shared URL token only (Google\'s signed token is not required). Only matters if a Gmail channel is used')
if (env.ALLOW_SHARED_SECRET_FALLBACK === '1') issues.push('ALLOW_SHARED_SECRET_FALLBACK: the transitional switch is ON (remove it once every secret above is set)')
if (issues.length === 0) { console.log('OK: every purpose has its own secret of at least 16 characters.'); exit(0) }
for (const i of issues) console.log('FIX  ' + i)
exit(1)
