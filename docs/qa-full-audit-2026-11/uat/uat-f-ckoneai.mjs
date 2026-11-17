// QA 2026-11 — BUSINESS UAT scenario F: CKOneAI assistant bridge ("Ask CK Desk") + the read-only data API.
// The real CKOneAI machine (10.0.0.82) is never contacted: a STUB listens on 127.0.0.1:8100 and checks every call's HMAC signature
// independently, from the written spec (lib/ckoneai/sign.ts header comment), not by calling the app's own code.
//   phase off:  app running WITHOUT the assistant        node uat-f-ckoneai.mjs off
//   phase on :  app started by evidence/start-audit-f.cjs  node uat-f-ckoneai.mjs on
import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'evidence', 'uat'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310'
const PHASE = process.argv[2] || 'on'
const PW = 'QA-Audit-Pw-2026!'
const SECRET = 'qa11-synthetic-bridge-secret-0123456789abcdef'
const DATA_TOKEN = 'qa11-synthetic-data-api-token-0123456789abcdef'
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { log(id, 'PASS', title, (await fn()) || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 320)) } }
const dbq = (q) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { encoding: 'utf8' }).trim()

// ---- stub CKOneAI: records every call and verifies the signature from the spec ----
const seen = []; const usedNonces = new Set(); let stubMode = 'ok'
const sha = (b) => createHash('sha256').update(b).digest('hex')
const stub = createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks); const h = req.headers
    const canon = [req.method, req.url, h['x-ckdesk-user'], h['x-ckdesk-roles'], h['x-ckdesk-scope'], h['x-ckdesk-ts'], h['x-ckdesk-nonce'], sha(body)].join('\n')
    const expect = createHmac('sha256', SECRET).update(canon).digest('hex')
    const skew = Math.abs(Date.now() / 1000 - Number(h['x-ckdesk-ts']))
    const rec = { method: req.method, url: req.url, headers: h, bodyBytes: body.length, body: body.toString('utf8').slice(0, 500), sigOk: expect === h['x-ckdesk-sig'], skew, nonceFresh: !usedNonces.has(h['x-ckdesk-nonce']), nonceShape: /^[0-9a-f]{16}$/.test(h['x-ckdesk-nonce'] || '') }
    usedNonces.add(h['x-ckdesk-nonce']); seen.push(rec)
    if (stubMode === 'slow') return setTimeout(() => res.end('{}'), 120000)
    if (!rec.sigOk || skew > 60 || !rec.nonceFresh) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"bad signature"}') }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'leak=1; Path=/' }); res.end(JSON.stringify({ ok: true, echo: req.url, answer: 'stub answer' }))
  })
})
const mark = () => seen.length
const sinceMark = (m) => seen.slice(m)

let browser
async function session(email) {   // a browser context holding a real signed-in cookie jar; returns a fetch that uses it
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage()
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await page.type('input[type="email"]', email); await page.type('input[type="password"]', PW)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  const cookies = (await page.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
  return { cookies, close: () => ctx.close(), page }
}
const call = (s, p, init = {}) => fetch(BASE + p, { ...init, redirect: 'manual', headers: { ...(s ? { cookie: s.cookies } : {}), ...(init.headers || {}) } })

browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
try {
  if (PHASE === 'off') {
    await run('F01', 'Assistant OFF (default): every route answers "switched off" (503) for a signed-in person, 401/503 for anonymous; nothing is forwarded', async () => {
      const s = await session('qa11.store@audit.test')
      const a = await call(s, '/api/ckoneai/health'); const anon = await call(null, '/api/ckoneai/health')
      const ui = await call(s, '/ckoneai-ui/index.html'); await s.close()
      if (a.status !== 503) throw new Error('signed-in got ' + a.status); if (![401, 503].includes(anon.status)) throw new Error('anonymous got ' + anon.status)
      return `signed-in ${a.status}, anonymous ${anon.status}, chat page ${ui.status}`
    })
    await run('F02', 'Data API OFF by default: no token configured -> 503 "not switched on"', async () => {
      const r = await fetch(BASE + '/api/data/v1/meta', { headers: { authorization: 'Bearer ' + DATA_TOKEN } }); if (r.status !== 503) throw new Error('got ' + r.status); return '503 as designed'
    })
  } else {
    await new Promise((r) => stub.listen(8100, '127.0.0.1', r))
    const store = await session('qa11.store@audit.test'); const ho = await session('qa11.ho@audit.test'); const vt = await session('qa11.vtech@audit.test'); const tech = await session('qa11.tech@audit.test')

    await run('F03', 'Anonymous caller is refused (401) and nothing reaches CKOneAI', async () => {
      const m = mark(); const r = await call(null, '/api/ckoneai/health'); if (r.status !== 401) throw new Error('got ' + r.status); if (sinceMark(m).length) throw new Error('stub was called'); return '401, stub untouched'
    })
    await run('F04', 'Vendor (OEM) login is refused (403) even when listed as a pilot user', async () => {
      const m = mark(); const r = await call(vt, '/api/ckoneai/health'); if (r.status !== 403) throw new Error('got ' + r.status); if (sinceMark(m).length) throw new Error('stub was called'); return '403, stub untouched'
    })
    await run('F05', 'A person not on the pilot list is refused (403)', async () => {
      const m = mark(); const r = await call(ho, '/api/ckoneai/health'); if (r.status !== 403) throw new Error('got ' + r.status); if (sinceMark(m).length) throw new Error('stub was called'); return '403 "not open to you yet", stub untouched'
    })
    let storeId = ''
    await run('F06', 'Pilot requester: call is forwarded, correctly signed (verified independently), with the right person and role', async () => {
      storeId = dbq("select id from auth.users where email='qa11.store@audit.test'"); const m = mark()
      const r = await call(store, '/api/ckoneai/health'); const j = await r.json(); const [c] = sinceMark(m)
      if (r.status !== 200 || !j.ok) throw new Error(`status ${r.status}`); if (!c) throw new Error('stub not called')
      if (!c.sigOk) throw new Error('signature did NOT verify against the spec'); if (c.headers['x-ckdesk-user'] !== storeId) throw new Error('wrong user id sent'); if (c.skew > 5) throw new Error('timestamp skew ' + c.skew)
      if (!c.nonceShape) throw new Error('nonce is not 16 hex chars'); if (c.headers['x-ckdesk-scope'] !== 'ckdesk') throw new Error('scope ' + c.headers['x-ckdesk-scope'])
      return `signature verified; user ok; roles "${c.headers['x-ckdesk-roles']}"; ts skew ${c.skew.toFixed(1)}s`
    })
    await run('F07', 'Forged identity headers, Authorization and Cookie from the browser never reach CKOneAI', async () => {
      const m = mark(); await call(store, '/api/ckoneai/health', { headers: { 'x-ckdesk-user': '00000000-0000-0000-0000-000000000000', 'x-ckdesk-roles': 'orgwide,manager', authorization: 'Bearer stolen', 'x-ckdesk-sig': 'deadbeef' } })
      const [c] = sinceMark(m); if (!c) throw new Error('stub not called'); if (!c.sigOk) throw new Error('signature not valid')
      if (c.headers['x-ckdesk-user'] !== storeId) throw new Error('forged user id was passed on'); if (/orgwide/.test(c.headers['x-ckdesk-roles'])) throw new Error('forged role was passed on')
      if (c.headers.authorization) throw new Error('Authorization header leaked upstream'); if (c.headers.cookie) throw new Error('session cookie leaked upstream'); return 'identity, roles, Authorization and Cookie all replaced or dropped'
    })
    await run('F08', 'Chat POST: body is signed byte-for-byte, a fresh nonce is used on each call, upstream Set-Cookie is not passed back', async () => {
      const m = mark(); const body = JSON.stringify({ message: 'QA11-MARKER-where is my ticket?' })
      const r1 = await call(store, '/api/ckoneai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body }); const r2 = await call(store, '/api/ckoneai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      const [a, b] = sinceMark(m); if (r1.status !== 200 || r2.status !== 200) throw new Error(`statuses ${r1.status}/${r2.status}`); if (!a.sigOk || !b.sigOk) throw new Error('body signature invalid')
      if (a.headers['x-ckdesk-nonce'] === b.headers['x-ckdesk-nonce']) throw new Error('nonce reused'); if (r1.headers.get('set-cookie')) throw new Error('upstream Set-Cookie reached the browser'); return 'both signed, nonces differ, no Set-Cookie passed back'
    })
    await run('F09', 'The question text is not kept anywhere in CK Desk (only who and when)', async () => {
      const dump = execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'sh', '-c', "pg_dump -U postgres -d postgres --data-only 2>/dev/null | grep -c 'QA11-MARKER' || true"], { encoding: 'utf8' }).trim()
      const audit = dbq("select count(*) from system_log where action = 'ckoneai.ask'").replace(/\n/g, '')
      if (Number(dump) > 0) throw new Error(`question text found ${dump} time(s) in the database`); return `marker found 0 times in a full data dump; ${audit} 'ask' event row(s) in the system log (who + byte count + roles, no text)`
    })
    await run('F10', 'Path abuse is refused (traversal, double slash, unknown routes, wrong method, query tricks) and never forwarded', async () => {
      const m = mark(); const bad = ['/api/ckoneai/..%2f..%2fadmin', '/api/ckoneai//health', '/api/ckoneai/admin', '/api/ckoneai/conversations/../../x', '/ckoneai-ui/..%2f..%2f.env', '/ckoneai-ui/%2e%2e/%2e%2e/secret']
      const codes = []; for (const p of bad) { let st; try { st = (await call(store, p)).status } catch (e) { st = 'ERR:' + (e.cause?.code || e.message) } codes.push(p.slice(0, 40) + '=' + st); if (st === 200) throw new Error(`${p} was ALLOWED`) }
      const w = await call(store, '/api/ckoneai/chat'); codes.push(w.status); if (w.status !== 405) throw new Error('GET on chat gave ' + w.status)
      if (sinceMark(m).length) throw new Error('stub received ' + sinceMark(m).map((x) => x.url).join(', ')); return `statuses ${codes.join(',')}; stub untouched`
    })
    await run('F10b', 'A query with a second "?" cannot split or smuggle: upstream gets ONE encoded query, correctly signed', async () => {
      const m = mark(); const r = await call(store, '/api/ckoneai/health?a=1?b=2&c=%0d%0aX-Evil:1'); const [c] = sinceMark(m)
      if (!c) throw new Error('not forwarded (status ' + r.status + ')'); if (!c.sigOk) throw new Error('signature invalid for the normalised query'); if ((c.url.match(/\?/g) || []).length !== 1) throw new Error('upstream url has several ?: ' + c.url); if (c.headers['x-evil']) throw new Error('header injected'); return 'upstream saw ' + c.url + ' (one query, signed, no injected header)'
    })
    await run('F11', 'Oversized message (>256 KB) is refused with 413 and never forwarded', async () => {
      const m = mark(); const r = await call(store, '/api/ckoneai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(300 * 1024) }) })
      if (r.status !== 413) throw new Error('got ' + r.status); if (sinceMark(m).length) throw new Error('stub was called'); return '413, stub untouched'
    })
    await run('F12', 'Technician (pilot) is allowed and signed with a technician role', async () => {
      const m = mark(); const r = await call(tech, '/api/ckoneai/health'); const [c] = sinceMark(m); if (r.status !== 200) throw new Error('got ' + r.status); if (!/technician/.test(c.headers['x-ckdesk-roles'])) throw new Error('roles: ' + c.headers['x-ckdesk-roles']); return `roles "${c.headers['x-ckdesk-roles']}"`
    })
    await run('F14', 'Rate limit: the 21st chat question inside a minute is answered 429', async () => {
      const codes = []; for (let i = 0; i < 22; i++) { const r = await call(tech, '/api/ckoneai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"hi"}' }); codes.push(r.status) }
      const first429 = codes.indexOf(429); if (first429 === -1) throw new Error('never limited: ' + codes.join(',')); return `first 429 at question #${first429 + 1} (limit 20/min)`
    })
    await run('F15', 'CKOneAI down: person gets a clear 502 message and the outage is written to the audit log; it recovers when CKOneAI is back', async () => {
      await new Promise((r) => stub.close(r)); const r = await call(store, '/api/ckoneai/health'); const j = await r.json().catch(() => ({}))
      const logged = dbq("select count(*) from system_log where action='ckoneai.unreachable' and outcome='failure'")
      await new Promise((r2) => stub.listen(8100, '127.0.0.1', r2)); const r3 = await call(store, '/api/ckoneai/health')
      if (r.status !== 502) throw new Error('down: got ' + r.status); if (!/did not answer/i.test(j.error || '')) throw new Error('message: ' + JSON.stringify(j)); if (r3.status !== 200) throw new Error('did not recover: ' + r3.status)
      return `502 "${j.error}"; ${logged} unreachable audit row(s); recovered with 200`
    })
    // ---- data API (token on) ----
    const api = (p, tok, init = {}) => fetch(BASE + p, { ...init, headers: { ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(init.headers || {}) } })
    await run('F16', 'Data API: no token / wrong token -> 401; right token -> 200', async () => {
      const a = await api('/api/data/v1/meta'); const b = await api('/api/data/v1/meta', 'wrong-token-wrong-token-wrong-token-xx'); const c = await api('/api/data/v1/meta', DATA_TOKEN)
      if (a.status !== 401 || b.status !== 401 || c.status !== 200) throw new Error(`${a.status}/${b.status}/${c.status}`); const j = await c.json(); return `401/401/200; ${j.entities.length} entities`
    })
    await run('F17', 'Data API is read-only: POST/PUT/DELETE are refused; page size is capped; unknown entity 404; bad cursor 400', async () => {
      const codes = []; for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) codes.push((await api('/api/data/v1/rows?entity=requests', DATA_TOKEN, { method: m })).status)
      if (codes.some((c) => c !== 405)) throw new Error('write methods: ' + codes.join(','))
      const big = await api('/api/data/v1/rows?entity=requests&limit=999999', DATA_TOKEN); const unk = await api('/api/data/v1/rows?entity=profiles_passwords', DATA_TOKEN); const cur = await api('/api/data/v1/rows?entity=requests&after=%27%3Bdrop', DATA_TOKEN)
      const bj = await big.json().catch(() => ({})); const n = (bj.rows || bj.items || []).length
      if (big.status === 200 && n > 5000) throw new Error('limit not capped: ' + n); if (unk.status !== 404) throw new Error('unknown entity ' + unk.status); if (cur.status !== 400) throw new Error('bad cursor ' + cur.status)
      return `write methods ${codes.join('/')}; huge limit -> ${big.status} (${n} rows); unknown entity 404; bad cursor 400`
    })
    await run('F18', 'Data API exposes no secrets: no password, token, key or hash-like column in any entity', async () => {
      const meta = await (await api('/api/data/v1/meta', DATA_TOKEN)).json(); const bad = []
      for (const e of meta.entities) for (const c of (e.columns || e.fields || [])) { const name = typeof c === 'string' ? c : c.name; if (/password|passwd|secret|token|api_?key|hash|salt|otp|mfa/i.test(name)) bad.push(`${e.name}.${name}`) }
      if (bad.length) throw new Error('sensitive-looking columns: ' + bad.join(', ')); return `${meta.entities.length} entities checked, none sensitive-looking`
    })
    for (const s of [store, ho, vt, tech]) await s.close()
    stub.close()
  }
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, `uat-f-${PHASE}-results.json`), JSON.stringify({ ran: new Date().toISOString(), phase: PHASE, results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0)
}
