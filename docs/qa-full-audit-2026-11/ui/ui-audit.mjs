// QA 2026-11 — UI / UX / accessibility / responsive sweep. AUDIT app (port 3310) and synthetic personas only.
//   node docs/qa-full-audit-2026-11/ui/ui-audit.mjs [chrome|edge]
// For every persona x page x viewport (360, 390, 768, 1024, 1366, 1920): page loads, no browser errors, no sideways scroll,
// axe-core (WCAG 2.0/2.1/2.2 A+AA rules) violations recorded. Results -> evidence/ui/ui-audit-<browser>.json
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'ui'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310'
const PW = 'QA-Audit-Pw-2026!'
const BROWSER = (process.argv[2] || 'chrome').toLowerCase()
const EXE = BROWSER === 'edge' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const AXE = readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8')
const sql = (q) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { encoding: 'utf8' }).trim()

const ALL_VIEWPORTS = [[360, 740], [390, 844], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]]
// Edge is the same Chromium engine as Chrome: it gets a reduced matrix (3 widths, every 2nd admin page) as a cross-check, Chrome gets the full one.
const VIEWPORTS = BROWSER === 'edge' ? [ALL_VIEWPORTS[0], ALL_VIEWPORTS[3], ALL_VIEWPORTS[4]] : ALL_VIEWPORTS
const storeTicket = sql("select id from requests where requester_id='d3e7261b-b09a-4b21-994e-cc684b3f95b6' order by created_at desc limit 1") || sql('select id from requests order by created_at desc limit 1')
const anyTicket = sql('select id from requests order by created_at desc limit 1')
const vendTicket = sql("select id from requests where assigned_to='22edadf3-1970-49f7-ba94-c684281fdb54' order by created_at desc limit 1") || anyTicket
const svcSlug = sql('select slug from services order by created_at limit 1')

const ADMIN = ['/home', '/admin/users', '/admin/teams', '/admin/roles', '/admin/services', '/admin/categories', '/admin/sla-policies', '/admin/business-rules', '/admin/approvals', '/admin/vendors', '/admin/programs',
  '/admin/settings', '/admin/org', '/admin/masters', '/admin/master-data', '/admin/form-templates', '/admin/field-library', '/admin/request-config', '/admin/task-config', '/admin/knowledge-base',
  '/admin/reports', '/admin/audit', '/admin/logs', '/admin/system-log', '/admin/event-log', '/admin/monitoring', '/admin/runbooks', '/admin/stuck-tickets', '/admin/desktime',
  '/intake', '/intake/inbox', '/intake/queue', '/intake/channels', '/intake/rules', '/intake/settings', '/dashboards', '/dashboards/executive', '/reports/analytics', '/reports/pivot',
  '/zoho', '/zoho/reports', '/zoho/tickets', '/projects', '/purchase-orders', '/ckoneai', '/requests', '/requests/queue', '/requests/' + anyTicket, '/tasks', '/approvals', '/notifications', '/profile', '/services', '/services/' + svcSlug]
const PLAN = [
  { who: 'qa11.store@audit.test', role: 'store requester', pages: ['/home', '/services', '/services/' + svcSlug, '/requests', '/requests/' + storeTicket, '/notifications', '/profile'] },
  { who: 'qa11.ho@audit.test', role: 'head-office requester', pages: ['/home', '/services', '/requests', '/notifications'] },
  { who: 'qa11.tech@audit.test', role: 'technician', pages: ['/home', '/requests', '/requests/queue', '/requests/' + anyTicket, '/tasks', '/approvals', '/notifications'] },
  { who: 'qa11.techmgr@audit.test', role: 'technician manager', pages: ['/home', '/requests/queue', '/dashboards', '/dashboards/executive', '/reports/analytics', '/reports/pivot', '/zoho', '/projects', '/purchase-orders'] },
  { who: 'qa11.approver@audit.test', role: 'approver', pages: ['/home', '/approvals', '/notifications'] },
  { who: 'qa11.admin@audit.test', role: 'administrator', pages: BROWSER === 'edge' ? ADMIN.filter((_, i) => i % 2 === 0) : ADMIN },
  { who: 'qa11.vtech@audit.test', role: 'vendor technician', pages: ['/vendor', '/vendor/pos', '/vendor/tickets/' + vendTicket] },
  { who: 'qa11.vmgr@audit.test', role: 'vendor manager', pages: ['/vendor', '/vendor/pos'] },
  { who: null, role: 'not signed in', pages: ['/login', '/forgot-password', '/reset-password', '/csat/not-a-real-token', '/approve/not-a-real-token'] },
]
const only = process.env.ONLY_ROLE
const results = []
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] })
const ver = await browser.version()
console.log(`${BROWSER} ${ver}  ticket=${storeTicket} vendor=${vendTicket} svc=${svcSlug}`)

async function login(page, email) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' })
  await page.type('input[type="email"]', email); await page.type('input[type="password"]', PW)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
}

for (const grp of PLAN) {
  if (only && grp.role !== only) continue
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage()
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)) })
  try { if (grp.who) { await page.setViewport({ width: 1366, height: 768 }); await login(page, grp.who) } } catch (e) { results.push({ role: grp.role, page: 'LOGIN', vw: 0, status: 'FAIL', note: String(e.message).slice(0, 200) }); await ctx.close(); continue }
  for (const url of grp.pages) {
    for (const [w, h] of VIEWPORTS) {
      const row = { role: grp.role, page: url, vw: w, status: 'PASS', overflow: false, errors: [], axe: [], note: '' }
      try {
        errs.length = 0
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w <= 480, hasTouch: w <= 768 })
        const resp = await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => { throw new Error('nav: ' + e.message) })
        await wait(700)
        const final = new URL(page.url()).pathname
        row.http = resp?.status(); row.final = final
        if (final !== url.split('?')[0]) row.note = 'redirected to ' + final
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bodyText: document.body.innerText.slice(0, 400), title: document.title }))
        row.overflow = m.sw > m.iw + 1; row.scrollWidth = m.sw; row.title = m.title
        if (/application error|something went wrong|unhandled runtime error|internal server error/i.test(m.bodyText)) { row.status = 'FAIL'; row.note += ' error page: ' + m.bodyText.slice(0, 120).replace(/\s+/g, ' ') }
        if (row.http >= 500) { row.status = 'FAIL'; row.note += ' HTTP ' + row.http }
        await page.evaluate(AXE)
        row.axe = await page.evaluate(async () => {
          const r = await window.axe.run({ exclude: [['nextjs-portal'], ['#__next-build-watcher']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, tags: v.tags.filter((t) => /^wcag\d/.test(t) || t === 'best-practice').join(','), n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ').slice(0, 120)) }))
        })
        row.errors = errs.slice(0, 3)
      } catch (e) { row.status = 'FAIL'; row.note += ' ' + String(e.message).slice(0, 160) }
      results.push(row)
      const flags = [row.overflow ? 'OVERFLOW' : '', row.axe.filter((a) => a.impact === 'critical' || a.impact === 'serious').length ? 'AXE-SERIOUS' : '', row.errors.length ? 'JSERR' : '', row.note.trim()].filter(Boolean).join(' ')
      console.log(`${row.status} ${grp.role} ${url} @${w} ${flags}`)
    }
  }
  await ctx.close()
}
await browser.close()
writeFileSync(path.join(OUT, `ui-audit-${BROWSER}${only ? '-' + only.replace(/\W+/g, '_') : ''}.json`), JSON.stringify({ ran: new Date().toISOString(), browser: BROWSER, version: ver, viewports: VIEWPORTS, results }, null, 1))
console.log('done', results.length, 'checks')
