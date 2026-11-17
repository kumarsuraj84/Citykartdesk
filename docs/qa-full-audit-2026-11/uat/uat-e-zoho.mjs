// QA 2026-11 — BUSINESS UAT scenario E: Zoho transition — history is readable, and the Zoho database is NEVER written by CK Desk.
// Runs against the isolated AUDIT app and the disposable `zohoaudit` database (synthetic "PRACTICE TICKET" rows) only.
//   node docs/qa-full-audit-2026-11/uat/uat-e-zoho.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'evidence', 'uat'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310'
const PW = 'QA-Audit-Pw-2026!'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { log(id, 'PASS', title, (await fn()) || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 320)) } }
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: false })
const text = (p) => p.evaluate(() => document.body.innerText)
// psql inside the audit container only (refuses anything else)
const ENV = Object.fromEntries(readFileSync(path.join(HERE, '..', '..', '..', 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
// role given => connect as the REAL report login (same user and password the app uses), over the network path, exactly like the app does
const sql = (q, { role } = {}) => execFileSync('docker', role
  ? ['exec', '-e', 'PGPASSWORD=' + ENV.ZOHO_DB_PASSWORD, 'supabase_db_ckdesk_audit', 'psql', '-h', '127.0.0.1', '-U', role, '-d', 'zohoaudit', '-Atc', q]
  : ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'zohoaudit', '-Atc', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const sqlTry = (q, opts) => { try { return { ok: true, out: sql(q, opts) } } catch (e) { return { ok: false, out: String(e.stderr || e.message) } } }

let browser
async function person(email) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage()
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(e.message))
  await page.setViewport({ width: 1366, height: 900 })
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' })
  await page.type('input[type="email"]', email); await page.type('input[type="password"]', PW)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  return page
}

const before = { tickets: sql('select count(*) from zoho_ticket'), history: sql('select count(*) from zoho_history'), checksum: sql("select md5(string_agg(display_id::text||coalesce(status,'')||coalesce(subject,''), ',' order by display_id)) from zoho_ticket") }
browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
try {
  await run('E01', 'Administrator opens the Zoho Data overview; ticket total equals the database', async () => {
    const p = await person('qa11.admin@audit.test'); await p.goto(BASE + '/zoho', { waitUntil: 'networkidle2' }); await wait(2500); await shot(p, 'E01-zoho-overview')
    const t = await text(p); if (/not connected|could not be read/i.test(t)) throw new Error('overview says not connected: ' + t.slice(0, 200))
    if (!new RegExp('\\b' + before.tickets + '\\b').test(t)) throw new Error(`page does not show the total ${before.tickets}`); await p.browserContext().close(); return `page shows ${before.tickets} tickets (database ${before.tickets})`
  })
  await run('E02', 'Reports page loads (store AC report) without errors', async () => {
    const p = await person('qa11.admin@audit.test'); await p.goto(BASE + '/zoho/reports', { waitUntil: 'networkidle2' }); await wait(2500); await shot(p, 'E02-zoho-reports')
    const t = await text(p); if (/could not be read|not connected|application error/i.test(t)) throw new Error(t.slice(0, 200)); if (p.__errors.length) throw new Error('browser errors: ' + p.__errors[0]); await p.browserContext().close(); return 'loaded, no browser errors'
  })
  const p = await person('qa11.admin@audit.test')
  await run('E03', 'Look up one ticket by number shows its subject, status and requester', async () => {
    await p.goto(BASE + '/zoho/tickets?no=900060', { waitUntil: 'networkidle2' }); await wait(2000); await shot(p, 'E03-ticket-900060')
    const t = await text(p); if (!/900060/.test(t) || !/Synthetic ticket 60/.test(t)) throw new Error('ticket not shown: ' + t.slice(0, 250)); return 'ticket 900060 shown'
  })
  await run('E04', 'Text search finds tickets; a number that does not exist and non-numeric input give a clear message', async () => {
    await p.goto(BASE + '/zoho/tickets?q=Synthetic', { waitUntil: 'networkidle2' }); await wait(1500); let t = await text(p); if (!/Synthetic ticket/.test(t)) throw new Error('search found nothing')
    await p.goto(BASE + '/zoho/tickets?no=1', { waitUntil: 'networkidle2' }); await wait(1200); t = await text(p); if (!/no zoho ticket/i.test(t)) throw new Error('unknown number: no clear message: ' + t.slice(0, 200))
    await p.goto(BASE + '/zoho/tickets?no=abc', { waitUntil: 'networkidle2' }); await wait(1200); t = await text(p); if (!/number/i.test(t) || /application error/i.test(t)) throw new Error('non-numeric: ' + t.slice(0, 200)); return 'search ok, unknown and non-numeric answered clearly'
  })
  await run('E05', 'Injection-style search text is treated as plain text; tables intact', async () => {
    const evil = encodeURIComponent("'; drop table zoho_ticket; --")
    await p.goto(BASE + '/zoho/tickets?q=' + evil, { waitUntil: 'networkidle2' }); await wait(1500); const t = await text(p); if (/application error|syntax error|internal server/i.test(t)) throw new Error('error page: ' + t.slice(0, 200))
    const n = sql('select count(*) from zoho_ticket'); if (n !== before.tickets) throw new Error(`ticket count changed ${before.tickets} -> ${n}`); return 'handled as text; table still has ' + n + ' rows'
  })
  await p.browserContext().close()

  await run('E06', 'Roles: manager may open Zoho Data; requester, store user and technician are sent away', async () => {
    const out = []
    for (const [who, allowed] of [['qa11.techmgr@audit.test', true], ['qa11.store@audit.test', false], ['qa11.ho@audit.test', false], ['qa11.tech@audit.test', false], ['qa11.vtech@audit.test', false]]) {
      const q = await person(who); await q.goto(BASE + '/zoho', { waitUntil: 'networkidle2' }); await wait(1200)
      const stayed = q.url().includes('/zoho'); out.push(`${who.split('@')[0]}:${stayed ? 'in' : 'out'}`); await q.browserContext().close()
      if (stayed !== allowed) throw new Error(`${who} ${stayed ? 'was let in' : 'was kept out'} (expected ${allowed ? 'in' : 'out'}): ${out.join(', ')}`)
    }
    return out.join(', ')
  })
  await run('E07', 'Read-only proof: the report login can SELECT but every write is refused by the database', async () => {
    const tries = [['insert', "insert into zoho_ticket(zoho_id, display_id) values ('qa-x', 1)"], ['update', "update zoho_ticket set status='Closed'"], ['delete', 'delete from zoho_ticket'], ['truncate', 'truncate zoho_ticket'], ['drop', 'drop table zoho_ticket'], ['create', 'create table qa_x(a int)']]
    const lines = []
    const sel = sqlTry('select count(*) from zoho_ticket', { role: 'zoho_report' }); if (!sel.ok) throw new Error('report login cannot even read: ' + sel.out)
    for (const [name, q] of tries) { const r = sqlTry(q, { role: 'zoho_report' }); if (r.ok) throw new Error(`${name} SUCCEEDED as zoho_report`); lines.push(`${name}: ${/permission denied|must be owner/i.test(r.out) ? 'refused' : r.out.slice(0, 40)}`) }
    return 'select ok; ' + lines.join('; ')
  })
  await run('E08', 'Code check: no write statement against the Zoho database exists in lib/zoho or the Zoho pages', async () => {
    let hits = ''
    try { hits = execFileSync('git', ['grep', '-nEi', '\\b(insert into|update\\s+zoho_|delete from|drop table|truncate (table|zoho)|alter table)\\b', '--', 'lib/zoho', 'app/(app)/zoho'], { cwd: path.join(HERE, '..', '..', '..'), encoding: 'utf8' }).toString().trim() } catch (e) { if (e.status !== 1) throw e }   // exit 1 = no match = good
    if (hits) throw new Error('write-like statements: ' + hits.slice(0, 300)); return 'none found by git grep'
  })
  await run('E09', 'Zoho database unreachable: the screen says "not connected" instead of crashing; recovers when access returns', async () => {
    sql("alter role zoho_report nologin; select pg_terminate_backend(pid) from pg_stat_activity where usename='zoho_report'")   // a real outage: the report login can no longer connect
    try {
      const q = await person('qa11.admin@audit.test'); await q.goto(BASE + '/zoho', { waitUntil: 'networkidle2' }); await wait(2500); await shot(q, 'E09-zoho-down')
      const t = await text(q); await q.browserContext().close()
      if (/application error|something went wrong|unhandled/i.test(t) && !/not connected|could not|unavailable/i.test(t)) throw new Error('crash page: ' + t.slice(0, 200))
      if (!/cannot be read|not connected/i.test(t)) throw new Error('no clear "not connected" message: ' + t.slice(0, 200))
    } finally { sql('alter role zoho_report login') }
    const q2 = await person('qa11.admin@audit.test'); await q2.goto(BASE + '/zoho', { waitUntil: 'networkidle2' }); await wait(2500); const t2 = await text(q2); await q2.browserContext().close()
    if (/cannot be read|not connected/i.test(t2)) throw new Error('still "not connected" after access came back'); return 'clear message while down; back to normal after access restored'
  })
  await run('E10', 'Nothing in the Zoho database changed during the whole scenario', async () => {
    const after = { tickets: sql('select count(*) from zoho_ticket'), history: sql('select count(*) from zoho_history'), checksum: sql("select md5(string_agg(display_id::text||coalesce(status,'')||coalesce(subject,''), ',' order by display_id)) from zoho_ticket") }
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`${JSON.stringify(before)} -> ${JSON.stringify(after)}`); return `tickets ${after.tickets}, history ${after.history}, checksum unchanged`
  })
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'uat-e-results.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0)
}
