#!/usr/bin/env node
/**
 * Runs ONE scheduled job against the LOCAL app, the way the Windows task does it on the server (same runner: scripts/cron-tick.mjs).
 *
 *   node scripts/local-run-job.mjs scheduled-reports        sends the scheduled reports that are due
 *   node scripts/local-run-job.mjs automation-retry         finishes the automatic steps of new tickets
 *   node scripts/local-run-job.mjs pms-daily                makes the PMS tickets of today
 *
 * It takes CRON_SECRET from .env.local (never printed) and talks to http://localhost:3210 (or CK_LOCAL_URL). It REFUSES any address that is not this PC,
 * so it can never be pointed at a server by accident.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const job = process.argv[2]
if (!job) { console.error('Usage: node scripts/local-run-job.mjs <job name>   (for example scheduled-reports)'); process.exit(2) }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = path.join(root, '.env.local')
if (!fs.existsSync(envFile)) { console.error('.env.local not found: run this from the project folder'); process.exit(2) }
const env = {}
for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)
  if (m && !l.trimStart().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const target = process.env.CK_LOCAL_URL || 'http://localhost:3210'
let host
try { host = new URL(target).hostname } catch { console.error(`not a valid address: ${target}`); process.exit(2) }
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) { console.error(`REFUSED: ${target} is not this PC. This helper only talks to the local app.`); process.exit(2) }
if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) { console.error('CRON_SECRET in .env.local is missing or shorter than 16 characters'); process.exit(2) }

const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'cron-tick.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, CRON_SECRET: env.CRON_SECRET, CRON_TARGET_URL: target, CRON_JOBS: job },
})
process.exit(r.status ?? 1)
