// QA 2026-11 — screenshot evidence pack (synthetic audit data only).
import { execFileSync } from 'node:child_process'; import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url)); const OUT = path.join(HERE, '..', 'evidence', 'ui', 'screens')
const puppeteer = createRequire(import.meta.url)('C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const anyTicket = execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'select id from requests order by created_at desc limit 1'], { encoding: 'utf8' }).trim()
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [who, name, pages] of [[null, 'public', [['/login', 'login']]], ['qa11.store@audit.test', 'store', [['/home', 'home'], ['/services', 'services']]], ['qa11.tech@audit.test', 'tech', [['/requests/' + anyTicket, 'ticket'], ['/requests/queue', 'queue']]], ['qa11.admin@audit.test', 'admin', [['/admin/users', 'users'], ['/admin/reports', 'reports']]]]) {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 800 })
  if (who) { await p.goto('http://localhost:3310/login'); await p.type('input[type="email"]', who); await p.type('input[type="password"]', 'QA-Audit-Pw-2026!'); await Promise.all([p.waitForNavigation().catch(() => {}), p.click('button[type="submit"]')]); await wait(1500) }
  for (const [url, nm] of pages) for (const [w, h] of [[360, 740], [768, 1024], [1366, 800], [1920, 1080]]) {
    await p.setViewport({ width: w, height: h, isMobile: w < 480, hasTouch: w < 768 }); await p.goto('http://localhost:3310' + url, { waitUntil: 'networkidle2' }); await wait(900)
    await p.screenshot({ path: path.join(OUT, `${name}-${nm}-${w}.png`) })
  }
  await ctx.close()
}
await b.close(); console.log('done')
