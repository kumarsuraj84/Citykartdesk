// CKDesk audit — controlled load test against the DISPOSABLE audit stack only (127.0.0.1:55421). Run through audit-2026-10/guard/run.ps1.
// Closed-loop virtual users (VUs) with think time = realistic concurrency; "burst" = N simultaneous requests with no think time.
// Every request is made as a real logged-in synthetic user, so row-level security runs exactly as it does for the app.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!/^http:\/\/127\.0\.0\.1:554\d\d$/.test(URL_ || '')) throw new Error('refusing to run: not the audit stack: ' + URL_)
const LABEL = process.env.PERF_LABEL || 'run'
const LEVELS = (process.env.PERF_LEVELS || '50,200,500,1000').split(',').map(Number)
const HOLD_S = Number(process.env.PERF_HOLD_S || 25)
const RAMP_S = Number(process.env.PERF_RAMP_S || 5)
const THINK_MS = Number(process.env.PERF_THINK_MS || 1000)
const BURST = Number(process.env.PERF_BURST || 1000)
const db = (sql) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim()

async function login(email) {
  const r = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Audit-Pw-1!' }) })
  const j = await r.json(); if (!j.access_token) throw new Error('login failed ' + email); return { token: j.access_token, id: j.user.id, email }
}
const emails = [...Array.from({ length: 5 }, (_, i) => `manager${i + 1}`), ...Array.from({ length: 20 }, (_, i) => `agent${i + 1}`), ...Array.from({ length: 50 }, (_, i) => `store${i + 1}`), ...Array.from({ length: 25 }, (_, i) => `staff${i + 1}`)].map((x) => x + '@audit.test')
const users = []
for (let i = 0; i < emails.length; i += 10) users.push(...(await Promise.all(emails.slice(i, i + 10).map(login))))
const byRole = { manager: users.filter((u) => u.email.startsWith('manager')), agent: users.filter((u) => u.email.startsWith('agent')), req: users.filter((u) => /^(store|staff)/.test(u.email)) }
const svc = JSON.parse(db("select json_agg(json_build_object('s',id,'t',team_id)) from (select id,team_id from services limit 13) x"))
const teamsOf = Object.fromEntries(JSON.parse(db("select json_agg(json_build_object('u',user_id,'t',team_id)) from team_members")).map((x) => [x.u, x.t]))
const sampleIds = JSON.parse(db("select json_agg(id) from (select id from requests order by random() limit 500) x"))
const idsByTeam = Object.fromEntries(JSON.parse(db("select json_object_agg(team_id, ids) from (select team_id, json_agg(id) ids from (select id, team_id, row_number() over (partition by team_id order by random()) rn from requests) q where rn <= 100 group by team_id) z")) ? Object.entries(JSON.parse(db("select json_object_agg(team_id, ids) from (select team_id, json_agg(id) ids from (select id, team_id, row_number() over (partition by team_id order by random()) rn from requests) q where rn <= 100 group by team_id) z"))) : [])

const H = (u, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json', ...extra })
const COLS = 'id,request_no,title,status,priority,created_at,updated_at,resolution_due_at'
const rnd = (a) => a[Math.floor(Math.random() * a.length)]
// scenario = { name, weight(roles), run(user) -> Response }
const SCEN = [
  { name: 'requester: my tickets (25)', roles: ['req'], w: 30, run: (u) => fetch(`${URL_}/rest/v1/requests?select=${COLS}&requester_id=eq.${u.id}&order=created_at.desc&limit=25`, { headers: H(u) }) },
  { name: 'ticket detail (joins)', roles: ['req', 'agent', 'manager'], w: 25, run: (u) => fetch(`${URL_}/rest/v1/requests?id=eq.${rnd(sampleIds)}&select=*,service:services(name),assignee:profiles!requests_assigned_to_fkey(full_name),comments:request_comments(id,body,created_at)&limit=1`, { headers: H(u) }) },
  { name: 'technician queue (open, count exact)', roles: ['agent'], w: 20, run: (u) => fetch(`${URL_}/rest/v1/requests?select=${COLS}&team_id=eq.${teamsOf[u.id]}&status=in.(open,assigned,in_progress,waiting_user)&order=resolution_due_at.asc.nullslast&limit=25`, { headers: H(u, { Prefer: 'count=exact' }) }) },
  { name: 'manager: org-wide recent (25)', roles: ['manager'], w: 10, run: (u) => fetch(`${URL_}/rest/v1/requests?select=${COLS}&order=updated_at.desc&limit=25`, { headers: H(u, { Prefer: 'count=exact' }) }) },
  { name: 'home dashboard RPC', roles: ['req', 'agent', 'manager'], w: 10, run: (u) => fetch(`${URL_}/rest/v1/rpc/get_home_dashboard`, { method: 'POST', headers: H(u), body: JSON.stringify({ p_is_manager: u.email.startsWith('manager'), p_is_agent: u.email.startsWith('agent'), p_team_id: teamsOf[u.id] ?? null, p_has_tasks: false }) }) },
  { name: 'create ticket (insert)', roles: ['req'], w: 5, run: (u) => { const s = rnd(svc); return fetch(`${URL_}/rest/v1/requests`, { method: 'POST', headers: H(u, { Prefer: 'return=minimal' }), body: JSON.stringify({ title: 'perf-created', requester_id: u.id, org_id: '00000000-0000-0000-0000-000000000001', service_id: s.s, team_id: s.t, status: 'open', priority: 'medium' }) }) } },
  { name: 'add comment (insert)', roles: ['agent', 'manager'], w: 5, run: (u) => fetch(`${URL_}/rest/v1/request_comments`, { method: 'POST', headers: H(u, { Prefer: 'return=minimal' }), body: JSON.stringify({ request_id: rnd(idsByTeam[teamsOf[u.id]] ?? sampleIds), author_id: u.id, body: 'perf comment', is_internal: false }) }) },
]
const roleOf = (u) => (u.email.startsWith('manager') ? 'manager' : u.email.startsWith('agent') ? 'agent' : 'req')
const EXCL = (process.env.PERF_EXCLUDE || '').split(',').filter(Boolean)
if (process.env.PERF_NOCOUNT === '1') { const q = SCEN.find((x) => x.name.startsWith('technician queue')); q.name = 'technician queue (open, NO count)'; q.run = (u) => fetch(`${URL_}/rest/v1/requests?select=${COLS}&team_id=eq.${teamsOf[u.id]}&status=in.(open,assigned,in_progress,waiting_user)&order=resolution_due_at.asc.nullslast&limit=25`, { headers: H(u) }) }
function pick(u) { const r = roleOf(u); const c = SCEN.filter((s) => s.roles.includes(r) && !EXCL.some((x) => s.name.includes(x))); let t = c.reduce((a, s) => a + s.w, 0) * Math.random(); for (const s of c) { t -= s.w; if (t <= 0) return s } return c[0] }
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : null)

async function one(u, stats, sc) {
  const t0 = performance.now(); let ok = false, status = 0
  try { const res = await sc.run(u); status = res.status; await res.arrayBuffer(); ok = res.status < 400 } catch { status = -1 }
  const ms = performance.now() - t0
  const s = (stats[sc.name] ??= { lat: [], err: 0, n: 0, codes: {} }); s.n++; s.lat.push(ms); if (!ok) { s.err++; s.codes[status] = (s.codes[status] || 0) + 1 }
}
function sampleHost() { try { return execFileSync('docker', ['stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}', 'supabase_db_ckdesk_audit', 'supabase_rest_ckdesk_audit', 'supabase_kong_ckdesk_audit', 'supabase_auth_ckdesk_audit'], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split('|')) } catch { return [] } }
const conns = () => Number(db("select count(*) from pg_stat_activity where datname='postgres'"))
const waiting = () => Number(db("select count(*) from pg_stat_activity where wait_event_type='Lock'"))

async function stage(vus) {
  const stats = {}; const t0 = Date.now(); const end = t0 + (RAMP_S + HOLD_S) * 1000; let stop = false; const peaks = { cpu: {}, conns: 0, lockWaits: 0 }
  const sampler = (async () => { while (!stop) { for (const [n, cpu, mem] of sampleHost()) { const v = parseFloat(cpu); const k = n.replace('supabase_', '').replace('_ckdesk_audit', ''); peaks.cpu[k] = Math.max(peaks.cpu[k] || 0, v); peaks.mem = { ...(peaks.mem || {}), [k]: mem } } peaks.conns = Math.max(peaks.conns, conns()); peaks.lockWaits = Math.max(peaks.lockWaits, waiting()); await new Promise((r) => setTimeout(r, 4000)) } })()
  const vusP = Array.from({ length: vus }, async (_, i) => {
    await new Promise((r) => setTimeout(r, (i / vus) * RAMP_S * 1000)) // gradual ramp
    const u = users[i % users.length]
    while (Date.now() < end) { const sc = pick(u); await one(u, stats, sc); await new Promise((r) => setTimeout(r, THINK_MS * (0.5 + Math.random()))) }
  })
  await Promise.all(vusP); stop = true; await sampler
  const all = Object.values(stats).flatMap((s) => s.lat).sort((a, b) => a - b); const n = all.length; const errs = Object.values(stats).reduce((a, s) => a + s.err, 0)
  const per = Object.fromEntries(Object.entries(stats).map(([k, s]) => { const l = s.lat.sort((a, b) => a - b); return [k, { n: s.n, err: s.err, codes: s.codes, p50: +pct(l, 50).toFixed(1), p95: +pct(l, 95).toFixed(1), p99: +pct(l, 99).toFixed(1) }] }))
  const out = { vus, seconds: RAMP_S + HOLD_S, requests: n, rps: +(n / (RAMP_S + HOLD_S)).toFixed(1), errorRate: +((errs / Math.max(1, n)) * 100).toFixed(2), p50: +pct(all, 50).toFixed(1), p95: +pct(all, 95).toFixed(1), p99: +pct(all, 99).toFixed(1), max: +all.at(-1).toFixed(1), peaks, per }
  console.log(`[${LABEL}] VUs=${vus} req=${n} rps=${out.rps} err=${out.errorRate}% p50=${out.p50}ms p95=${out.p95}ms p99=${out.p99}ms max=${out.max}ms dbConnsPeak=${peaks.conns} lockWaitsPeak=${peaks.lockWaits} cpuPeak=${JSON.stringify(peaks.cpu)}`)
  return out
}
async function burst(n) {
  const stats = {}; const t0 = performance.now()
  await Promise.all(Array.from({ length: n }, (_, i) => { const u = users[i % users.length]; return one(u, stats, pick(u)) }))
  const all = Object.values(stats).flatMap((s) => s.lat).sort((a, b) => a - b); const errs = Object.values(stats).reduce((a, s) => a + s.err, 0); const wall = performance.now() - t0
  const out = { burst: n, wallMs: +wall.toFixed(0), rps: +((n / wall) * 1000).toFixed(1), errorRate: +((errs / n) * 100).toFixed(2), p50: +pct(all, 50).toFixed(1), p95: +pct(all, 95).toFixed(1), p99: +pct(all, 99).toFixed(1), max: +all.at(-1).toFixed(1) }
  console.log(`[${LABEL}] BURST ${n} simultaneous: wall=${out.wallMs}ms err=${out.errorRate}% p50=${out.p50} p95=${out.p95} p99=${out.p99} max=${out.max}`); return out
}

const meta = { label: LABEL, at: new Date().toISOString(), stack: URL_, tickets: Number(db('select count(*) from requests')), users: users.length, thinkMs: THINK_MS, holdS: HOLD_S, rampS: RAMP_S }
console.log(`[${LABEL}] tickets=${meta.tickets} users=${meta.users}`)
const stages = []
for (const v of LEVELS) { stages.push(await stage(v)); await new Promise((r) => setTimeout(r, 3000)) }
const bursts = []; for (const b of [200, BURST]) { bursts.push(await burst(b)); await new Promise((r) => setTimeout(r, 3000)) }
const dir = path.resolve(import.meta.dirname, '..', 'evidence'); fs.writeFileSync(path.join(dir, `perf-${LABEL}.json`), JSON.stringify({ meta, stages, bursts }, null, 1))
console.log(`[${LABEL}] done -> evidence/perf-${LABEL}.json`)
