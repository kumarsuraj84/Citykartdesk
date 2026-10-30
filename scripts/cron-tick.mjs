#!/usr/bin/env node
/**
 * Cron tick — pings the scheduled job endpoints with the shared secret.
 *
 * Production: one Windows scheduled task per job runs scripts\windows\run-cron-tick.ps1 -Job <name>, which sets CRON_SECRET / CRON_TARGET_URL /
 * CRON_JOBS and starts this file. (It was written for Railway's cron first; that deployment is retired.) Works anywhere with Node 18+
 * (built-in fetch, no dependencies). Keep this file self-contained: the release scripts copy ONLY this file into app\scripts.
 *
 * Required env:
 *   CRON_SECRET            shared secret, must match the web service's value (at least 16 characters)
 *   CRON_TARGET_URL        base URL of the app (production runner: http://127.0.0.1:3210)
 *
 * Optional env:
 *   CRON_JOBS              comma-separated list of jobs to run. Defaults to "alerts,business-rules".
 *                          Known names: see JOB_PATHS below. An unrecognized name falls back to the legacy `/api/<name>/run` shape.
 *   CRON_TIMEOUT_MS        one timeout for every job (overrides the table below; mostly for tests)
 *
 * WHAT COUNTS AS A FAILURE (exit code 1, printed, and reported to the System Log):
 *   1. any HTTP status that is not 2xx;
 *   2. the request was redirected (a route missing from the proxy's public list ends on the login page with HTTP 200 and does nothing);
 *   3. the request ran longer than the job's timeout (default 9 minutes, see TIMEOUT_MS; the Windows task itself is killed after 10);
 *   4. the answer is HTTP 200 but its JSON body says the work failed. Several job routes answer 200 even when the work failed, because
 *      they keep going after one organization or one step fails. So a JSON body is read and it is a failure when, anywhere in it
 *      (objects only, 4 levels deep, lists are not looked into): `ok` is exactly false, or there is an `error` key with a value
 *      (the per-organization `{ error: 'failed' }` entries of masters/sync and pms/daily, the per-organization entries of desktime/sync).
 *      A body that is not JSON is accepted as long as the status is 2xx.
 *
 * OVERLAP: this script does not lock. Two runs of one job never overlap because each Windows task is registered with
 * `-MultipleInstances IgnoreNew` (a new start is skipped while the previous run is still going); the timeout below is what stops a hung request
 * from blocking every later run of that task until the task's own 10-minute limit.
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
  'masters-sync': '/api/masters/sync',
  'weather-daily': '/api/weather/daily',
  'pms-daily': '/api/pms/daily',
  'automation-retry': '/api/automation/retry',
}

// How long one job may take before it is given up and reported. Default 9 minutes (just under the task's 10-minute limit). A job that runs every
// minute gets a short limit: if it hangs it must not block the following runs for 9 minutes.
const DEFAULT_TIMEOUT_MS = 9 * 60_000
const TIMEOUT_MS = {
  'email-reply-sync': 50_000,
  'automation-retry': 5 * 60_000,
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

const timeoutFor = (job) => {
  const forced = Number(process.env.CRON_TIMEOUT_MS)
  return Number.isFinite(forced) && forced > 0 ? forced : (TIMEOUT_MS[job] ?? DEFAULT_TIMEOUT_MS)
}

/** First place in a JSON answer that says "this failed" (see the list at the top of the file), or null. */
function findBodyFailure(value, where = 'answer', depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.ok === false) return `${where}: ok is false${typeof value.error === 'string' ? ` (${value.error})` : ''}`
  if (value.error) return `${where}: error ${typeof value.error === 'string' ? value.error : JSON.stringify(value.error).slice(0, 100)}`
  for (const [k, v] of Object.entries(value)) {
    const hit = findBodyFailure(v, `${where}.${k}`, depth + 1)
    if (hit) return hit
  }
  return null
}

let failed = 0

// A failed job is also written to the System Log (best effort: if the app itself is down this cannot reach it, and the line printed by the caller is all there is).
// The ingest route accepts the cron secret for entries whose source is 'cron' (and its own SYSTEM_LOG_INGEST_SECRET for anything); the answer is checked,
// because a refused report used to vanish without a trace.
async function reportFailure(job, message, detail) {
  try {
    const res = await fetch(`${baseUrl}/api/system-log/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ entries: [{ category: 'error', source: 'cron', severity: 'error', action: 'cron.job_failed', message: `${job}: ${message}`, errorCode: detail?.status ? String(detail.status) : 'unreachable', detail: { job, ...detail } }] }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error(`! could not record the failure of ${job} in the System Log: the ingest answered ${res.status}`)
  } catch (err) {
    console.error(`! could not record the failure of ${job} in the System Log (the app is probably down): ${err instanceof Error ? err.message : err}`)
  }
}

for (const job of jobs) {
  const path = JOB_PATHS[job] ?? `/api/${job}/run`
  const url = `${baseUrl}${path}`
  const startedAt = Date.now()
  const limit = timeoutFor(job)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), limit)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
      signal: controller.signal,
    })
    const body = await res.text()
    const ms = Date.now() - startedAt
    let problem = null
    if (!res.ok) problem = `HTTP ${res.status}: ${body.slice(0, 200)}`
    else if (res.redirected) problem = `the request was redirected to ${new URL(res.url).pathname} (is the route in the proxy's public list?)`
    else {
      let parsed
      try { parsed = JSON.parse(body) } catch { parsed = undefined }
      const hit = findBodyFailure(parsed)
      if (hit) problem = `HTTP ${res.status} but the work failed — ${hit}`
    }
    if (!problem) {
      console.log(`✓ ${job} (${res.status}, ${ms}ms): ${body.slice(0, 200)}`)
    } else {
      failed++
      console.error(`✗ ${job} (${res.status}, ${ms}ms): ${problem}`)
      await reportFailure(job, problem, { status: res.status, ms })
    }
  } catch (err) {
    failed++
    const ms = Date.now() - startedAt
    const timedOut = controller.signal.aborted
    const why = timedOut ? `timed out after ${Math.round(limit / 1000)}s` : `request failed: ${err instanceof Error ? err.message : err}`
    console.error(`✗ ${job} — ${why}`)
    await reportFailure(job, why, { ms, timedOut })
  } finally {
    clearTimeout(timer)
  }
}

// Not process.exit(): ending the process by force while a connection is still closing crashed Node on Windows (exit code 0xC0000409) after a redirected request,
// and the Task Scheduler would have shown that instead of 1. Setting the code and letting the program end by itself is safe (idle connections do not keep it alive).
process.exitCode = failed > 0 ? 1 : 0
