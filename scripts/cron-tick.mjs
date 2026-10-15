#!/usr/bin/env node
/**
 * Cron tick — pings the scheduled job endpoints with the shared secret.
 *
 * Designed to be run by Railway's native cron (a service with a Cron Schedule
 * that runs `node scripts/cron-tick.mjs` and exits), but works anywhere with
 * Node 18+ (uses built-in fetch, no dependencies).
 *
 * Required env:
 *   CRON_SECRET            shared secret, must match the web service's value
 *   CRON_TARGET_URL        base URL of the deployed app
 *                          (e.g. https://citykart-desk-production.up.railway.app)
 *
 * Optional env:
 *   CRON_JOBS              comma-separated list of jobs to run.
 *                          Defaults to "alerts,business-rules".
 *                          Known names (see JOB_PATHS below): alerts,
 *                          business-rules, desktime-sync, intake-classify. An
 *                          unrecognized name falls back to the legacy
 *                          `/api/<name>/run` shape.
 */

// Known job name -> route path. `alerts`/`business-rules` fit the legacy
// `/api/<name>/run` convention; `desktime-sync`/`intake-classify` don't
// (different route shapes), so they need an explicit mapping.
const JOB_PATHS = {
  alerts: '/api/alerts/run',
  'business-rules': '/api/business-rules/run',
  'desktime-sync': '/api/desktime/sync',
  'intake-classify': '/api/intake/cron/classify',
  'email-reply-sync': '/api/email/inbound-sync',
  csat: '/api/csat/run',
  'system-log-archive': '/api/system-log/archive',
  'approval-reminders': '/api/approvals/reminders',
}

const secret = process.env.CRON_SECRET
const baseUrl = (process.env.CRON_TARGET_URL ?? '').replace(/\/$/, '')
const jobs = (process.env.CRON_JOBS ?? 'alerts,business-rules')
  .split(',')
  .map((j) => j.trim())
  .filter(Boolean)

if (!secret) {
  console.error('CRON_SECRET is not set — aborting.')
  process.exit(1)
}
if (!baseUrl) {
  console.error('CRON_TARGET_URL is not set — aborting.')
  process.exit(1)
}

let failed = 0

// A failed job is also written to the System Log (best effort: if the app itself is down this cannot reach it, and the line above is all there is).
async function reportFailure(job, message, detail) {
  try {
    await fetch(`${baseUrl}/api/system-log/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ entries: [{ category: 'error', source: 'cron', severity: 'error', action: 'cron.job_failed', message: `${job}: ${message}`, errorCode: detail?.status ? String(detail.status) : 'unreachable', detail: { job, ...detail } }] }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* the app is probably down */ }
}

for (const job of jobs) {
  const path = JOB_PATHS[job] ?? `/api/${job}/run`
  const url = `${baseUrl}${path}`
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
    })
    const ms = Date.now() - startedAt
    const body = await res.text()
    if (res.ok) {
      console.log(`✓ ${job} (${res.status}, ${ms}ms): ${body.slice(0, 200)}`)
    } else {
      failed++
      console.error(`✗ ${job} (${res.status}, ${ms}ms): ${body.slice(0, 200)}`)
      await reportFailure(job, `HTTP ${res.status}: ${body.slice(0, 200)}`, { status: res.status, ms })
    }
  } catch (err) {
    failed++
    console.error(`✗ ${job} — request failed:`, err instanceof Error ? err.message : err)
    await reportFailure(job, `request failed: ${err instanceof Error ? err.message : err}`, { ms: Date.now() - startedAt })
  }
}

process.exit(failed > 0 ? 1 : 0)
