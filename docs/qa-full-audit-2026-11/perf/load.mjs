// QA 2026-11 — closed-loop load generator for the PRODUCTION-MODE audit app (port 3311) with synthetic personas.
//   node docs/qa-full-audit-2026-11/perf/load.mjs --users 25 --duration 60 --think 2000 --label ds100k [--port 3311]
// Each virtual user signs in once (real login), then loops: pick a page weighted by its persona, request it, read the whole body, wait a random think time.
// Reports P50/P95/P99/max per page and overall, error count, throughput, and samples the server process (CPU/memory) and the database container.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)); const OUT = path.join(HERE, '..', 'evidence', 'perf'); mkdirSync(OUT, { recursive: true })
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const USERS = Number(arg('users', 10)), DURATION = Number(arg('duration', 60)) * 1000, THINK = Number(arg('think', 2000)), LABEL = arg('label', 'run'), PORT = arg('port', '3311'), RAMP = Number(arg('ramp', 5)) * 1000
const BASE = `http://localhost:${PORT}`, PW = 'QA-Audit-Pw-2026!'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const sql = (q) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { encoding: 'utf8' }).trim()

const storeId = 'd3e7261b-b09a-4b21-994e-cc684b3f95b6'
const storeTickets = sql(`select id from requests where requester_id='${storeId}' order by created_at desc limit 30`).split('\n').filter(Boolean)
const anyTickets = sql("select id from requests where status in ('open','assigned','in_progress') order by created_at desc limit 60").split('\n').filter(Boolean)
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const PERSONAS = {
  store: { email: 'qa11.store@audit.test', mix: 0.55, pages: [[30, () => '/home'], [30, () => '/requests'], [25, () => '/requests/' + pick(storeTickets)], [10, () => '/services'], [5, () => '/notifications']] },
  tech: { email: 'qa11.tech@audit.test', mix: 0.28, pages: [[25, () => '/home'], [30, () => '/requests/queue'], [15, () => '/requests?q=cooling'], [25, () => '/requests/' + pick(anyTickets)], [5, () => '/approvals']] },
  techmgr: { email: 'qa11.techmgr@audit.test', mix: 0.12, pages: [[30, () => '/requests/queue'], [30, () => '/dashboards/executive'], [20, () => '/admin/reports'], [20, () => '/home']] },
  admin: { email: 'qa11.admin@audit.test', mix: 0.05, pages: [[30, () => '/admin/users'], [30, () => '/admin/reports'], [20, () => '/dashboards/executive'], [20, () => '/admin/services']] },
}
// ---- sign in once per persona, keep the cookie
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
const cookies = {}
for (const [k, p] of Object.entries(PERSONAS)) {
  const ctx = await browser.createBrowserContext(); const pg = await ctx.newPage(); await pg.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await pg.type('input[type="email"]', p.email); await pg.type('input[type="password"]', PW)
  await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), pg.click('button[type="submit"]')]); await pg.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })
  cookies[k] = (await pg.cookies()).map((c) => `${c.name}=${c.value}`).join('; '); await ctx.close()
}
await browser.close()

// ---- server sampling
const serverPid = (() => { try { const o = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' }).trim(); return Number(o) } catch { return 0 } })()
const samples = []
const sampler = setInterval(() => {
  try {
    const o = execFileSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${serverPid}; "$($p.WorkingSet64) $($p.CPU)"`], { encoding: 'utf8' }).trim().split(' ')
    let dbCpu = ''; try { dbCpu = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}', 'supabase_db_ckdesk_audit'], { encoding: 'utf8' }).trim() } catch {}
    samples.push({ t: Date.now(), rssMB: Math.round(Number(o[0]) / 1048576), cpuSec: Number(o[1]), dbCpu })
  } catch {}
}, 5000)

// ---- virtual users
const lat = {}, errs = {}; let total = 0, errors = 0; const errSamples = []
const t0 = Date.now(), tEnd = t0 + RAMP + DURATION
function choose(kind) { const r = Math.random(); let a = 0; for (const [k, p] of Object.entries(PERSONAS)) { a += p.mix; if (r <= a) return k } return kind || 'store' }
async function vu(i) {
  await wait((RAMP * i) / Math.max(1, USERS))
  const persona = choose(); const P = PERSONAS[persona]; const cookie = cookies[persona]; const weights = P.pages.reduce((s, [w]) => s + w, 0)
  while (Date.now() < tEnd) {
    let r = Math.random() * weights, url = ''; for (const [w, f] of P.pages) { r -= w; if (r <= 0) { url = f(); break } }
    const key = persona + ' ' + url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').split('?')[0]
    const s = performance.now(); let ok = false, status = 0
    try {
      const res = await fetch(BASE + url, { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(60000) }); status = res.status; const body = await res.text()
      ok = res.status === 200 && !/application error|internal server error/i.test(body.slice(0, 4000)) && body.length > 500
    } catch (e) { status = 'ERR ' + String(e.cause?.code || e.message).slice(0, 40) }
    const ms = performance.now() - s; total++
    if (Date.now() > t0 + RAMP) { (lat[key] ||= []).push(ms); if (!ok) { errors++; errs[key] = (errs[key] || 0) + 1; if (errSamples.length < 8) errSamples.push(`${url} -> ${status}`) } }
    if (THINK > 0) await wait(-Math.log(1 - Math.random()) * THINK)
  }
}
await Promise.all(Array.from({ length: USERS }, (_, i) => vu(i)))
clearInterval(sampler)
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0 }
const all = Object.values(lat).flat()
const rows = Object.entries(lat).map(([k, a]) => ({ page: k, n: a.length, p50: Math.round(q(a, 0.5)), p95: Math.round(q(a, 0.95)), p99: Math.round(q(a, 0.99)), max: Math.round(Math.max(...a)), errors: errs[k] || 0 })).sort((a, b) => b.p95 - a.p95)
const rss = samples.map((s) => s.rssMB); const cpuDelta = samples.length > 1 ? (samples[samples.length - 1].cpuSec - samples[0].cpuSec) / ((samples[samples.length - 1].t - samples[0].t) / 1000) * 100 : 0
const result = { label: LABEL, users: USERS, think: THINK, durationSec: DURATION / 1000, requests: all.length, errors, errorRate: +(errors / Math.max(1, all.length) * 100).toFixed(2), rps: +(all.length / (DURATION / 1000)).toFixed(1), overall: { p50: Math.round(q(all, 0.5)), p95: Math.round(q(all, 0.95)), p99: Math.round(q(all, 0.99)), max: Math.round(Math.max(0, ...all)) }, serverRssMB: { min: Math.min(...rss), max: Math.max(...rss), first: rss[0], last: rss[rss.length - 1] }, serverCpuPct: +cpuDelta.toFixed(0), dbCpuSamples: samples.map((s) => s.dbCpu).filter(Boolean).slice(0, 40), requestsInDb: sql('select count(*) from requests'), errSamples, rows, ran: new Date().toISOString() }
writeFileSync(path.join(OUT, `${LABEL}-u${USERS}.json`), JSON.stringify(result, null, 1))
console.log(`${LABEL} users=${USERS} req=${result.requests} err=${errors} (${result.errorRate}%) rps=${result.rps} | P50 ${result.overall.p50}  P95 ${result.overall.p95}  P99 ${result.overall.p99}  max ${result.overall.max} ms | server RSS ${result.serverRssMB.first}->${result.serverRssMB.last} MB, CPU ~${result.serverCpuPct}% of one core`)
for (const r of rows.slice(0, 4)) console.log(`   slowest: ${r.page.padEnd(34)} n=${String(r.n).padStart(4)} P50 ${String(r.p50).padStart(5)} P95 ${String(r.p95).padStart(5)} P99 ${String(r.p99).padStart(5)} err ${r.errors}`)
if (errSamples.length) console.log('   errors e.g.:', errSamples.slice(0, 3).join(' | '))
