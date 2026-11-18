#!/usr/bin/env node
/**
 * Health probe: run ONCE A MINUTE on the app server by the scheduled task "CitykartDesk-HealthProbe" (scripts\windows\add-health-probe-task.ps1).
 * It measures what only an outside observer can (it keeps working when the app is dead), writes one row per check into health_samples, opens / closes outages
 * for those checks (health_judge in the database), and then asks the app to run its own checks (GET /api/health/collect).
 *
 *   app         GET  http://127.0.0.1:<PORT>/api/health            must answer 200
 *   postgrest   GET  http://127.0.0.1:3001/                        any answer below 500 (the data service is alive)
 *   proxy       GET  <SUPABASE_URL>/rest/v1/                       any answer below 500 (the gateway in front of the services is alive)
 *   nas_files   list the CK Desk files folder on the NAS           must open within 5 seconds
 *
   (HEALTH_POSTGREST_URL is the data service's own address, no /rest/v1 on the end: http://127.0.0.1:3001; a local Supabase stack needs http://127.0.0.1:54321/rest/v1)
 * Read-only toward the NAS and the app; it writes only the health tables, with the service key from the app's .env.local (never printed, never stored elsewhere).
 * Self-contained: Node 18+, no dependencies. A check switched off on the Health page (health_check_settings) is skipped.
 * Exit code 0 when the probe itself ran (a failed CHECK is data, not a failed task); 1 only when it could not record anything.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const TIMEOUT_MS = 4000

function loadEnv() {
  const candidates = [process.env.HEALTH_ENV_FILE, path.join(here, '..', '.env.local'), path.join(here, '..', 'standalone', '.env.local'), path.join(here, '..', '..', '.env.local')].filter(Boolean)
  const out = {}
  for (const f of candidates) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
      if (out.SUPABASE_SERVICE_ROLE_KEY) break
    } catch { /* try the next place */ }
  }
  return { ...out, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) }
}
const env = loadEnv()

const POSTGREST = (env.HEALTH_POSTGREST_URL || 'http://127.0.0.1:3001').replace(/\/$/, '')
const APP = (env.HEALTH_APP_URL || `http://127.0.0.1:${env.PORT || 3210}`).replace(/\/$/, '')
const GATEWAY = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const NAS = env.HEALTH_NAS_PATH || '\\\\10.0.0.25\\CKAPPLICATIONS_DATA\\CKDESK_DATA'
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const CRON_SECRET = env.CRON_SECRET || ''

const now = () => Number(process.hrtime.bigint() / 1_000_000n)
async function timed(key, fn) {
  const t0 = now()
  try { const detail = await fn(); return { key, ok: true, ms: now() - t0, detail } }
  catch (e) { return { key, ok: false, ms: now() - t0, detail: String(e && e.message ? e.message : e).slice(0, 200) } }
}
async function get(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store', redirect: 'manual' })
  await res.arrayBuffer().catch(() => {})
  return res.status
}
const rest = (p, init = {}) => fetch(`${POSTGREST}/${p}`, { ...init, signal: AbortSignal.timeout(8000), headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })

async function main() {
  if (!SERVICE_KEY) { console.error('health-probe: SUPABASE_SERVICE_ROLE_KEY not found in .env.local'); return 1 }

  let off = new Set()
  try {
    const r = await rest('health_check_settings?select=check_key,enabled&enabled=eq.false')
    if (r.ok) off = new Set((await r.json()).map((x) => x.check_key))
  } catch { /* the settings table is not there yet or the data service is down: measure everything */ }

  const jobs = []
  const add = (key, fn) => { if (!off.has(key) || key === 'app') jobs.push(timed(key, fn)) }
  add('app', async () => { const s = await get(`${APP}/api/health`); if (s !== 200) throw new Error(`the app answered ${s}`); return 'answered (200)' })
  add('postgrest', async () => { const s = await get(`${POSTGREST}/`, { apikey: ANON_KEY }); if (s >= 500) throw new Error(`the data service answered ${s}`); return `answered (${s})` })
  if (GATEWAY) add('proxy', async () => { const s = await get(`${GATEWAY}/rest/v1/`, { apikey: ANON_KEY }); if (s >= 500) throw new Error(`the gateway answered ${s}`); return `answered (${s})` })
  add('nas_files', async () => {
    const list = fs.promises.readdir(NAS)
    const names = await Promise.race([list, new Promise((_, rej) => setTimeout(() => rej(new Error('the NAS folder did not open within 5 seconds')), 5000))])
    return `opened (${names.length} entries)`
  })
  const samples = await Promise.all(jobs)

  // record (the data service may itself be the thing that is down: then there is nothing to record into, and the gap on the page is the signal)
  let recorded = false
  try {
    const r = await rest('health_samples', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(samples.map((s) => ({ check_key: s.key, ok: s.ok, ms: s.ms, detail: s.detail }))) })
    recorded = r.ok
    if (!r.ok) console.error(`health-probe: could not store the samples (HTTP ${r.status})`)
    else {
      const j = await rest('rpc/health_judge', { method: 'POST', body: JSON.stringify({ p_keys: samples.map((s) => s.key) }) })
      if (!j.ok) console.error(`health-probe: health_judge failed (HTTP ${j.status})`)
      else { const acts = await j.json(); for (const a of acts) console.log(`health-probe: outage ${a.action}: ${a.check_key}`) }
    }
  } catch (e) { console.error(`health-probe: could not store the samples (${e && e.message ? e.message : e})`) }

  // ask the app to run and store its own checks (database, sign-in, files, syncs). Skipped when the app is not answering.
  const appOk = samples.find((s) => s.key === 'app')?.ok
  if (appOk && CRON_SECRET) {
    try {
      const res = await fetch(`${APP}/api/health/collect`, { headers: { 'x-cron-secret': CRON_SECRET }, signal: AbortSignal.timeout(30_000), cache: 'no-store', redirect: 'manual' })
      if (res.status !== 200) console.error(`health-probe: the app's own checks answered HTTP ${res.status}`)
    } catch (e) { console.error(`health-probe: the app's own checks did not finish (${e && e.message ? e.message : e})`) }
  }
  console.log(`health-probe: ${samples.map((s) => `${s.key}=${s.ok ? 'ok' : 'FAIL'}(${s.ms}ms)`).join(' ')}`)
  return recorded ? 0 : 1
}

main().then((code) => process.exit(code), (e) => { console.error('health-probe: unexpected error', e && e.message ? e.message : e); process.exit(1) })
