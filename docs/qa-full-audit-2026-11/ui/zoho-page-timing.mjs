// QA 2026-11 stage 4 — how long do the new Zoho screens take to answer with the large (10,000-ticket) made-up set in the audit Zoho database? AUDIT app only (port 3310).
//   node docs/qa-full-audit-2026-11/ui/zoho-page-timing.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'evidence', 'perf-zoho'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310', PW = 'QA-Audit-Pw-2026!'
const puppeteer = createRequire(import.meta.url)('C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
const p = await browser.newPage(); await p.setViewport({ width: 1366, height: 900 })
await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', 'qa11.admin@audit.test'); await p.type('input[type="password"]', PW)
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })

const PAGES = [
  ['Zoho overview (10,000+ tickets)', '/zoho'],
  ['Mapping: templates', '/zoho/mapping?tab=templates&template=' + encodeURIComponent('AC Issues Log System Only - Admin Team')],
  ['Mapping: statuses', '/zoho/mapping?tab=statuses'],
  ['Mapping: requesters (every Zoho person)', '/zoho/mapping?tab=requesters'],
  ['Move: preview of the newest 200 of 10,000', '/zoho/move?go=1&numbers=800001-810000'],
  ['Move: preview, only not moved', '/zoho/move?go=1&numbers=800001-810000&moved=not'],
  ['Find a ticket: one ticket', '/zoho/tickets?no=800010'],
  ['Find a ticket: word search', '/zoho/tickets?q=Scale%20ticket%20123'],
]
const rows = []
for (const [name, url] of PAGES) {
  const ms = []
  for (let i = 0; i < 4; i++) {
    const t = Date.now(); const r = await p.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 120000 })
    const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { ttfb: Math.round(n.responseStart), done: Math.round(n.responseEnd) } })
    ms.push({ total: Date.now() - t, ttfb: nav.ttfb, status: r.status() })
  }
  const first = ms[0], rest = ms.slice(1)
  rows.push({ name, url, firstLoadMs: first.total, warmMsEach: rest.map((x) => x.total), warmTtfbMs: rest.map((x) => x.ttfb), status: first.status })
  console.log(name.padEnd(46), 'first', first.total, 'ms  warm', rest.map((x) => x.total).join('/'), 'ms  ttfb', rest.map((x) => x.ttfb).join('/'), 'ms  HTTP', first.status)
}
await browser.close()
writeFileSync(path.join(OUT, 'page-timing.json'), JSON.stringify({ ran: new Date().toISOString(), note: 'audit app in DEVELOPMENT mode (slower than production); 10,000-ticket made-up Zoho set', rows }, null, 1))
