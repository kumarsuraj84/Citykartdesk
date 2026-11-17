// QA 2026-11 — local DAST / API / RLS / multi-tenant probes. AUDIT stack ONLY (app :3310, API :55421). Every probe uses synthetic accounts.
//   node docs/qa-full-audit-2026-11/security/sec-dast.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'security'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310', PW = 'QA-Audit-Pw-2026!'
const rq = createRequire(path.join(ROOT, 'package.json'))
const { createClient } = rq('@supabase/supabase-js')
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const ENV = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const SB = ENV.NEXT_PUBLIC_SUPABASE_URL
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(SB)) throw new Error('Refusing: not the isolated audit stack')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const sql = (q) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { encoding: 'utf8' }).trim()
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { const r = await fn(); if (r && String(r).startsWith('NOTE:')) log(id, 'NOTE', title, String(r).slice(5)); else log(id, 'PASS', title, r || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 600)) } }
const sb = (key) => createClient(SB, key, { auth: { autoRefreshToken: false, persistSession: false } })
const ADMIN = sb(ENV.SUPABASE_SERVICE_ROLE_KEY)
const orgCleanup = () => execFileSync('docker', ['exec', '-i', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres'], { input: readFileSync(path.join(HERE, 'org-cleanup.sql'), 'utf8'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
async function as(email) { const c = sb(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY); const { data, error } = await c.auth.signInWithPassword({ email, password: PW }); if (error) throw new Error(email + ': ' + error.message); return { c, id: data.user.id } }

const ids = { store: 'd3e7261b-b09a-4b21-994e-cc684b3f95b6', ho: '43dccf5b-4034-49a3-842c-0de65e94de9f', tech: '32d3b395-b8e9-47b4-b6ad-d52f8b1b9846', vtech: '22edadf3-1970-49f7-ba94-c684281fdb54' }
const hoTicket = sql(`select id from requests where requester_id='${ids.ho}' order by created_at desc limit 1`) || sql(`select id from requests where requester_id<>'${ids.store}' order by created_at desc limit 1`)
const storeTicket = sql(`select id from requests where requester_id='${ids.store}' order by created_at desc limit 1`)
const nonVendorTicket = sql(`select id from requests where coalesce(assigned_to,'00000000-0000-0000-0000-000000000000')<>'${ids.vtech}' and requester_id<>'${ids.store}' order by created_at desc limit 1`)

// ---------- cookies for HTTP-level probes (log in once per persona through the real login page) ----------
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
async function cookieFor(email) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage()
  await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', email); await p.type('input[type="password"]', PW)
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  const cookies = await p.cookies(); await ctx.close(); return { header: cookies.map((c) => `${c.name}=${c.value}`).join('; '), cookies }
}
const get = (url, o = {}) => fetch(BASE + url, { redirect: 'manual', ...o })
const COOK = {}
for (const k of ['store', 'ho', 'tech', 'vtech']) COOK[k] = await cookieFor(`qa11.${k}@audit.test`)

try {
  // ================= A. unauthenticated surface =================
  const apiRoutes = []
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') apiRoutes.push('/' + path.relative(path.join(ROOT, 'app'), d).replace(/\\/g, '/').replace(/\[\.\.\.\w+\]/g, 'x/y').replace(/\[\w+\]/g, 'x')) } }
  walk(path.join(ROOT, 'app/api'))
  const PUBLIC_OK = [/^\/api\/health$/, /^\/api\/version$/, /^\/api\/csp-report$/, /^\/api\/intake\/webhook\//, /^\/api\/storage\/public\//]
  await run('S01', `Unauthenticated: all ${apiRoutes.length} API routes refuse to return data (GET and POST), except the ones public by design`, async () => {
    const leaks = [], pub = []
    for (const r of apiRoutes) {
      for (const method of ['GET', 'POST']) {
        const res = await get(r, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, body: method === 'POST' ? '{}' : undefined }).catch((e) => ({ status: 0, err: e.message }))
        const isPub = PUBLIC_OK.some((x) => x.test(r))
        if (res.status === 200 && !isPub) { const t = await res.text(); if (t.length > 2 && !/"ok":\s*false|error/i.test(t.slice(0, 200))) leaks.push(`${method} ${r} -> 200 ${t.slice(0, 60)}`) }
        if (res.status >= 500) leaks.push(`${method} ${r} -> ${res.status} (server error on anonymous call)`)
        if (isPub && res.status === 200) pub.push(r)
      }
    }
    if (leaks.length) throw new Error(leaks.join(' | ')); return `${apiRoutes.length} routes x 2 methods; public-by-design answering 200: ${[...new Set(pub)].join(', ')}`
  })
  await run('S02', 'Security headers on the login page and an API answer (CSP, frame, nosniff, referrer, permissions)', async () => {
    const h = (await get('/login')).headers, miss = []
    const enforced = h.get('content-security-policy') || '', reportOnly = h.get('content-security-policy-report-only') || ''; const csp = enforced || reportOnly; let cspNote = ''
    if (!csp) miss.push('Content-Security-Policy'); else { if (!/frame-ancestors/.test(csp)) miss.push('CSP frame-ancestors'); if (!enforced) cspNote += ' | CSP is REPORT-ONLY (not enforced; owner decision D-033 pending)'; if (/script-src[^;]*'unsafe-(inline|eval)'/.test(csp)) cspNote += " | script-src allows 'unsafe-inline'/'unsafe-eval', so even once enforced it would not stop injected scripts" }
    if (!/nosniff/i.test(h.get('x-content-type-options') || '')) miss.push('X-Content-Type-Options'); if (!(h.get('referrer-policy'))) miss.push('Referrer-Policy'); if (!(h.get('permissions-policy'))) miss.push('Permissions-Policy')
    if (!(h.get('x-frame-options') || /frame-ancestors/.test(csp))) miss.push('clickjacking protection'); const hsts = h.get('strict-transport-security')
    if (miss.length) throw new Error('missing/weak: ' + miss.join(', ')); return (cspNote ? 'NOTE:' : '') + 'headers present' + cspNote + ' | HSTS: ' + (hsts ? hsts : 'absent over plain HTTP (expected in dev; live is HTTP-only by owner decision)') + ' | server header: ' + (h.get('server') || 'none') + ' | x-powered-by: ' + (h.get('x-powered-by') || 'none')
  })
  await run('S03', 'Session cookie flags: HttpOnly and SameSite present', async () => {
    const bad = COOK.store.cookies.filter((c) => /^sb-.*auth-token/.test(c.name) || /session|auth/i.test(c.name)).filter((c) => !c.httpOnly || !/lax|strict/i.test(c.sameSite || ''))
    if (!COOK.store.cookies.length) throw new Error('no cookies were set at all'); const sec = COOK.store.cookies.some((c) => c.secure); const sameSiteBad = bad.filter((c) => !/lax|strict/i.test(c.sameSite || '')); if (sameSiteBad.length) throw new Error('SameSite missing: ' + sameSiteBad.map((c) => c.name).join(', ')); return (bad.length ? 'NOTE:session cookie is readable by page scripts (not HttpOnly) - documented design (docs/HTTPS-AND-CSP-PLAN.md): the browser Supabase client reads it; used on 2 screens only. ' : '') + 'cookies: ' + COOK.store.cookies.map((c) => `${c.name.slice(0, 24)}[httpOnly=${c.httpOnly},sameSite=${c.sameSite},secure=${c.secure}]`).join(' ') + (sec ? '' : ' | Secure flag absent: site is HTTP only (known owner decision, residual risk R-HTTP)')
  })
  await run('S04', 'Open redirect: login ?next= pointing at another site is not followed', async () => {
    const ctx = await browser.createBrowserContext(); const bad = []
    for (const nxt of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)']) {
      const p = await ctx.newPage(); await p.goto(BASE + '/login?next=' + encodeURIComponent(nxt), { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', 'qa11.vother@audit.test'); await p.type('input[type="password"]', PW)
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await wait(1500)
      const host = new URL(p.url()).host; if (host !== 'localhost:3310') bad.push(`${nxt} -> ${p.url()}`)
      await p.close(); await ctx.clearPermissionOverrides().catch(() => {}); const ck = await ctx.cookies?.().catch(() => []) ; if (ctx.deleteCookie && ck?.length) await ctx.deleteCookie(...ck).catch(() => {})
      // sign out between attempts by using a new context
    }
    await ctx.close(); if (bad.length) throw new Error(bad.join(' | ')); return '4 hostile next= values all stayed on the app'
  })
  await run('S05', 'Brute force: after repeated wrong passwords the app slows or locks sign-in (and says so), and the right password is then refused for a while', async () => {
    const ctx = await browser.createBrowserContext(); const msgs = []
    const attempt = async (pw) => { const p = await ctx.newPage(); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', 'qa11.vother@audit.test'); await p.type('input[type="password"]', pw); await p.click('button[type="submit"]'); await wait(1600); const t = await p.evaluate(() => (document.querySelector('[role="alert"]')?.innerText || '').trim()); const url = p.url(); await p.close(); return { t, ok: !url.includes('/login') } }
    for (let i = 0; i < 12; i++) { const r = await attempt('wrong-' + i); msgs.push(r.t.slice(0, 60)) }
    const right = await attempt(PW); await ctx.close()
    const distinct = [...new Set(msgs)]; const locked = distinct.some((m) => /too many|try again|locked|wait/i.test(m)) || !right.ok
    if (!locked) throw new Error('12 wrong passwords in a row and the 13th (right) password was accepted; messages: ' + distinct.join(' | '))
    return 'throttled/locked: messages seen: ' + distinct.join(' | ') + '; right password afterwards ' + (right.ok ? 'accepted' : 'refused (' + right.t.slice(0, 60) + ')')
  })
  await run('S06', 'Forgot password: same answer for a real and an unknown e-mail (no account enumeration)', async () => {
    const ctx = await browser.createBrowserContext(); const ans = []
    for (const em of ['qa11.store@audit.test', 'nobody.here.qa11@audit.test']) { const p = await ctx.newPage(); await p.goto(BASE + '/forgot-password', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', em); const t0 = Date.now(); await p.click('button[type="submit"]'); await wait(2500); ans.push({ em, ms: Date.now() - t0, text: (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300) }); await p.close() }
    await ctx.close(); const norm = (s) => s.replace(/qa11[^\s]*@audit\.test|nobody[^\s]*/g, '<mail>'); if (norm(ans[0].text) !== norm(ans[1].text)) throw new Error('different answers: A="' + ans[0].text.slice(-120) + '" B="' + ans[1].text.slice(-120) + '"'); return 'identical answer for both (' + ans.map((a) => a.ms + 'ms').join(' vs ') + ')'
  })
  await run('S07', 'Public token pages (/approve, /csat) with random tokens reveal nothing and do not error', async () => {
    const out = []
    for (const u of ['/approve/aaaaaaaaaaaaaaaaaaaaaaaa', '/approve/..%2f..%2fetc', "/csat/' or 1=1 --", '/csat/' + 'a'.repeat(5000)]) { const r = await get(u); const t = r.status < 400 ? await r.text() : ''; if (r.status >= 500) throw new Error(`${u.slice(0, 40)} -> ${r.status}`); if (/stack trace|PGRST\d|ECONN|\bat [\w.]+ \(|relation "|syntax error at/i.test(t.replace(/<script[\s\S]*?<\/script>/gi, ''))) throw new Error('leaks internals at ' + u.slice(0, 40)); out.push(r.status) }
    return 'statuses ' + out.join(',')
  })
  await run('S08', 'CSRF: a page on ANOTHER site cannot make the browser act as the signed-in user (cross-site POST with the cookie)', async () => {
    const { createServer } = await import('node:http')
    const srv = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>attacker</title><form id=f method=POST action="http://localhost:3310/api/events" enctype="text/plain"><input name=\'{"events":[{"kind":"pageview","path":"/csrf-probe-qa11"}],"x":"\' value=\'"}\'></form><script>setTimeout(()=>document.getElementById("f").submit(),200)</script>') }).listen(3999, '127.0.0.1')
    const ctx = await browser.createBrowserContext()
    try {
      const p = await ctx.newPage(); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', 'qa11.store@audit.test'); await p.type('input[type="password"]', PW)
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
      const before = Number(sql("select count(*) from app_event_log where created_at > now() - interval '10 minutes'"))
      const evil = await ctx.newPage(); await evil.goto('http://127.0.0.1:3999/', { waitUntil: 'networkidle2' }); await wait(2500)
      const after = Number(sql("select count(*) from app_event_log where created_at > now() - interval '10 minutes'")); const probe = Number(sql("select count(*) from app_event_log where created_at > now() - interval '10 minutes' and coalesce(path,'') like '%csrf-probe-qa11%'"))
      const posted = await evil.evaluate(() => document.body.innerText).catch(() => '')
      if (probe > 0) throw new Error('the cross-site POST was accepted as the signed-in user (' + probe + ' event row written)')
      // positive control: the SAME request sent from the app's own page must be accepted, otherwise "no row" would prove nothing
      await p.evaluate(() => fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ kind: 'pageview', path: '/csrf-control-qa11' }] }) })); await wait(1500)
      const control = Number(sql("select count(*) from app_event_log where created_at > now() - interval '10 minutes' and coalesce(path,'') like '%csrf-control-qa11%'"))
      if (control === 0) throw new Error('positive control failed: the same-origin request was not recorded either, so this test proves nothing')
      return 'cross-site form POST with cookie: not authenticated, no row written (event rows ' + before + ' -> ' + after + '); response seen by attacker page: ' + String(posted).slice(0, 40).replace(/\s+/g, ' ')
    } finally { srv.close(); await ctx.close() }
  })
  await run('S10', 'IDOR: a store user cannot open or download another person\'s ticket (page, PDF, attachment list)', async () => {
    if (!hoTicket) throw new Error('no ticket of another user to test with'); const bad = []
    for (const u of ['/requests/' + hoTicket, '/api/requests/' + hoTicket + '/pdf', '/api/storage/attachment/request/' + hoTicket]) {
      const r = await get(u, { headers: { cookie: COOK.store.header } }); const t = await r.text().catch(() => ''); const ownTitle = sql(`select title from requests where id='${hoTicket}'`)
      if (r.status === 200 && (t.includes(ownTitle) || r.headers.get('content-type')?.includes('pdf'))) bad.push(`${u} -> 200 and shows content`)
    }
    if (bad.length) throw new Error(bad.join(' | ')); return 'all three refused or empty'
  })
  await run('S11', 'Vertical access: a store user and a vendor are refused on admin / export / report endpoints and pages', async () => {
    const targets = ['/api/admin/audit', '/api/masters/export?kind=ac', '/api/vendor/pos/export', '/admin/users', '/admin/settings', '/zoho', '/dashboards/executive', '/admin/system-log']; const bad = []
    for (const who of ['store', 'vtech']) for (const u of targets) {
      if (who === 'vtech' && u === '/api/vendor/pos/export') continue   // vendors may export their own POs by design
      const r = await get(u, { headers: { cookie: COOK[who].header } }); const t = r.status === 200 ? await r.text() : ''
      const loc = r.headers.get('location') || ''; const allowed = r.status >= 300 || /not allowed|forbidden|no access|permission/i.test(t) || (r.status === 200 && t.length < 50)
      if (!allowed) bad.push(`${who} ${u} -> ${r.status}`)
    }
    if (bad.length) throw new Error(bad.join(' | ')); return `${targets.length} targets x 2 personas refused`
  })
  await run('S12', 'Vendor isolation: a vendor cannot open Citykart-only ticket pages or PDFs (a ticket not assigned to his company)', async () => {
    if (!nonVendorTicket) return 'NOTE:no suitable ticket'; const bad = []
    for (const u of ['/requests/' + nonVendorTicket, '/vendor/tickets/' + nonVendorTicket, '/api/requests/' + nonVendorTicket + '/pdf']) { const r = await get(u, { headers: { cookie: COOK.vtech.header } }); const t = r.status === 200 ? await r.text() : ''; const title = sql(`select title from requests where id='${nonVendorTicket}'`); if (r.status === 200 && t.includes(title)) bad.push(`${u} shows "${title.slice(0, 30)}"`) }
    if (bad.length) throw new Error(bad.join(' | ')); return 'refused'
  })
  await run('S13', 'Stored XSS: script/HTML in a ticket title, description and comment is shown as text for a technician (no script runs)', async () => {
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'
    const svc = sql('select id from services where is_active limit 1'); const team = sql('select id from teams limit 1'); const ins = await ADMIN.from('requests').insert({ org_id: '00000000-0000-0000-0000-000000000001', service_id: svc, team_id: team, title: 'XSS-PROBE ' + payload, description: payload, requester_id: ids.store, priority: 'low', status: 'open' }).select('id').single()
    if (ins.error) throw new Error('could not seed probe ticket: ' + ins.error.message); const id = ins.data.id
    try {
      const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); let dialog = false; p.on('dialog', async (d) => { dialog = true; await d.dismiss() })
      await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', 'qa11.tech@audit.test'); await p.type('input[type="password"]', PW); await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')])
      for (const u of ['/requests/' + id, '/requests', '/requests/queue']) { await p.goto(BASE + u, { waitUntil: 'networkidle2' }); await wait(800); const r = await p.evaluate(() => ({ x: window.__xss, imgs: [...document.querySelectorAll('img[src="x"]')].length, scripts: [...document.querySelectorAll('script')].filter((s) => /__xss/.test(s.textContent) && !/__next_f|self\.__next/.test(s.textContent.slice(0, 40))).length })); if (r.x || r.imgs || r.scripts || dialog) throw new Error(`payload became live on ${u}: ${JSON.stringify(r)}`) }
      await ctx.close()
    } finally { await ADMIN.from('requests').delete().eq('id', id) }
    return 'rendered as text on ticket page, list and queue'
  })
  await run('S14', 'Hostile search text and parameters on list pages never cause a server error or leak internals', async () => {
    const out = []
    for (const q of ["'", '%27%20OR%201=1--', '%00', '..%2f..%2f', '{{7*7}}', '${7*7}', '"><svg onload=alert(1)>', 'a'.repeat(4000), '%E0%A4%A']) {
      for (const base of ['/requests?q=', '/requests/queue?q=', '/admin/users?q=']) { const r = await get(base + q, { headers: { cookie: (base.startsWith('/admin') ? (await cookieFor('qa11.admin@audit.test')).header : COOK.tech.header) } }); const t = r.status === 200 ? (await r.text()).slice(0, 200000) : ''; if (r.status >= 500) throw new Error(`${base}${q.slice(0, 20)} -> ${r.status}`); if (/PGRST|syntax error at|stack trace|ECONNREFUSED/i.test(t)) throw new Error('internals leaked at ' + base + q.slice(0, 20)); if (/\{\{7\*7\}\}|\$\{7\*7\}/.test(t) === false && /49/.test('') ) out.push('') }
    }
    return '27 hostile requests, no 5xx, no internals'
  })
  await run('S15', 'Path traversal / odd paths against storage and file routes are refused', async () => {
    const bad = []
    for (const u of ['/api/storage/public/x/..%2f..%2f..%2f.env.local', '/api/storage/public/x/%2e%2e/%2e%2e/package.json', '/api/storage/attachment/request/..%2f..%2fetc', '/_next/../.env.local', '/.env', '/.git/config', '/api/storage/public/ckdesk/%00']) { const r = await get(u, { headers: { cookie: COOK.store.header } }); const t = r.status === 200 ? await r.text() : ''; if (r.status === 200 && /SUPABASE|SERVICE_ROLE|\[core\]|"name":/i.test(t)) bad.push(u + ' -> leaks') ; if (r.status >= 500) bad.push(u + ' -> ' + r.status) }
    if (bad.length) throw new Error(bad.join(' | ')); return '7 traversal probes refused'
  })

  // ================= C. database boundary (RLS) through PostgREST with each person's own token =================
  const tables = sql("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1").split('\n')
  const rowsVisible = async (client, t) => { const r = await client.from(t).select('*', { count: 'exact', head: true }); return r.error ? { err: r.error.code || r.error.message } : { n: r.count } }
  const matrix = {}
  await run('R01', `Anonymous (no login) cannot read any of the ${tables.length} public tables`, async () => {
    const anon = sb(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY); const open = []
    for (const t of tables) { const v = await rowsVisible(anon, t); matrix[t] = { anon: v }; if (v.n > 0) open.push(`${t}(${v.n})`) }
    if (open.length) throw new Error('anonymous can read rows in: ' + open.join(', ')); return 'zero rows visible to anonymous in every table'
  })
  const store = await as('qa11.store@audit.test'), vend = await as('qa11.vtech@audit.test'), tech = await as('qa11.tech@audit.test')
  for (const [k, who] of [['store', store], ['vendor', vend], ['tech', tech]]) for (const t of tables) matrix[t][k] = await rowsVisible(who.c, t)
  writeFileSync(path.join(OUT, 'rls-visibility-matrix.json'), JSON.stringify({ ran: new Date().toISOString(), note: 'rows visible per table per persona through PostgREST with that persona\'s own JWT; err = refused', matrix }, null, 1))
  await run('R02', 'Store requester sees only own tickets; none of the internal tables (system log, settings, secrets, audit) are readable by a store user or a vendor', async () => {
    const own = await store.c.from('requests').select('id, requester_id'); const foreign = (own.data || []).filter((r) => r.requester_id !== store.id)
    if (foreign.length) throw new Error(`store user can read ${foreign.length} tickets of other people`)
    const SENSITIVE = ['system_log', 'admin_audit_log', 'app_event_log', 'intake_channels', 'data_api_tokens', 'notification_log', 'export_audit']; const exposed = []
    for (const t of tables.filter((x) => SENSITIVE.includes(x) || /secret|credential|token|vault|audit_log|system_log/.test(x))) for (const [k, v] of [['store', matrix[t].store], ['vendor', matrix[t].vendor]]) if (v.n > 0) exposed.push(`${t} visible to ${k} (${v.n})`)
    if (exposed.length) throw new Error(exposed.join(' | ')); const settings = matrix.app_settings; const note = (settings.store.n > 0 || settings.vendor.n > 0) ? 'NOTE:' : ''; return note + `store sees ${own.data.length} own tickets, 0 foreign; app_settings (global key/value: retention days, policy.*, PO approver id) is readable by every signed-in user incl. vendors (${settings.store.n} row(s)) - not secret today, but a secret must never be stored there; sensitive tables checked: ${tables.filter((x) => SENSITIVE.includes(x) || /secret|credential|token|vault|audit_log|system_log/.test(x)).length}`
  })
  await run('R03', 'Vendor sees only tickets assigned to his company', async () => {
    const r = await vend.c.from('requests').select('id, assigned_to'); const outside = (r.data || []).filter((x) => x.assigned_to && x.assigned_to !== vend.id && !sql(`select 1 from profiles a join profiles b on b.vendor_company_id=a.vendor_company_id where a.id='${vend.id}' and b.id='${x.assigned_to}'`))
    const nonVendor = (r.data || []).length; const total = Number(sql('select count(*) from requests')); if (outside.length) throw new Error(`${outside.length} tickets outside his company are readable`); return `vendor can read ${nonVendor} of ${total} tickets (all his company's)`
  })
  await run('R04', 'Privilege escalation through the data API is refused: a store user cannot make himself admin, change org, edit others\' tickets/profiles, or insert as someone else', async () => {
    const fails = []
    let r = await store.c.from('profiles').update({ role: 'admin' }).eq('id', store.id).select(); if (r.data?.length && r.data[0].role === 'admin') fails.push('self role -> admin SUCCEEDED')
    r = await store.c.from('profiles').update({ org_id: '00000000-0000-0000-0000-0000000000ff' }).eq('id', store.id).select(); if (r.data?.length) fails.push('self org change succeeded')
    r = await store.c.from('profiles').update({ vendor_company_id: null, is_active: true, full_name: 'HACKED' }).eq('id', ids.tech).select(); if (r.data?.length) fails.push('edited another person\'s profile')
    r = await store.c.from('requests').update({ status: 'closed', priority: 'low' }).eq('id', hoTicket).select(); if (r.data?.length) fails.push('edited another person\'s ticket')
    r = await store.c.from('requests').insert({ org_id: '00000000-0000-0000-0000-000000000001', title: 'forged', requester_id: ids.ho, priority: 'low', status: 'open' }).select(); if (r.data?.length) { fails.push('inserted a ticket in another person\'s name'); await ADMIN.from('requests').delete().eq('id', r.data[0].id) }
    r = await store.c.from('requests').delete().eq('id', storeTicket).select(); if (r.data?.length) fails.push('deleted own ticket (hard delete allowed)')
    r = await store.c.from('teams').insert({ org_id: '00000000-0000-0000-0000-000000000001', name: 'HACK TEAM' }).select(); if (r.data?.length) { fails.push('created a team'); await ADMIN.from('teams').delete().eq('id', r.data[0].id) }
    r = await store.c.from('app_settings').upsert({ org_id: '00000000-0000-0000-0000-000000000001', key: 'vendor_po_approver_id', value: ids.store }).select(); if (r.data?.length) fails.push('wrote app_settings')
    if (fails.length) throw new Error(fails.join(' | ')); return '8 hostile writes all refused'
  })
  await run('R05', 'Functions callable by anonymous people: list, and call each with empty/hostile arguments to prove none returns data or changes data', async () => {
    const fns = sql("select p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon',p.oid,'execute') order by 1").split('\n').filter(Boolean)
    const anon = sb(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY); const leaks = [], seen = []
    for (const f of fns) {
      const [name, args, secdef] = f.split('|'); seen.push(`${name}(${args})${secdef === 't' ? ' [definer]' : ''}`)
      if (/^(auth_|pg_|gtrgm|gin_|gist_|similarity|word_similarity|strict_word|show_|set_limit|unaccent|uuid|crypt|gen_|digest|hmac|armor|dearmor|pgp_|encrypt|decrypt|set_config)/i.test(name) || /trigger/i.test(name)) continue
      const params = {}; for (const a of args.split(',').map((s) => s.trim()).filter(Boolean)) { const m = a.match(/^(\w+)\s/); if (m) params[m[1]] = /uuid/.test(a) ? '00000000-0000-0000-0000-000000000000' : /int|numeric/.test(a) ? 1 : /bool/.test(a) ? false : 'x' }
      const r = await anon.rpc(name, params); const body = JSON.stringify(r.data ?? null)
      if (!r.error && r.data && body.length > 4 && body !== 'null' && body !== '[]' && body !== 'true' && body !== 'false') leaks.push(`${name} -> ${body.slice(0, 80)}`)
    }
    writeFileSync(path.join(OUT, 'anon-callable-functions.txt'), seen.join('\n'))
    if (leaks.length) throw new Error('anonymous call returned data: ' + leaks.join(' | ')); return `${fns.length} anon-executable functions (list saved); none returned data to an anonymous call`
  })
  await run('R06', 'Multi-organisation isolation: a person of organisation 2 sees nothing of organisation 1 and cannot write into it (and the reverse)', async () => {
    orgCleanup()
    const orgId = (await ADMIN.from('organizations').insert({ name: 'QA11 Second Org', slug: 'qa11-second-org', status: 'active', seat_limit: 10 }).select('id').single()).data?.id
    if (!orgId) throw new Error('could not create second org')
    let uid
    try {
      const u = await ADMIN.auth.admin.createUser({ email: 'qa11.org2@audit.test', password: PW, email_confirm: true, user_metadata: { full_name: 'QA11 Org2 Admin' } }); uid = u.data.user?.id
      const pr = await ADMIN.from('profiles').upsert({ id: uid, org_id: orgId, full_name: 'QA11 Org2 Admin', role: 'admin', is_active: true }); if (pr.error) throw new Error('profile: ' + pr.error.message)
      const o2 = await as('qa11.org2@audit.test'); const leaks = []
      for (const t of ['requests', 'profiles', 'teams', 'services', 'comments', 'request_comments', 'approvals', 'notifications', 'sla_policies', 'business_rules', 'vendor_companies', 'stores']) { const r = await o2.c.from(t).select('*').limit(1000); if (r.error) continue; const rows = (r.data || []).filter((x) => x.org_id && x.org_id !== orgId); if (rows.length) leaks.push(`${t}: ${rows.length} rows of another org visible`) }
      const w = await o2.c.from('requests').insert({ org_id: '00000000-0000-0000-0000-000000000001', title: 'cross-tenant write', requester_id: uid, priority: 'low', status: 'open' }).select(); if (w.data?.length) { leaks.push('inserted a ticket INTO organisation 1'); await ADMIN.from('requests').delete().eq('id', w.data[0].id) }
      const w2 = await o2.c.from('profiles').update({ role: 'user' }).eq('id', ids.tech).select(); if (w2.data?.length) leaks.push('changed a profile of organisation 1')
      const back = await store.c.from('profiles').select('id, org_id').eq('org_id', orgId); if (back.data?.length) leaks.push('org-1 store user can see org-2 profiles')
      if (leaks.length) throw new Error(leaks.join(' | ')); return 'organisation 2 admin: 0 foreign rows across 12 tables, 0 cross-org writes; reverse direction also clean'
    } finally { if (uid) { await ADMIN.from('profiles').delete().eq('id', uid) } orgCleanup() }
  })
  await run('R07', 'Storage buckets: anonymous and a store user cannot list or read other people\'s attachments', async () => {
    const anon = sb(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY); const buckets = (await ADMIN.storage.listBuckets()).data || []; const open = []
    for (const b of buckets) { const l = await anon.storage.from(b.name).list('', { limit: 5 }); if (!l.error && l.data?.length) open.push(`${b.name}: anonymous list shows ${l.data.length}`); const l2 = await store.c.storage.from(b.name).list('', { limit: 200 }); if (!l2.error && l2.data?.length && b.public === false) { const foreign = l2.data.filter((o) => !sql(`select 1 from requests where id::text='${String(o.name).replace(/[^0-9a-f-]/gi, '')}' and requester_id='${store.id}'`)); if (foreign.length) open.push(`${b.name}: store user can list ${foreign.length} folder(s) that are not his own tickets`) } }
    if (open.length) throw new Error(open.join(' | ')); return `${buckets.length} buckets (${buckets.map((b) => b.name + (b.public ? ':public' : ':private')).join(', ')}) — nothing listable by anonymous or a store user`
  })
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'dast-results.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} not failing`); process.exit(f ? 1 : 0)
}
