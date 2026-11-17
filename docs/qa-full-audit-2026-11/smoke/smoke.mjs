// QA 2026-11 — SMOKE SUITE (13 checks). Black-box, through a real Chrome, against the isolated AUDIT app only (localhost:3310).
//   1 install once, outside the repo:  npm i --prefix <anywhere> puppeteer-core      then  set PUPPETEER_CORE=<that folder>/node_modules/puppeteer-core
//   2 start the audit app, then:       node docs/qa-full-audit-2026-11/smoke/smoke.mjs
// Writes evidence/smoke/results.json and one screenshot per step. Exit code 1 if any step fails.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))   // fileURLToPath: a plain .pathname keeps %20 for spaces and writes to the wrong folder
const OUT = path.join(HERE, '..', 'evidence', 'smoke')
mkdirSync(OUT, { recursive: true })
const BASE = process.env.QA_BASE || 'http://localhost:3310'
if (!/^http:\/\/(localhost|127\.0\.0\.1):33\d\d$/.test(BASE)) throw new Error('Refusing: smoke tests run against the local audit app only.')
const PW = 'QA-Audit-Pw-2026!'
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const CHROME = process.env.QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const stamp = Date.now().toString().slice(-6)

const results = []
const state = { ticketId: null, ticketNo: null, subject: `SMOKE ${stamp} billing counter fault` }
let browser

async function person(email) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.__errors = []
  page.on('pageerror', (e) => page.__errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of (401|403|404)/.test(m.text())) page.__errors.push(m.text().slice(0, 160)) })
  await page.setViewport({ width: 1366, height: 900 })
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' })
  await page.type('input[type="email"]', email)
  await page.type('input[type="password"]', PW)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  return page
}
async function clickText(page, re, { last = false } = {}) {
  const pt = await page.evaluate((src, lastOne) => {
    const rx = new RegExp(src, 'i')
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')].filter((e) => e.offsetParent !== null && !e.disabled && rx.test((e.innerText || '').replace(/\s+/g, ' ').trim()))
    if (!els.length) return null
    const el = lastOne ? els[els.length - 1] : els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0]
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, re.source, last)
  if (!pt) throw new Error(`no visible control matching ${re}`)
  await page.mouse.click(pt.x, pt.y); await wait(900)
}
async function pickBox(page, placeholder) {
  const box = await page.$(`input[placeholder="${placeholder}"]`)
  if (!box) throw new Error(`no box "${placeholder}"`)
  await box.click(); await wait(600)
  const picked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="option"], li button, ul li')].filter((e) => e.offsetParent !== null && (e.innerText || '').trim().length > 1)[0]
    if (!el) return null
    const t = el.innerText.trim(); el.click(); return t
  })
  await wait(700)
  if (!picked) throw new Error(`nothing to pick in "${placeholder}"`)
  return picked
}
async function fillText(page, sel, text) { const el = await page.$(sel); if (!el) throw new Error(`no field ${sel}`); await el.click({ clickCount: 3 }); await el.type(text, { delay: 8 }) }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') })
async function bodyHas(page, re) { return re.test(await page.evaluate(() => document.body.innerText)) }

async function step(id, title, fn) {
  const t0 = Date.now(); let page
  try { const r = await fn((p) => (page = p)); results.push({ id, title, status: 'PASS', ms: Date.now() - t0, detail: r || '' }); console.log(`PASS  ${id}  ${title}${r ? '  — ' + r : ''}`) }
  catch (e) {
    results.push({ id, title, status: 'FAIL', ms: Date.now() - t0, detail: String(e.message || e).slice(0, 300) }); console.log(`FAIL  ${id}  ${title}  — ${String(e.message || e).slice(0, 200)}`)
    try { if (page) await shot(page, `${id}-FAILED`) } catch {}
  }
}

browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  await step('S01', 'Application starts and reports healthy', async () => {
    const r = await fetch(BASE + '/api/health'); const j = await r.json()
    if (r.status !== 200 || j.status !== 'ok' || j.db !== 'ok') throw new Error(JSON.stringify(j))
    return `status ${j.status}, db ${j.db}`
  })

  await step('S02', 'Requester can sign in', async (use) => {
    const p = use(await person('qa11.store@audit.test')); if (!p.url().endsWith('/home')) throw new Error('landed on ' + p.url()); await shot(p, 'S02-requester-home')
    if (p.__errors.length) throw new Error('browser errors: ' + p.__errors.slice(0, 2).join(' | '))
    await p.browserContext().close()
  })

  await step('S03', 'Requester dashboard loads', async (use) => {
    const p = use(await person('qa11.store@audit.test')); await p.goto(BASE + '/home', { waitUntil: 'networkidle2' }); await wait(1000)
    if (!(await bodyHas(p, /Good (morning|afternoon|evening)/))) throw new Error('no greeting'); if (!(await bodyHas(p, /New Request/))) throw new Error('no New Request action')
    await shot(p, 'S03-dashboard'); await p.browserContext().close()
  })

  await step('S04', 'Ticket creation works (form -> submit -> ticket page)', async (use) => {
    const p = use(await person('qa11.store@audit.test')); await p.goto(BASE + '/services/qa-it-support', { waitUntil: 'networkidle2' }); await wait(1200)
    const cat = await pickBox(p, 'Search category…'); const sub = await pickBox(p, 'Search sub category…')
    await fillText(p, 'input[placeholder="Enter subject…"]', state.subject); await fillText(p, 'textarea[placeholder="Enter description…"]', 'Smoke test: the billing counter printer stops after two bills. Please check.')
    await shot(p, 'S04-form-filled')
    const before = p.url(); await clickText(p, /^submit request$/)
    await p.waitForFunction((u) => location.href !== u && /\/requests\/[0-9a-f-]{36}/.test(location.href), { timeout: 30000 }, before)
    state.ticketId = p.url().match(/\/requests\/([0-9a-f-]{36})/)[1]
    await p.waitForFunction(() => /\b[A-Z]{2,6}-\d{4,}\b/.test(document.body.innerText), { timeout: 20000 }).catch(() => {})   // the page may still be rendering after the redirect
    state.ticketNo = (await p.evaluate(() => (document.body.innerText.match(/\b[A-Z]{2,6}-\d{4,}\b/) || [''])[0])) || null   // (await p.evaluate(...))[0]: index the RESULT, not the promise
    if (!state.ticketNo) throw new Error('the ticket page shows no ticket number')
    await shot(p, 'S04-ticket-created'); await p.browserContext().close(); return `${state.ticketNo} (${cat} > ${sub})`
  })

  await step('S05', 'Technician can see the new ticket and pick it up', async (use) => {
    if (!state.ticketId) throw new Error('S04 produced no ticket')
    const p = use(await person('qa11.tech@audit.test')); await p.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); await wait(1200)
    if (!(await bodyHas(p, new RegExp(state.subject.slice(0, 12))))) throw new Error('technician cannot see the ticket')
    const pick = await bodyHas(p, /Pick up/); if (pick) await clickText(p, /^pick up$/); await wait(1500)
    await p.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); await shot(p, 'S05-technician-ticket')
    await p.browserContext().close(); return pick ? 'was in the group queue; picked up' : 'already assigned to a technician'
  })

  await step('S06', 'Status updates work (Start Working -> In Progress)', async (use) => {
    const p = use(await person('qa11.tech@audit.test')); await p.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); await wait(1000)
    if (await bodyHas(p, /Start Working/)) { await clickText(p, /start working/); await wait(2500) }
    await p.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); await wait(800)
    if (!(await bodyHas(p, /In Progress/))) throw new Error('status is not In Progress'); await shot(p, 'S06-in-progress'); await p.browserContext().close()
  })

  await step('S07', 'Approval flow works (send -> approver approves -> back to In Progress)', async (use) => {
    const t = use(await person('qa11.tech@audit.test')); await t.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); await wait(1000)
    await clickText(t, /^actions$/); await clickText(t, /send for approval/)
    const box = await t.$('input[placeholder="Search people to add…"]'); await box.click(); await box.type('QA11 Approver', { delay: 40 }); await wait(2000)
    await clickText(t, /^qa11 approver/); await clickText(t, /^send to/); await wait(2500)
    await t.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); if (!(await bodyHas(t, /Pending Approval/))) throw new Error('ticket did not go to Pending Approval'); await shot(t, 'S07-pending-approval')
    const a = use(await person('qa11.approver@audit.test')); await a.goto(BASE + '/approvals', { waitUntil: 'networkidle2' }); await wait(1200)
    await clickText(a, /take action/); const ta = await a.$('textarea[placeholder^="Add a comment"]'); await ta.click(); await ta.type('Approved for the smoke test.', { delay: 8 })
    await shot(a, 'S07-approver-decision'); await clickText(a, /^approve$/); await wait(3000)
    await t.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); if (!(await bodyHas(t, /In Progress/))) throw new Error('ticket did not return to In Progress after approval')
    await shot(t, 'S07-after-approval'); await t.browserContext().close(); await a.browserContext().close()
  })

  await step('S08', 'Attachment upload and download work', async (use) => {
    const p = use(await person('qa11.store@audit.test')); await p.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); await wait(1200)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const f = path.join(OUT, 'smoke-attachment.png'); writeFileSync(f, png)
    const input = await p.$('input[type="file"]'); if (!input) throw new Error('no file input on the ticket'); await input.uploadFile(f); await wait(1200)
    const ta = await p.$('textarea'); await ta.click(); await ta.type('Photo attached for the smoke test.', { delay: 8 }); await clickText(p, /^post$/); await wait(3500)
    await p.goto(BASE + '/requests/' + state.ticketId, { waitUntil: 'networkidle2' }); await wait(1000)
    if (!(await bodyHas(p, /smoke-attachment\.png/))) throw new Error('attachment not listed on the ticket'); await shot(p, 'S08-attachment-listed')
    // really download it: open the chip and watch the network for the attachment request
    const seen = []
    p.on('response', (r) => { if (/\/api\/storage\/attachment\/request\//.test(r.url())) seen.push({ url: r.url(), s: r.status(), t: r.headers()['content-type'] || '' }) })
    await clickText(p, /smoke-attachment\.png/); await wait(2500)
    const ok = seen.find((x) => x.s === 200)
    if (!ok) throw new Error('opening the attachment produced no successful download request: ' + JSON.stringify(seen.slice(0, 3)))
    // and the same file must NOT be readable without a session
    const anon = await fetch(ok.url)
    if (anon.status === 200) throw new Error('the attachment is readable WITHOUT signing in')
    await p.browserContext().close(); return `downloaded (HTTP 200, ${ok.t}); anonymous request refused with HTTP ${anon.status}`
  })

  await step('S09', 'Search finds the ticket', async (use) => {
    const p = use(await person('qa11.store@audit.test')); await p.goto(BASE + '/requests?q=' + encodeURIComponent(state.subject.slice(0, 14)), { waitUntil: 'networkidle2' }); await wait(1200)
    if (!(await bodyHas(p, new RegExp(String(stamp))))) throw new Error('the ticket is not in the search results'); await shot(p, 'S09-search'); await p.browserContext().close()
  })

  await step('S10', 'Administrator configuration pages load', async (use) => {
    const p = use(await person('qa11.admin@audit.test')); const pages = ['/admin/users', '/admin/teams', '/admin/services', '/admin/categories', '/admin/business-rules', '/admin/org', '/admin/logs', '/admin/vendors']
    const bad = []
    for (const u of pages) { const r = await p.goto(BASE + u, { waitUntil: 'networkidle2' }); await wait(500); const txt = await p.evaluate(() => document.body.innerText); if (!r || r.status() >= 400 || /Application error|Internal Server Error|This page could not be found/i.test(txt)) bad.push(u + ' ' + (r && r.status())) }
    await shot(p, 'S10-admin'); if (bad.length) throw new Error('failed: ' + bad.join(', ')); await p.browserContext().close(); return `${pages.length} pages`
  })

  await step('S11', 'Vendor login is restricted to the vendor area', async (use) => {
    const p = use(await person('qa11.vtech@audit.test')); const wrong = []
    for (const u of ['/home', '/admin/users', '/requests', '/dashboards/executive', '/zoho']) { await p.goto(BASE + u, { waitUntil: 'networkidle2' }); await wait(400); if (!new URL(p.url()).pathname.startsWith('/vendor') && !new URL(p.url()).pathname.startsWith('/login')) wrong.push(`${u} -> ${new URL(p.url()).pathname}`) }
    await shot(p, 'S11-vendor'); if (wrong.length) throw new Error('vendor reached: ' + wrong.join(', ')); await p.browserContext().close()
  })

  await step('S12', 'Critical dashboards load', async (use) => {
    const p = use(await person('qa11.admin@audit.test')); const pages = ['/home', '/dashboards/executive', '/admin/reports', '/reports/pivot', '/reports/analytics']; const bad = []
    for (const u of pages) { const r = await p.goto(BASE + u, { waitUntil: 'networkidle2' }); await wait(1500); const txt = await p.evaluate(() => document.body.innerText); if (!r || r.status() >= 400 || /Application error|Internal Server Error|could not be (found|loaded)/i.test(txt)) bad.push(u + ' ' + (r && r.status())) }
    await shot(p, 'S12-dashboards'); if (bad.length) throw new Error('failed: ' + bad.join(', ')); await p.browserContext().close(); return `${pages.length} pages`
  })

  await step('S13', 'Logout works and ends the session', async (use) => {
    const p = use(await person('qa11.store@audit.test')); await p.goto(BASE + '/home', { waitUntil: 'networkidle2' }); await wait(800)
    const out = await p.$('button[aria-label*="out" i], button[title*="out" i]'); if (out) { await out.click() } else { await clickText(p, /sign out|log ?out/) }
    await p.waitForFunction(() => location.pathname.startsWith('/login'), { timeout: 15000 }); await p.goto(BASE + '/home', { waitUntil: 'networkidle2' })
    if (!new URL(p.url()).pathname.startsWith('/login')) throw new Error('still signed in after logout: ' + p.url()); await shot(p, 'S13-logged-out'); await p.browserContext().close()
  })
} finally {
  await browser.close()
  const pass = results.filter((r) => r.status === 'PASS').length
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), base: BASE, ticket: state.ticketNo, total: results.length, pass, fail: results.length - pass, results }, null, 1))
  console.log(`\nSMOKE: ${pass}/${results.length} passed`)
  process.exitCode = pass === results.length ? 0 : 1
}
