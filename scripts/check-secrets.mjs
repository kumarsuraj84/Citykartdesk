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
if (env.ALLOW_SHARED_SECRET_FALLBACK === '1') issues.push('ALLOW_SHARED_SECRET_FALLBACK: the transitional switch is ON (remove it once every secret above is set)')
if (issues.length === 0) { console.log('OK: every purpose has its own secret of at least 16 characters.'); exit(0) }
for (const i of issues) console.log('FIX  ' + i)
exit(1)
