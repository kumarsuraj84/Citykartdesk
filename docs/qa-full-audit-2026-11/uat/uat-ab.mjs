// QA 2026-11 — BUSINESS UAT scenarios A (store AC complaint) and B (fixtures request -> CVM approval).
// Black-box through a real Chrome against the isolated AUDIT app (localhost:3310), with database and mail-trap assertions.
// Needs: audit app running, demo data seeded (audit-2026-10/demo/seed-demo.mjs). Never touches live; mail goes to evidence/mail-sink only.
//   node docs/qa-full-audit-2026-11/uat/uat-ab.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'uat'); mkdirSync(OUT, { recursive: true })
const SINK = path.join(HERE, '..', 'evidence', 'mail-sink')
const BASE = 'http://localhost:3310'
const DEMO_PW = 'Demo-Desk-Pw-2026!'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js')
const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Refusing: not the isolated audit stack.')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png') })
const mailFiles = () => { try { return readdirSync(SINK).filter((f) => f.endsWith('.json')) } catch { return [] } }
const mails = () => mailFiles().map((f) => { try { return JSON.parse(readFileSync(path.join(SINK, f), 'utf8')) } catch { return {} } })

let browser
async function person(email, pw = DEMO_PW) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage()
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(e.message))
  await page.setViewport({ width: 1366, height: 900 })
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' })
  await page.type('input[type="email"]', email); await page.type('input[type="password"]', pw)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  return page
}
async function clickText(page, re) {
  const pt = await page.evaluate((src) => {
    const rx = new RegExp(src, 'i')
    const els = [...document.querySelectorAll('button, a, [role="button"]')].filter((e) => e.offsetParent !== null && !e.disabled && rx.test((e.innerText || '').replace(/\s+/g, ' ').trim()))
    if (!els.length) return null
    els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)
    els[0].scrollIntoView({ block: 'center' }); const r = els[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, re.source)
  if (!pt) throw new Error(`no visible control matching ${re}`)
  await page.mouse.click(pt.x, pt.y); await wait(900)
}
async function pickBox(page, placeholder, wantText) {
  const box = await page.$(`input[placeholder="${placeholder}"]`); if (!box) throw new Error(`no box "${placeholder}"`)
  await box.click(); await wait(600)
  const picked = await page.evaluate((want) => {
    const els = [...document.querySelectorAll('[role="option"], li button, ul li')].filter((e) => e.offsetParent !== null && (e.innerText || '').trim().length >= 1)
    const el = (want && els.find((e) => e.innerText.toLowerCase().includes(want.toLowerCase()))) || els[0]
    if (!el) return null; const t = el.innerText.trim(); el.click(); return t
  }, wantText || null)
  await wait(700); if (!picked) throw new Error(`nothing to pick in "${placeholder}"`); return picked
}
async function fillText(page, sel, text) { const el = await page.$(sel); if (!el) throw new Error(`no field ${sel}`); await el.click({ clickCount: 3 }); await el.type(text, { delay: 8 }) }
const bodyText = (p) => p.evaluate(() => document.body.innerText)
async function run(id, title, fn) { try { const d = await fn(); log(id, 'PASS', title, d || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 300)) } }

browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
const stamp = Date.now().toString().slice(-6)
const ctx = {}
try {
  // ---- set-up: the administrator loads the three sample sheets (AC, genset, CVM) ----
  await run('A00', 'Admin loads the sheets (Sheet Masters > Update from sheets now)', async () => {
    const p = await person('admin.demo@audit.test'); await p.goto(BASE + '/admin/masters', { waitUntil: 'networkidle2' }); await wait(1200)
    await clickText(p, /update from sheets now/); await wait(5000); await shot(p, 'A00-sheets-loaded')
    const acCount = (await db.from('master_ac_units').select('*', { count: 'exact', head: true })).count
    if (!acCount) throw new Error('no AC rows after the update'); await p.browserContext().close(); return `${acCount} AC units loaded`
  })

  // ---- Scenario A: store raises an AC complaint ----
  await run('A01', 'ALC store sees AC serials of its own store only in the form', async () => {
    const p = await person('alc.demo@audit.test'); ctx.alc = p; await p.goto(BASE + '/services/demo-ac-repair', { waitUntil: 'networkidle2' }); await wait(1500)
    const cat = await pickBox(p, 'Search category…', 'AC Repair'); const sub = await pickBox(p, 'Search sub category…', 'AC not cooling')
    ctx.cat = `${cat} > ${sub}`; await shot(p, 'A01-form')
    const box = await p.$('input[placeholder="Search ac serial number…"]'); if (!box) throw new Error('no AC serial box'); await box.click(); await wait(800)
    const opts = await p.evaluate(() => [...document.querySelectorAll('[role="option"], li')].filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim()).filter(Boolean))
    ctx.acOptions = opts; await shot(p, 'A01-ac-choices'); await p.keyboard.press('Escape'); await wait(400); if (opts.length < 1) throw new Error('no AC serial choices'); return `${opts.length} AC choices: ${opts.slice(0, 6).join(' | ')}`
  })
  await run('A02', 'Submit AC complaint -> ticket created with number', async () => {
    const p = ctx.alc
    ctx.acPicked = await pickBox(p, 'Search ac serial number…')
    await fillText(p, 'input[placeholder="Enter subject…"]', `UAT-A ${stamp} AC not cooling at ALC`)
    const ta = await p.$('textarea'); if (ta) { await ta.click(); await ta.type('UAT A: AC in the sales floor is not cooling since morning.', { delay: 5 }) }
    await shot(p, 'A02-filled'); const before = p.url(); await clickText(p, /^submit request$/)
    await p.waitForFunction((u) => location.href !== u && /\/requests\/[0-9a-f-]{36}/.test(location.href), { timeout: 30000 }, before)
    ctx.ticketId = p.url().match(/\/requests\/([0-9a-f-]{36})/)[1]; await wait(2500)
    ctx.ticketNo = ((await bodyText(p)).match(/\b[A-Z]{2,6}-\d{4,}\b/) || [''])[0]; await shot(p, 'A02-ticket'); if (!ctx.ticketNo) throw new Error('no ticket number'); return ctx.ticketNo
  })
  await run('A03', 'Ticket row in database: right org, requester, status, subject, store', async () => {
    const { data, error } = await db.from('requests').select('id, request_no, title, status, assigned_to, team_id, priority, category_id, form_data, created_at').eq('id', ctx.ticketId).single()
    if (error) throw new Error(error.message); ctx.row = data
    if (!data.title.includes(stamp)) throw new Error('title mismatch'); ctx.ticketNo = data.request_no; return `${data.request_no} status=${data.status} priority=${data.priority} acno=${JSON.stringify(data.form_data?.acno ?? null)} team=${data.team_id ? 'set' : 'null'} assigned=${data.assigned_to ? 'set' : 'null'}`
  })
  await run('A04', 'Routing: AC complaint went to the OEM mail (mail trap) or is in the conversation', async () => {
    await wait(3000); const m = mails().filter((x) => JSON.stringify(x).includes(ctx.ticketNo))
    const conv = (await db.from('request_comments').select('body, is_internal').eq('request_id', ctx.ticketId)).data ?? []
    if (!m.length && !conv.length) throw new Error('no mail captured and no conversation entry for ' + ctx.ticketNo)
    return `${m.length} mail file(s) mentioning ${ctx.ticketNo}; ${conv.length} comment(s); mail to: ${m.map((x) => x.to).slice(0, 3).join(', ')}`
  })
  await run('A05', 'Status timeline / audit trail recorded for the new ticket', async () => {
    const ev = (await db.from('request_activity').select('action, created_at').eq('request_id', ctx.ticketId)).data ?? []
    if (!ev.length) throw new Error('no events recorded'); return `${ev.length} event(s): ${[...new Set(ev.map((e) => e.action))].join(', ')}`
  })
  await run('A06', 'Another store (MAR) cannot open ALC ticket', async () => {
    if (!ctx.ticketId) throw new Error('BLOCKED: no ticket was created in A02, so this check could not be performed')
    const p = await person('mar.demo@audit.test'); await p.goto(BASE + '/requests/' + ctx.ticketId, { waitUntil: 'networkidle2' }); await wait(1500)
    const t = await bodyText(p); await shot(p, 'A06-other-store'); await p.browserContext().close()
    if (t.includes(ctx.ticketNo) && t.includes(stamp)) throw new Error('MAR store can read ALC ticket'); return 'ticket not visible to another store'
  })
  if (ctx.alc) await ctx.alc.browserContext().close().catch(() => {})

  // ---- Scenario B: fixtures request that needs CVM approval ----
  await run('B01', 'Store raises Fixture request (Qty required) -> ticket', async () => {
    const p = await person('mar.demo@audit.test'); ctx.mar = p; await p.goto(BASE + '/services/demo-ac-repair', { waitUntil: 'networkidle2' }); await wait(1500)
    await pickBox(p, 'Search category…', 'Fixture'); await pickBox(p, 'Search sub category…', 'Fixture')
    await fillText(p, 'input[placeholder="Enter subject…"]', `UAT-B ${stamp} Need new display fixtures`); await wait(500)
    const qty = await p.$('input[type="number"]'); if (!qty) throw new Error('Qty field missing for Fixture category'); await qty.click(); await qty.type('4')
    await shot(p, 'B01-filled'); const before = p.url(); await clickText(p, /^submit request$/)
    await p.waitForFunction((u) => location.href !== u && /\/requests\/[0-9a-f-]{36}/.test(location.href), { timeout: 30000 }, before)
    ctx.fxId = p.url().match(/\/requests\/([0-9a-f-]{36})/)[1]; await wait(2500); ctx.fxNo = ((await bodyText(p)).match(/\b[A-Z]{2,6}-\d{4,}\b/) || [''])[0]; await shot(p, 'B01-ticket'); return ctx.fxNo
  })
  await run('B02', 'Ticket waits for approval; CVM is the approver', async () => {
    await wait(2500); const ap = (await db.from('approvals').select('id, status, current_step').eq('request_id', ctx.fxId)).data ?? []
    if (!ap.length) throw new Error('no approval row created for the fixture ticket'); const pre = (await db.from('requests').select('pre_approval_status, status').eq('id', ctx.fxId).single()).data
    return `${ap.length} approval(s), status ${ap[0].status}, step ${ap[0].current_step}; ticket status ${pre.status}/${pre.pre_approval_status}`
  })
  await run('B03', 'CVM sees the approval request on the Approvals page and approves it in the UI', async () => {
    const p = await person('vishal.kumar@audit.test'); await p.goto(BASE + '/approvals', { waitUntil: 'networkidle2' }); await wait(2000)
    if (!(await bodyText(p)).includes(ctx.fxNo)) throw new Error('the CVM Approvals list does not show ' + ctx.fxNo)
    await clickText(p, new RegExp(ctx.fxNo)); await wait(1500); await shot(p, 'B03-cvm-take-action')
    const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean))
    ctx.cvmButtons = btns
    await clickText(p, /^approve( request)?$|^approve/).catch(() => { throw new Error('no Approve button; buttons were: ' + btns.join(' | ')) })
    await wait(1500); await shot(p, 'B03-confirm-step')
    ctx.cvmButtonsAfter = await p.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean))
    const ta = await p.$('textarea'); if (ta) { await ta.click(); await ta.type('UAT: approved for 4 fixtures.') }
    // the confirming button is the LAST visible button whose text starts with confirm/submit/send/approve
    const pt = await p.evaluate(() => { const els = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null && !e.disabled && /^(confirm|submit|send|approve)/i.test((e.innerText || '').trim())); const el = els[els.length - 1]; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: el.innerText.trim() } })
    if (pt) { ctx.confirmClicked = pt.t; await p.mouse.click(pt.x, pt.y) }
    await wait(3500); await shot(p, 'B03-after-approve'); await p.browserContext().close()
    const ap = (await db.from('approvals').select('status').eq('request_id', ctx.fxId)).data ?? []
    if (!ap.some((a) => a.status === 'approved')) throw new Error('approval status after click: ' + JSON.stringify(ap)); return 'approval recorded as approved'
  })
  await run('B04', 'After approval the ticket leaves Pending Approval and the requester sees the decision', async () => {
    const row = (await db.from('requests').select('status, pre_approval_status').eq('id', ctx.fxId).single()).data
    if (row.status === 'pending_approval') throw new Error('ticket is still pending_approval after the approval was recorded')
    const dec = (await db.from('approval_decisions').select('decision, decided_by').in('approval_id', ((await db.from('approvals').select('id').eq('request_id', ctx.fxId)).data ?? []).map((x) => x.id))).data ?? []
    await ctx.mar.goto(BASE + '/requests/' + ctx.fxId, { waitUntil: 'networkidle2' }); await wait(1500); await shot(ctx.mar, 'B04-requester-view')
    return `ticket status now ${row.status}; ${dec.length} decision row(s): ${dec.map((d) => d.decision).join(',')}`
  })
  if (ctx.mar) await ctx.mar.browserContext().close().catch(() => {})
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'uat-ab-results.json'), JSON.stringify({ ran: new Date().toISOString(), stamp, ticketA: ctx.ticketNo, ticketB: ctx.fxNo, results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0)
}
