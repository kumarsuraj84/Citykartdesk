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
 *                          (e.g. https://cognix-production-c9d7.up.railway.app)
 *
 * Optional env:
 *   CRON_JOBS              comma-separated list of job paths to run.
 *                          Defaults to "escalation,alerts".
 */

const secret = process.env.CRON_SECRET
const baseUrl = (process.env.CRON_TARGET_URL ?? '').replace(/\/$/, '')
const jobs = (process.env.CRON_JOBS ?? 'escalation,alerts')
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

for (const job of jobs) {
  const url = `${baseUrl}/api/${job}/run`
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
    }
  } catch (err) {
    failed++
    console.error(`✗ ${job} — request failed:`, err instanceof Error ? err.message : err)
  }
}

process.exit(failed > 0 ? 1 : 0)
