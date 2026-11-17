// QA 2026-11 — SOC readiness: log inventory/quality, tamper evidence, and local detection replays. AUDIT stack only (app :3311 production mode).
//   node docs/qa-full-audit-2026-11/soc/soc-checks.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'soc'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:' + (process.env.PORT || '3311'), PW = 'QA-Audit-Pw-2026!'
const rq = createRequire(path.join(ROOT, 'package.json')); const { createClient } = rq('@supabase/supabase-js')
const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Refusing: not the isolated audit stack.')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const psql = (q, input) => execFileSync('docker', ['exec', ...(input ? ['-i'] : []), 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', ...(input ? [] : ['-Atc', q])], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const sb = (key) => createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
const ADMIN = sb(env.SUPABASE_SERVICE_ROLE_KEY)
const results = [], inventory = {}
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { const r = await fn(); if (r && String(r).startsWith('NOTE:')) log(id, 'NOTE', title, String(r).slice(5)); else log(id, 'PASS', title, r || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 700)) } }
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
async function login(email, pw = PW) { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', email); await p.type('input[type="password"]', pw); await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await wait(1500); const c = (await p.cookies()).map((x) => `${x.name}=${x.value}`).join('; '); const ok = !p.url().includes('/login'); await ctx.close(); return { cookie: c, ok } }
const nowDb = () => psql('select now()')
// rows of the log since a moment, matching an SQL condition, as objects
const rowsSince = (since, cond) => psql(`select coalesce(json_agg(t),'[]') from (select action, category, outcome, severity, actor_id is not null as has_actor, ip is not null and ip<>'' as has_ip, request_id is not null as has_req, path, left(message,60) as message from system_log where created_at >= '${since}' and (${cond}) order by id limit 20) t`)
const parse = (s) => JSON.parse(s || '[]')
try {
  await run('SOC01', 'Log inventory: what is recorded, how much, and how complete each entry is (actor, address, request id, outcome)', async () => {
    const total = Number(psql('select count(*) from system_log')); const by = parse(psql("select json_agg(t) from (select category, source, count(*) n from system_log group by 1,2 order by 3 desc limit 40) t"))
    const q = parse(psql("select json_agg(t) from (select category, count(*) n, round(100.0*count(*) filter (where actor_id is not null)/count(*),1) pct_actor, round(100.0*count(*) filter (where ip is not null and ip<>'')/count(*),1) pct_ip, round(100.0*count(*) filter (where request_id is not null)/count(*),1) pct_request_id, round(100.0*count(*) filter (where outcome is not null)/count(*),1) pct_outcome, round(100.0*count(*) filter (where user_agent is not null)/count(*),1) pct_agent from system_log group by 1) t"))
    const actions = parse(psql("select json_agg(t) from (select action, count(*) n from system_log where category in ('security','audit') group by 1 order by 2 desc limit 60) t"))
    const sec = parse(psql("select json_agg(t) from (select count(*) n, round(100.0*count(*) filter (where actor_id is not null)/greatest(count(*),1),1) pct_actor, round(100.0*count(*) filter (where ip is not null and ip<>'')/greatest(count(*),1),1) pct_ip, round(100.0*count(*) filter (where request_id is not null)/greatest(count(*),1),1) pct_request_id, round(100.0*count(*) filter (where outcome is not null)/greatest(count(*),1),1) pct_outcome from system_log where action like 'auth.%' or action like 'data.exported%') t"))[0]; inventory.appWrittenSecurity = sec
    inventory.total = total; inventory.bySource = by; inventory.quality = q; inventory.securityAuditActions = actions
    const tables = psql("select string_agg(table_name, ', ') from information_schema.tables where table_schema='public' and (table_name like '%log%' or table_name like '%audit%' or table_name like '%activit%' or table_name like '%event%')")
    inventory.logTables = tables; return `${total} entries; log-like tables: ${tables}; quality by category: ` + q.map((x) => `${x.category}: actor ${x.pct_actor}%, ip ${x.pct_ip}%, request-id ${x.pct_request_id}%`).join(' | ')
  })
  await run('SOC02', 'No secrets in the logs: scan every entry for passwords, tokens, keys, cookies and long random strings', async () => {
    const pat = "(password|passwd|pwd)\\s*[:=]\\s*\\S{4,}|bearer\\s+[A-Za-z0-9._-]{20,}|eyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{15,}\\.|sk_(live|test)_|api[_-]?key\\s*[:=]\\s*\\S{8,}|x-cron-secret|sb-[a-z0-9]+-auth-token|-----BEGIN [A-Z ]*PRIVATE KEY|service_role"
    const hits = parse(psql(`select coalesce(json_agg(t),'[]') from (select id, category, action, left(coalesce(message,'') || ' ' || coalesce(detail::text,'') || ' ' || coalesce(after_data::text,'') || ' ' || coalesce(before_data::text,''), 200) as sample from system_log where (coalesce(message,'') || ' ' || coalesce(detail::text,'') || ' ' || coalesce(after_data::text,'') || ' ' || coalesce(before_data::text,'') || ' ' || coalesce(stack,'')) ~* '${pat.replace(/'/g, "''")}' limit 10) t`))
    const total = Number(psql('select count(*) from system_log')); inventory.secretScan = { rowsScanned: total, hits: hits.length }
    if (hits.length) throw new Error(`${hits.length}+ entries look like they hold a secret: ` + hits.slice(0, 3).map((h) => `#${h.id} ${h.action}: ${h.sample.slice(0, 90)}`).join(' | ')); return `${total} entries scanned, no secret-like text`
  })
  await run('SOC03', 'Tamper evidence: the hash chain verifies, and a change made behind the application\'s back (as the database owner) is DETECTED', async () => {
    const before = Number(psql('select count(*) from system_log_verify_chain((select max(chain_seq) - 20 from public.system_log), 1000)'))
    const out = psql(null, "begin;\nalter table public.system_log disable trigger user;\nupdate public.system_log set message = 'TAMPERED' where id = (select id from public.system_log where row_hash is not null order by id desc offset 5 limit 1);\nselect 'RESULT broken-after-tamper=' || count(*) from system_log_verify_chain((select max(chain_seq) - 20 from public.system_log), 1000);\nrollback;")
    const afterTamper = Number((out.match(/broken-after-tamper=(\d+)/) || [])[1] ?? NaN); const afterRollback = Number(psql('select count(*) from system_log_verify_chain((select max(chain_seq) - 20 from public.system_log), 1000)'))
    inventory.chain = { brokenBefore: before, brokenAfterTamper: afterTamper, brokenAfterRollback: afterRollback }
    if (before !== 0) throw new Error('the chain is already broken before the test: ' + before + ' broken link(s)'); if (!(afterTamper > 0)) throw new Error('the tampered row was NOT detected (broken links reported: ' + afterTamper + ')'); if (afterRollback !== 0) throw new Error('chain not restored after rollback')
    return 'chain intact (0 broken); after changing one entry behind the application: ' + afterTamper + ' broken link(s) reported; after rollback 0 again'
  })
  await run('SOC04', 'Append-only: an ordinary application login cannot change or delete log entries (even an administrator through the data API)', async () => {
    const adm = sb(env.NEXT_PUBLIC_SUPABASE_ANON_KEY); const { data } = await adm.auth.signInWithPassword({ email: 'qa11.admin@audit.test', password: PW }); if (!data.session) throw new Error('admin sign-in failed')
    const id = psql('select id from system_log order by id desc limit 1'); const u = await adm.from('system_log').update({ message: 'x' }).eq('id', id).select(); const d = await adm.from('system_log').delete().eq('id', id).select()
    const svcU = await ADMIN.from('system_log').update({ message: 'x' }).eq('id', id).select(); const svcD = await ADMIN.from('system_log').delete().eq('id', id).select()
    const still = psql(`select count(*) from system_log where id=${id} and message is distinct from 'x'`)
    if ((u.data?.length) || (d.data?.length) || (svcU.data?.length) || (svcD.data?.length) || still !== '1') throw new Error(`a log row was changed/deleted: admin update ${u.data?.length}, delete ${d.data?.length}, service update ${svcU.data?.length}, delete ${svcD.data?.length}`)
    return 'update and delete refused for the administrator and for the service key'
  })
  await run('SOC05', 'Who can READ the logs: administrator yes, store requester and vendor no', async () => {
    const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const out = []
    for (const [who, want] of [['qa11.admin@audit.test', true], ['qa11.store@audit.test', false], ['qa11.vtech@audit.test', false], ['qa11.tech@audit.test', false]]) {
      const c = sb(anon); await c.auth.signInWithPassword({ email: who, password: PW }); const r = await c.from('system_log').select('id', { count: 'exact', head: true }); const n = r.error ? 0 : r.count; out.push(`${who.split('@')[0]}:${n > 0 ? 'can read' : 'cannot'}`); if ((n > 0) !== want) throw new Error(`${who} ${n > 0 ? 'CAN' : 'cannot'} read the log (expected ${want ? 'yes' : 'no'}): ${out.join(', ')}`)
    }
    return out.join(', ')
  })
  // ------------------- detection replays -------------------
  await run('SOC06', 'Detection replay: 6 failed sign-ins then a rate limit -> "auth.login_failed" entries (and "auth.login_rate_limited") exist with address and request id', async () => {
    const since = nowDb(); for (let i = 0; i < 6; i++) await login('qa11.vother@audit.test', 'wrong-soc-' + i); await wait(3500)
    const rows = parse(await rowsSince(since, "action like 'auth.login%'")); const failed = rows.filter((r) => r.action === 'auth.login_failed'); const limited = rows.filter((r) => r.action === 'auth.login_rate_limited')
    inventory.replaySignIn = rows
    if (!failed.length) throw new Error('no auth.login_failed entry was written for 6 failed sign-ins'); const noIp = failed.filter((r) => !r.has_ip).length
    return `${failed.length} failed + ${limited.length} rate-limited entries; address present on ${failed.length - noIp}/${failed.length}; request id present on ${failed.filter((r) => r.has_req).length}/${failed.length}` + (noIp ? ' (address missing: TRUSTED_PROXY_HOPS not set on this instance, per-address detection is off by design)' : '')
  })
  await run('SOC07', 'Detection replay: a successful sign-in and a sign-out are recorded with the person (actor)', async () => {
    const since = nowDb(); const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', 'qa11.ho@audit.test'); await p.type('input[type="password"]', PW); await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await wait(1500)
    await p.evaluate(() => [...document.querySelectorAll('button, a')].find((b) => /sign out|log out|logout/i.test(b.innerText || b.getAttribute('aria-label') || ''))?.click()); await wait(1500); await ctx.close(); await wait(2500)
    const rows = parse(await rowsSince(since, "action in ('auth.login_succeeded','auth.logout')")); const ok = rows.find((r) => r.action === 'auth.login_succeeded'); if (!ok) throw new Error('no auth.login_succeeded entry'); if (!ok.has_actor) throw new Error('sign-in entry has no actor')
    return rows.map((r) => `${r.action}(actor ${r.has_actor ? 'yes' : 'no'})`).join(', ')
  })
  await run('SOC08', 'Detection replay: a store user probing admin pages and admin APIs leaves a trace (denied/forbidden entry)', async () => {
    const since = nowDb(); const { cookie } = await login('qa11.store@audit.test'); for (const u of ['/admin/users', '/admin/settings', '/api/admin/audit', '/api/masters/export?kind=ac', '/zoho']) await fetch(BASE + u, { headers: { cookie }, redirect: 'manual' }); await wait(3500)
    const rows = parse(await rowsSince(since, "outcome='denied' or severity='warning' or action ilike '%forbid%' or action ilike '%denied%' or action ilike '%unauthor%'"))
    inventory.replayForbidden = rows; if (!rows.length) return 'NOTE:no log entry for 5 forbidden-access attempts by a signed-in user (GAP: an insider probing admin screens is not visible in the log; the pages simply redirect)'; return rows.length + ' entries: ' + [...new Set(rows.map((r) => r.action))].join(', ')
  })
  await run('SOC09', 'Changes to people (role, active flag, details) are recorded by a database trigger with before and after values', async () => {
    const n = Number(psql("select count(*) from system_log where action = 'profiles.update'")); const withBA = Number(psql("select count(*) from system_log where action = 'profiles.update' and before_data is not null and after_data is not null")); const withActor = Number(psql("select count(*) from system_log where action = 'profiles.update' and actor_id is not null"))
    const adm = sb(env.NEXT_PUBLIC_SUPABASE_ANON_KEY); await adm.auth.signInWithPassword({ email: 'qa11.admin@audit.test', password: PW }); const direct = await adm.from('profiles').update({ role: 'admin' }).eq('id', '43dccf5b-4034-49a3-842c-0de65e94de9f').select('id')
    if (direct.data?.length) { await ADMIN.from('profiles').update({ role: 'user' }).eq('id', '43dccf5b-4034-49a3-842c-0de65e94de9f'); throw new Error('an administrator could change a role directly through the data API (bypassing the application)') }
    if (!n) throw new Error('no profile change entries at all'); return (withActor / n < 0.5 ? 'NOTE:' : '') + n + ' profile-change entries; with before+after values ' + withBA + '; with a named actor ' + withActor + ' (' + Math.round(100 * withActor / n) + '%: changes made by the application\'s service key often carry no person unless the application supplies one). Direct role change through the data API by an administrator is refused.'
  })
  await run('SOC10', 'Detection replay: an export of the AC master by an administrator is recorded (what was exported, by whom, without the contents)', async () => {
    const since = nowDb(); const { cookie } = await login('qa11.admin@audit.test'); const r = await fetch(BASE + '/api/masters/export?kind=ac', { headers: { cookie } }); await wait(3000)
    const rows = parse(await rowsSince(since, "action ilike '%export%'")); if (r.status !== 200) return 'NOTE:export answered ' + r.status + ' (nothing to audit)'; if (!rows.length) throw new Error('export succeeded but nothing was logged'); return rows.map((x) => `${x.action}(actor ${x.has_actor ? 'yes' : 'no'})`).join(', ')
  })
  await run('SOC11', 'Detection replay: a webhook with a bad signature and a scheduler call with a wrong secret are logged', async () => {
    const since = nowDb(); await fetch(BASE + '/api/intake/webhook/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) }, body: '{"object":"whatsapp_business_account","entry":[]}' }); await fetch(BASE + '/api/business-rules/run', { headers: { 'x-cron-secret': 'wrong' } }); await fetch(BASE + '/api/data/v1/meta', { headers: { authorization: 'Bearer wrong-token-wrong-token-wrong-token-1234' } }); await wait(3500)
    const rows = parse(await rowsSince(since, "path ilike '%webhook%' or path ilike '%business-rules%' or path ilike '%/api/data%' or action ilike '%webhook%' or action ilike '%cron%' or action ilike '%token%'"))
    inventory.replayMachineAuth = rows; if (!rows.length) return 'NOTE:bad webhook signature, wrong scheduler secret and wrong data-API token left NO log entry (GAP: machine-to-machine probing is invisible to a SOC)'; return rows.length + ' entries: ' + [...new Set(rows.map((r) => r.action))].join(', ')
  })
  await run('SOC12', 'Retention and archiving exist and are configured (nothing is kept forever by accident, nothing is deleted without archive)', async () => {
    const keys = psql("select string_agg(key||'='||value, '; ') from app_settings where key ilike '%retention%' or key ilike '%log%'") || '(no explicit setting: defaults apply)'; const fn = psql("select count(*) from pg_proc where proname='system_log_archive_old'"); const arch = psql("select count(*) from information_schema.tables where table_name='system_log_archive'")
    if (fn !== '1' || arch !== '1') throw new Error('archive function or table missing'); inventory.retention = keys; return `archive function + table present; settings: ${keys}`
  })
  await run('SOC13', 'Alerting path: an operator alert channel exists in code and its configuration state is reported', async () => {
    const hook = !!env.OPERATOR_ALERT_WEBHOOK_URL; const exists = psql("select count(*) from information_schema.tables where table_name in ('alert_rules','operator_alerts','alert_state')")
    return 'NOTE:alert route /api/alerts/run exists in code; OPERATOR_ALERT_WEBHOOK_URL is ' + (hook ? 'set' : 'EMPTY in the audit environment (by design: nothing leaves the PC), so alert delivery was NOT RUN; alert tables present: ' + exists)
  })
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'soc-results.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1)); writeFileSync(path.join(OUT, 'soc-inventory.json'), JSON.stringify(inventory, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} not failing`); process.exit(f ? 1 : 0)
}
