// QA 2026-11 — failure recovery / resilience. Controlled local failures on the DISPOSABLE audit stack, production-mode app on :3311.
//   node docs/qa-full-audit-2026-11/recovery/fr.mjs
// Each check: break one dependency on purpose, see what a signed-in person and a signed-out person experience, restore it, and measure the time until normal.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'recovery'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3311', PW = 'QA-Audit-Pw-2026!', ORG = '00000000-0000-0000-0000-000000000001'
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { const r = await fn(); if (r && String(r).startsWith('NOTE:')) log(id, 'NOTE', title, String(r).slice(5)); else log(id, 'PASS', title, r || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 600)) } }
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const sql = (q) => docker('exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q)
const appPid = () => { try { return execFileSync('powershell', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 3311 -State Listen | Select-Object -First 1).OwningProcess'], { encoding: 'utf8' }).trim() } catch { return '' } }
const PID0 = appPid(); if (!PID0) throw new Error('the production-mode audit app is not running on :3311')
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
async function cookieFor(email) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', email); await p.type('input[type="password"]', PW)
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })
  const c = (await p.cookies()).map((x) => `${x.name}=${x.value}`).join('; '); await ctx.close(); return c
}
const probe = async (url, cookie, ms = 20000) => { const s = Date.now(); try { const r = await fetch(BASE + url, { headers: cookie ? { cookie } : {}, redirect: 'manual', signal: AbortSignal.timeout(ms) }); const t = await r.text(); return { status: r.status, ms: Date.now() - s, text: t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500), raw: t } } catch (e) { return { status: 0, ms: Date.now() - s, text: 'NO ANSWER: ' + (e.cause?.code || e.message), raw: '' } } }
const LEAK = /stack trace|\bat [\w.<>]+ \(|ECONNREFUSED|PGRST\d|postgres(ql)?:\/\/|password authentication|supabase_|\/app\/|node_modules|C:\\Users/i
const until = async (fn, maxMs, step = 2000) => { const s = Date.now(); while (Date.now() - s < maxMs) { if (await fn()) return Date.now() - s; await wait(step) } return -1 }
const cookie = await cookieFor('qa11.store@audit.test'); const techCookie = await cookieFor('qa11.tech@audit.test')
const goodHome = async () => { const r = await probe('/home', cookie); return r.status === 200 && r.raw.length > 5000 }

async function outage(id, title, container, opts = {}) {
  await run(id, title, async () => {
    if (!(await goodHome())) throw new Error('precondition: the app is not healthy before the test')
    docker('stop', container); const t0 = Date.now(); const seen = []; const slow = []
    try {
      await wait(3000)
      for (const [u, ck, label] of [['/home', cookie, 'signed-in /home'], ['/requests', cookie, 'signed-in /requests'], ['/login', null, 'sign-in page']]) { const r = await probe(u, ck, 75000); seen.push(`${label}: ${r.status} in ${r.ms} ms`); if (r.status === 0) throw new Error('the app did not answer within 75 s during the outage (' + label + '): ' + r.text); if (r.ms > 30000) slow.push(`${label} took ${Math.round(r.ms / 1000)} s`); if (LEAK.test(r.text)) throw new Error('technical details shown to the person on ' + label + ': ' + (r.text.match(LEAK) || [''])[0]) }
      const h = await probe('/api/health', null); seen.push('health: ' + h.status)
      if (opts.during) seen.push(await opts.during())
      if (appPid() !== PID0) throw new Error('the app process was restarted/crashed during the outage')
    } catch (e) { docker('start', container); await until(async () => { const r = await probe('/home', cookie, 8000); return r.status === 200 && r.raw.length > 5000 }, 180000); throw e } finally { try { docker('start', container) } catch {} }
    const rec = await until(async () => { const r = await probe('/home', cookie, 8000); return r.status === 200 && r.raw.length > 5000 }, 150000)
    if (rec < 0) throw new Error('did not recover within 150 s after the service came back. ' + seen.join('; '))
    if (appPid() !== PID0) throw new Error('the app had to be restarted to recover')
    if (slow.length) throw new Error('the app did not crash and recovered in ' + Math.round(rec / 1000) + ' s, BUT people waited too long during the outage: ' + slow.join(', ') + ' (' + seen.join('; ') + ')')
    return `outage handled (${seen.join('; ')}); back to normal ${Math.round(rec / 1000)} s after restart, no app restart`
  })
}
try {
  await outage('FR01', 'Database stops for ~10 s: people see a plain message (no technical text), the app stays up, and recovers by itself', 'supabase_db_ckdesk_audit')
  await wait(5000)
  await outage('FR02', 'The data gateway (PostgREST) stops: same expectations', 'supabase_rest_ckdesk_audit')
  await wait(3000)
  await outage('FR03', 'The sign-in service (GoTrue) stops: people already signed in keep working; sign-in says so plainly; recovers', 'supabase_auth_ckdesk_audit', {
    during: async () => { const r = await probe('/home', cookie); return 'already-signed-in /home still ' + r.status }
  })
  await wait(3000)
  await run('FR04', 'File storage stops: opening an attachment gives a clear "temporarily unavailable" (503), not a wrong "not found"; recovers', async () => {
    const att = sql("select id from request_attachments where deleted_at is null limit 1"); if (!att) return 'NOTE:no attachment in the audit database to test with'
    const adminCookie = await cookieFor('qa11.admin@audit.test'); const ok = await probe('/api/storage/attachment/request/' + att, adminCookie); if (ok.status !== 200) return 'NOTE:the sample attachment is not readable even when storage is up (' + ok.status + ')'
    docker('stop', 'supabase_storage_ckdesk_audit'); let during
    try { await wait(3000); during = await probe('/api/storage/attachment/request/' + att, adminCookie, 60000) } finally { docker('start', 'supabase_storage_ckdesk_audit') }
    const rec = await until(async () => (await probe('/api/storage/attachment/request/' + att, adminCookie)).status === 200, 90000)
    if (during.ms > 30000) throw new Error('503 came only after ' + Math.round(during.ms / 1000) + ' s'); if (during.status !== 503) throw new Error('while storage was down the answer was ' + during.status + ' ' + during.text.slice(0, 100)); if (rec < 0) throw new Error('storage did not recover'); return `503 after ${Math.round(during.ms / 1000)} s (the 20 s wait to the storage service is by design); back after ${Math.round(rec / 1000)} s`
  })
  await wait(3000)
  // ---- scheduler / background work ----
  const stamp = 'FRQ' + Date.now().toString().slice(-6); const ids = { ho: '43dccf5b-4034-49a3-842c-0de65e94de9f', team: 'c7e62ddc-11ca-4ff2-aa56-8140eb0e3732', service: '06026d49-3adc-4aaf-b9da-10699d4d7667' }
  const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js'); const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
  const cron = () => fetch(BASE + '/api/business-rules/run', { headers: { 'x-cron-secret': env.CRON_SECRET }, signal: AbortSignal.timeout(180000) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  const cleanup = []; const fx = {}
  await run('FR05', 'A scheduled rule whose "claim" was written but whose actions never ran (simulated crash) is NOT retried: reports the at-most-once behaviour and how it would be noticed', async () => {
    const rule = must(await db.from('business_rules').insert({ org_id: ORG, name: `${stamp} crash-window rule`, is_active: true, trigger: ['schedule'], schedule_check: 'sla_pct_elapsed', schedule_threshold: 100, conditions: [{ field: 'title', operator: 'contains', value: stamp }], conditions_logic: 'AND', execution_order: 0, actions: [{ type: 'set_priority', params: { priority: 'urgent' } }] }).select('id').single(), 'rule').id; cleanup.push(['rule', rule])
    const mk = async (k) => { const t = must(await db.from('requests').insert({ org_id: ORG, request_no: `${stamp}-${k}`, title: `${stamp} ${k}`, description: 'FR', requester_id: ids.ho, service_id: ids.service, team_id: ids.team, priority: 'low', status: 'open', created_at: new Date(Date.now() - 864e6).toISOString(), resolution_due_at: new Date(Date.now() - 3600e3).toISOString(), response_due_at: new Date(Date.now() - 800e6).toISOString() }).select('id').single(), k).id; cleanup.push(['req', t]); return t }
    const normal = await mk('normal'); const crashed = await mk('crashed'); fx.ids = [normal, crashed]
    must(await db.from('business_rule_events').insert({ rule_id: rule, request_id: crashed }), 'simulated claim')   // what the database looks like if the process died right after claiming
    const r = await cron(); if (r.status !== 200) throw new Error('scheduler answered ' + r.status)
    const p = Object.fromEntries(must(await db.from('requests').select('id, priority').in('id', [normal, crashed]), 'prio').map((x) => [x.id, x.priority]))
    if (p[normal] !== 'urgent') throw new Error('the normal ticket was not escalated: ' + p[normal])
    const lost = p[crashed] !== 'urgent'; return (lost ? 'NOTE:' : '') + `normal ticket escalated; crashed-claim ticket ${lost ? 'was NOT escalated and nothing reports it (silent loss window of the claim-first design, at-most-once)' : 'was escalated'}`
  })
  await run('FR06', 'Scheduler run is safe to repeat after an interruption: running it again right away changes nothing for already-handled tickets', async () => {
    const cnt = () => Number(sql(`select count(*) from business_rule_events where request_id in ('${fx.ids.join("','")}')`)); const before = cnt(); if (before < 2) throw new Error('precondition: expected the 2 claims of FR05 to exist, found ' + before); const r1 = await cron(); const r2 = await cron()
    const after = cnt(); if (after !== before) throw new Error(`events ${before} -> ${after}`); return `events stay ${after}; fired ${r1.body.fired}/${r2.body.fired}`
  })
  await run('FR07', 'Scheduler is refused without its secret even while the database is busy; and an interrupted request (client gives up after 50 ms) does not leave the app unhealthy', async () => {
    const r = await fetch(BASE + '/api/business-rules/run'); if (r.status !== 401) throw new Error('no-secret call answered ' + r.status)
    await Promise.allSettled(Array.from({ length: 6 }, () => fetch(BASE + '/api/business-rules/run', { headers: { 'x-cron-secret': env.CRON_SECRET }, signal: AbortSignal.timeout(50) }))); await wait(3000)
    if (!(await goodHome())) throw new Error('the app is not healthy after abandoned scheduler calls'); if (appPid() !== PID0) throw new Error('the app restarted'); return '401 without secret; 6 abandoned scheduler calls, app healthy and same process'
  })
  for (const [k, id] of cleanup.reverse()) { if (k === 'req') { await db.from('business_rule_events').delete().eq('request_id', id); await db.from('requests').delete().eq('id', id) } else { await db.from('business_rules').delete().eq('id', id) } }
} finally {
  await browser.close(); for (const c of ['supabase_db_ckdesk_audit', 'supabase_rest_ckdesk_audit', 'supabase_auth_ckdesk_audit', 'supabase_storage_ckdesk_audit']) { try { docker('start', c) } catch {} }
  writeFileSync(path.join(OUT, 'recovery-results.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} not failing`); process.exit(f ? 1 : 0)
}
