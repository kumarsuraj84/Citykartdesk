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
 *   services    the five CK Desk Windows services                  all must be Running (skipped on a PC that has none of them)
 *   server_cpu / server_memory   this server                       CPU under 90% (measured over one second), memory in use under 92%
 *   server_disk                 C:, D: and the NAS                 each at least 10% and 5 GB free
 * The numbers behind the server checks are also kept (health_metrics) for the charts.
 *
 * (HEALTH_POSTGREST_URL is the data service's own address, no /rest/v1 on the end: http://127.0.0.1:3001; a local Supabase stack needs http://127.0.0.1:54321/rest/v1)
 * Read-only toward the NAS, the app and the services; it writes only the health tables, with the service key from the app's .env.local (never printed, never stored elsewhere).
 * Self-contained: Node 18.15+, no dependencies. A check switched off on the Health page (health_check_settings) is skipped.
 * Exit code 0 when the probe itself ran (a failed CHECK is data, not a failed task); 1 only when it could not record anything.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const TIMEOUT_MS = 4000

// ── the limits (the same numbers the Health page prints: lib/health/catalog.ts SERVER_LIMITS) ───────────────────────────────────────────────────────
export const LIMITS = { cpuPct: 90, memoryPct: 92, diskFreePct: 10, diskFreeGb: 5 }
export const DEFAULT_SERVICES = ['CkDeskApp', 'CkDeskPostgrest', 'CkDeskAuth', 'CkDeskStorage', 'CkDeskProxy']

// ── pure decisions (tested in tests/unit/health-probe.test.ts) ─────────────────────────────────────────────────────────────────────────────────────
/** CPU use in percent between two os.cpus() snapshots (all cores together). */
export function cpuPercent(before, after) {
  const sum = (cpus) => cpus.reduce((a, c) => { const t = c.times; const total = t.user + t.nice + t.sys + t.idle + t.irq; return { total: a.total + total, idle: a.idle + t.idle } }, { total: 0, idle: 0 })
  const a = sum(before), b = sum(after)
  const total = b.total - a.total
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - (b.idle - a.idle) / total) * 1000) / 10))
}
export function cpuVerdict(pct) {
  return pct >= LIMITS.cpuPct ? { ok: false, detail: `CPU use is ${pct}% (limit ${LIMITS.cpuPct}%)` } : { ok: true, detail: `CPU use ${pct}%` }
}
export function memoryVerdict(totalBytes, freeBytes) {
  const pct = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : 0
  const gb = (b) => (b / 1024 ** 3).toFixed(1)
  return { pct, ...(pct >= LIMITS.memoryPct ? { ok: false, detail: `memory in use is ${pct}% (${gb(totalBytes - freeBytes)} of ${gb(totalBytes)} GB; limit ${LIMITS.memoryPct}%)` } : { ok: true, detail: `memory in use ${pct}% (${gb(totalBytes - freeBytes)} of ${gb(totalBytes)} GB)` }) }
}
/** drives: [{ name, totalBytes, freeBytes }]. A drive is low when under 10% free OR under 5 GB free. */
export function diskVerdict(drives) {
  if (drives.length === 0) return null
  const gb = (b) => (b / 1024 ** 3)
  const rows = drives.map((d) => ({ ...d, freePct: d.totalBytes > 0 ? Math.round((d.freeBytes / d.totalBytes) * 1000) / 10 : 0, freeGb: gb(d.freeBytes) }))
  const low = rows.filter((r) => r.freePct < LIMITS.diskFreePct || r.freeGb < LIMITS.diskFreeGb)
  const text = (r) => `${r.name} ${r.freePct}% free (${r.freeGb.toFixed(r.freeGb >= 100 ? 0 : 1)} GB)`
  return low.length ? { ok: false, detail: `low space: ${low.map(text).join(', ')}` } : { ok: true, detail: rows.map(text).join('; ') }
}
/** Reads the STATE of one `sc query <name>` answer: 'RUNNING', 'STOPPED', ..., or null when the service does not exist here. */
export function parseServiceState(scOutput) {
  const m = /STATE\s*:\s*\d+\s+([A-Z_]+)/.exec(scOutput || '')
  return m ? m[1] : null
}
/** states: { name: 'RUNNING' | 'STOPPED' | ... | null }. null for every service = this is not a CK Desk server (a developer PC): the check does not apply. */
export function servicesVerdict(states) {
  const names = Object.keys(states)
  if (names.length === 0 || names.every((n) => states[n] === null)) return null
  const bad = names.filter((n) => states[n] !== 'RUNNING')
  return bad.length ? { ok: false, detail: `not running: ${bad.map((n) => `${n} (${states[n] ? states[n].toLowerCase() : 'missing'})`).join(', ')}` } : { ok: true, detail: `all ${names.length} services are running` }
}

// ── the environment ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
const DISKS = (env.HEALTH_DISKS || 'C:\\,D:\\').split(',').map((s) => s.trim()).filter(Boolean)
const SERVICES = (env.HEALTH_SERVICES || DEFAULT_SERVICES.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const CRON_SECRET = env.CRON_SECRET || ''

const now = () => Number(process.hrtime.bigint() / 1_000_000n)
/** fn returns a text (good), { ok, detail }, or null (does not apply here: no sample); a throw is a failed check. */
async function timed(key, fn) {
  const t0 = now()
  try {
    const v = await fn()
    if (v === null || v === undefined) return null
    const r = typeof v === 'string' ? { ok: true, detail: v } : v
    return { key, ok: r.ok, ms: now() - t0, detail: String(r.detail).slice(0, 240) }
  } catch (e) { return { key, ok: false, ms: now() - t0, detail: String(e && e.message ? e.message : e).slice(0, 200) } }
}
async function get(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store', redirect: 'manual' })
  await res.arrayBuffer().catch(() => {})
  return res.status
}
const rest = (p, init = {}) => fetch(`${POSTGREST}/${p}`, { ...init, signal: AbortSignal.timeout(8000), headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const scQuery = (name) => new Promise((resolve) => execFile('sc.exe', ['query', name], { timeout: 4000, windowsHide: true }, (_e, stdout) => resolve(parseServiceState(String(stdout || '')))))
function statDrive(name, p) {
  try {
    const s = fs.statfsSync(p)
    return { name, totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) }
  } catch { return null }
}

async function main() {
  if (!SERVICE_KEY) { console.error('health-probe: SUPABASE_SERVICE_ROLE_KEY not found in .env.local'); return 1 }

  let off = new Set()
  try {
    const r = await rest('health_check_settings?select=check_key,enabled&enabled=eq.false')
    if (r.ok) off = new Set((await r.json()).map((x) => x.check_key))
  } catch { /* the settings table is not there yet or the data service is down: measure everything */ }

  const metrics = []   // [{ metric, value }] for the charts
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
  add('services', async () => {
    const states = {}
    await Promise.all(SERVICES.map(async (n) => { states[n] = await scQuery(n) }))
    return servicesVerdict(states)
  })
  add('server_cpu', async () => {
    const before = os.cpus(); await sleep(1000); const pct = cpuPercent(before, os.cpus())
    metrics.push({ metric: 'cpu_pct', value: pct })
    return cpuVerdict(pct)
  })
  add('server_memory', async () => {
    const v = memoryVerdict(os.totalmem(), os.freemem())
    metrics.push({ metric: 'mem_pct', value: v.pct })
    return v
  })
  add('server_disk', async () => {
    const drives = [...DISKS.map((d) => statDrive(d.replace(/[\\/]+$/, ''), d)), statDrive('NAS', NAS)].filter(Boolean)
    for (const d of drives) {
      const pct = d.totalBytes > 0 ? Math.round((d.freeBytes / d.totalBytes) * 1000) / 10 : 0
      if (/^d:?$/i.test(d.name)) metrics.push({ metric: 'disk_d_free_pct', value: pct })
      if (d.name === 'NAS') metrics.push({ metric: 'nas_free_pct', value: pct })
    }
    return diskVerdict(drives)
  })
  const samples = (await Promise.all(jobs)).filter(Boolean)

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
      if (metrics.length) {
        // charts only: a missing table (migration 201 not applied yet) is not a failure of the probe
        const m = await rest('health_metrics', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(metrics) }).catch(() => null)
        if (m && !m.ok && m.status !== 404) console.error(`health-probe: could not store the metrics (HTTP ${m.status})`)
      }
    }
  } catch (e) { console.error(`health-probe: could not store the samples (${e && e.message ? e.message : e})`) }

  // ask the app to run and store its own checks (database, sign-in, files, syncs, database load). Skipped when the app is not answering.
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

// run only when started as a script (the tests import the pure functions above)
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  main().then((code) => process.exit(code), (e) => { console.error('health-probe: unexpected error', e && e.message ? e.message : e); process.exit(1) })
}
