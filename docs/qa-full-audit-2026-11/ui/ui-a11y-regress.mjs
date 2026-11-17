// QA 2026-11 — accessibility REGRESSION test for the defects fixed in this audit (UI-001..UI-00x).
// It must FAIL before the fixes and PASS after. AUDIT app only (port 3310).
//   node docs/qa-full-audit-2026-11/ui/ui-a11y-regress.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'ui'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310', PW = 'QA-Audit-Pw-2026!'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const AXE = readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8')
// page -> axe rules that must be clean on it
const CASES = [
  { who: null, pages: ['/login', '/forgot-password', '/reset-password', '/csat/not-a-real-token', '/approve/not-a-real-token'], rules: ['landmark-one-main'] },
  { who: 'qa11.admin@audit.test', pages: ['/admin/reports', '/dashboards', '/admin/audit', '/admin/stuck-tickets', '/intake/inbox', '/intake/settings', '/admin/approvals', '/admin/master-data', '/admin/task-config', '/dashboards/executive'], rules: ['button-name', 'label', 'select-name', 'label-title-only', 'empty-heading'] },
  { who: 'qa11.admin@audit.test', pages: ['/admin/runbooks', '/tasks'], rules: ['landmark-no-duplicate-main', 'page-has-heading-one'] },
  { who: 'qa11.admin@audit.test', pages: ['/zoho/reports', '/zoho', '/admin/event-log', '/tasks'], rules: ['scrollable-region-focusable'], vw: 360 },
]
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
const results = []
for (const c of CASES) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: c.vw || 1366, height: 800 })
  if (c.who) { await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', c.who); await p.type('input[type="password"]', PW); await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 }) }
  for (const pg of c.pages) {
    await p.goto(BASE + pg, { waitUntil: 'networkidle2', timeout: 60000 }); await wait(800); await p.evaluate(AXE)
    const v = await p.evaluate(async (rules, include) => (await window.axe.run(include ? { include: [[include]] } : { exclude: [['nextjs-portal']] }, { runOnly: { type: 'rule', values: rules } })).violations.map((x) => ({ id: x.id, n: x.nodes.length, sample: x.nodes[0].target.join(' ').slice(0, 90) })), c.rules, c.include || null)
    const row = { page: pg, vw: c.vw || 1366, status: v.length ? 'FAIL' : 'PASS', violations: v }; results.push(row); console.log(row.status, pg, '@' + row.vw, v.map((x) => `${x.id}x${x.n}`).join(' '))
  }
  await ctx.close()
}
await browser.close()
writeFileSync(path.join(OUT, 'ui-a11y-regress.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1))
const f = results.filter((r) => r.status === 'FAIL').length; console.log(`${results.length - f}/${results.length} pages clean`); process.exit(f ? 1 : 0)
