// QA 2026-11 stage 4 — the new Zoho transfer screens in a REAL browser: accessibility (axe, WCAG 2.0 to 2.2 A/AA + best practice), sideways scroll, console errors, the confirm steps
// (focus must move into the dialog), and who may open them. AUDIT app only (port 3310); it NEVER presses a move / save / switch button.
//   node docs/qa-full-audit-2026-11/ui/ui-zoho.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'ui'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310', PW = 'QA-Audit-Pw-2026!'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)('C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const AXE = readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8')
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const PAGES = [
  '/zoho',
  '/zoho/mapping', '/zoho/mapping?tab=statuses', '/zoho/mapping?tab=requesters', '/zoho/mapping?tab=technicians',
  '/zoho/mapping?tab=templates&template=' + encodeURIComponent('AC Issues Log System Only - Admin Team'),
  '/zoho/move', '/zoho/move?go=1&numbers=700001-700012&moved=not',
  '/zoho/tickets?no=700001', '/zoho/tickets?q=Demo%20Admin-AC',
]
const WIDTHS = [360, 768, 1366]
const results = []
const log = (r) => { results.push(r); console.log(r.status, r.name, r.note || '') }

const browser = await puppeteer.launch({ executablePath: process.env.BROWSER_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })

async function signIn(email) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage()
  await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', email); await p.type('input[type="password"]', PW)
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')])
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  return { ctx, p }
}
async function axeRun(p) {
  await p.evaluate(AXE)
  return p.evaluate(async (tags) => (await window.axe.run({ exclude: [['nextjs-portal']] }, { runOnly: { type: 'tag', values: tags } })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.html?.slice(0, 120) })), TAGS)
}

// ── administrator: every page, every width ─────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await signIn('qa11.admin@audit.test')
  const consoleErrors = []; p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) }); p.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)))
  for (const w of WIDTHS) {
    await p.setViewport({ width: w, height: 900 })
    for (const pg of PAGES) {
      consoleErrors.length = 0
      await p.goto(BASE + pg, { waitUntil: 'networkidle2', timeout: 60000 }); await wait(700)
      const v = await axeRun(p)
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical')
      log({ name: `admin ${pg} @${w}`, status: bad.length || overflow > 2 || consoleErrors.length ? 'FAIL' : v.length ? 'NOTE' : 'PASS', axe: v, overflow, consoleErrors: [...consoleErrors], note: [...bad.map((x) => `${x.id}x${x.n}`), overflow > 2 ? `overflow ${overflow}px` : '', ...consoleErrors.map((e) => 'console: ' + e)].filter(Boolean).join(' ') })
    }
  }

  // the confirm steps: the page must move focus into the dialog (so a keyboard or screen-reader user lands on it), and Escape / Cancel must close it
  await p.setViewport({ width: 1366, height: 900 })
  await p.goto(BASE + '/zoho/move?go=1&numbers=700001-700012&moved=not', { waitUntil: 'networkidle2' }); await wait(500)
  const clickText = (re) => p.evaluate((src) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test(x.textContent || '')); if (b) b.click(); return !!b }, re.source)
  const focusInDialog = (label) => p.evaluate((l) => { const d = document.querySelector(`[role=alertdialog][aria-label="${l}"]`); return !!d && d.contains(document.activeElement) }, label)

  await clickText(/Check what would move/); await p.waitForFunction(() => /could be moved|can be moved|Nothing to move/.test(document.body.innerText), { timeout: 30000 }).catch(() => {}); await wait(500)
  const afterPrep = await axeRun(p)
  log({ name: 'admin run panel: after "Check what would move"', status: afterPrep.some((x) => x.impact === 'serious' || x.impact === 'critical') ? 'FAIL' : 'PASS', axe: afterPrep })
  await clickText(/Move these \d+ tickets/); await wait(400)
  const f1 = await focusInDialog('Confirm the run')
  log({ name: 'run confirm dialog moves focus inside', status: f1 ? 'PASS' : 'FAIL', note: f1 ? '' : 'focus stayed behind the dialog' })
  const aDlg = await axeRun(p); log({ name: 'run confirm dialog axe', status: aDlg.some((x) => x.impact === 'serious' || x.impact === 'critical') ? 'FAIL' : 'PASS', axe: aDlg })
  await p.keyboard.press('Escape'); await wait(300)
  const closed = !(await p.evaluate(() => !!document.querySelector('[role=alertdialog][aria-label="Confirm the run"]')))
  log({ name: 'Escape closes the run confirm dialog', status: closed ? 'PASS' : 'FAIL' })

  await p.evaluate(() => { const b = document.querySelector('input[name=n]'); if (b) b.click() }); await clickText(/Move the ticked tickets/); await wait(400)
  const f2 = await focusInDialog('Confirm the move'); log({ name: 'move confirm dialog moves focus inside', status: f2 ? 'PASS' : 'FAIL', note: f2 ? '' : 'focus stayed behind the dialog' })
  await p.keyboard.press('Escape'); await wait(300)
  log({ name: 'Escape closes the move confirm dialog', status: !(await p.evaluate(() => !!document.querySelector('[role=alertdialog][aria-label="Confirm the move"]'))) ? 'PASS' : 'FAIL' })

  await clickText(/Switch ON/); await wait(400)
  const f3 = await focusInDialog('Confirm'); log({ name: 'switch confirm dialog moves focus inside', status: f3 ? 'PASS' : 'FAIL', note: f3 ? '' : 'focus stayed behind the dialog' })
  await p.keyboard.press('Escape'); await wait(300)
  log({ name: 'Escape closes the switch confirm dialog', status: !(await p.evaluate(() => !!document.querySelector('[role=alertdialog][aria-label="Confirm"]'))) ? 'PASS' : 'FAIL' })

  // every control on the mapping page has a name (the audit's rule), and the whole page can be reached with the keyboard
  await p.goto(BASE + '/zoho/mapping?tab=templates&template=' + encodeURIComponent('AC Issues Log System Only - Admin Team'), { waitUntil: 'networkidle2' }); await wait(500)
  const unnamed = await p.evaluate(() => [...document.querySelectorAll('select, input:not([type=hidden]), button')].filter((e) => !(e.getAttribute('aria-label') || e.labels?.length || (e.textContent || '').trim() || e.getAttribute('title'))).map((e) => e.outerHTML.slice(0, 100)))
  log({ name: 'mapping page: every select / input / button has a name', status: unnamed.length ? 'FAIL' : 'PASS', note: unnamed.join(' | ') })
  await ctx.close()
}

// ── a manager may LOOK but not change; a plain requester and a vendor cannot open the Zoho pages at all ─────────────────────────────────────────────
{
  const { ctx, p } = await signIn('qa11.techmgr@audit.test'); await p.setViewport({ width: 1366, height: 900 })
  await p.goto(BASE + '/zoho/mapping', { waitUntil: 'networkidle2' }); await wait(500)
  const readOnly = await p.evaluate(() => ({ save: [...document.querySelectorAll('button')].some((b) => /Save this template|Suggest the blanks/.test(b.textContent || '')), disabled: [...document.querySelectorAll('select')].every((s) => s.disabled), note: /Only an administrator can change it/.test(document.body.innerText) }))
  log({ name: 'manager sees the mapping read-only (no Save, selects disabled, a note says so)', status: !readOnly.save && readOnly.disabled && readOnly.note ? 'PASS' : 'FAIL', note: JSON.stringify(readOnly) })
  await p.goto(BASE + '/zoho/move?go=1&numbers=700001-700012&moved=not', { waitUntil: 'networkidle2' }); await wait(500)
  const mgrMove = await p.evaluate(() => ({ tick: document.querySelectorAll('input[name=n]').length, moveBtn: [...document.querySelectorAll('button')].some((b) => /Move the ticked|Check what would move|Switch ON/.test(b.textContent || '')) }))
  log({ name: 'manager can preview but has no move / run / switch buttons', status: mgrMove.tick === 0 && !mgrMove.moveBtn ? 'PASS' : 'FAIL', note: JSON.stringify(mgrMove) })
  await ctx.close()
}
for (const who of ['qa11.store@audit.test', 'qa11.tech@audit.test', 'qa11.vtech@audit.test']) {
  const { ctx, p } = await signIn(who)
  for (const pg of ['/zoho', '/zoho/mapping', '/zoho/move', '/zoho/tickets']) {
    await p.goto(BASE + pg, { waitUntil: 'networkidle2' }).catch(() => {}); await wait(300)
    const here = new URL(p.url()).pathname
    log({ name: `${who.split('@')[0]} cannot open ${pg}`, status: here.startsWith('/zoho') ? 'FAIL' : 'PASS', note: `ended on ${here}` })
  }
  await ctx.close()
}
await browser.close()
writeFileSync(path.join(OUT, process.env.BROWSER_EXE ? 'ui-zoho-edge.json' : 'ui-zoho.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1))
const c = (s) => results.filter((r) => r.status === s).length
console.log(`PASS ${c('PASS')}  NOTE ${c('NOTE')}  FAIL ${c('FAIL')}  of ${results.length}`); process.exit(c('FAIL') ? 1 : 0)
