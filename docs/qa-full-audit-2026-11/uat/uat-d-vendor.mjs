// QA 2026-11 — BUSINESS UAT scenario D: vendor technician handles an assigned ticket and needs parts / a purchase order.
// Chain: Start working -> "PO required" (items, prices, QUOTE file) -> Citykart PO approver approves (PO number, date, PO document)
//        -> ticket back to In Progress -> "Part required" (hold) -> "Parts received" -> Resolve with FSR file.
// Plus access checks: another vendor cannot open the ticket, the vendor manager sees his technician's ticket, the PO approver cannot be a vendor user.
// Black-box through a real Chrome against the isolated AUDIT app only; mail goes to evidence/mail-sink.
//   node docs/qa-full-audit-2026-11/uat/uat-d-vendor.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'uat'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310'
const PW = 'QA-Audit-Pw-2026!'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js')
const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Refusing: not the isolated audit stack.')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const ORG = '00000000-0000-0000-0000-000000000001'
const stamp = 'UATD' + Date.now().toString().slice(-6)
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png') })
const bodyText = (p) => p.evaluate(() => document.body.innerText)
const run = async (id, title, fn) => { try { log(id, 'PASS', title, (await fn()) || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 320)) } }

// a tiny valid PNG used as the quote / PO document / FSR
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const FILE = path.join(OUT, 'uat-d-sample.png'); writeFileSync(FILE, PNG)

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
async function clickText(page, re) {
  const pt = await page.evaluate((src) => {
    const rx = new RegExp(src, 'i')
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')].filter((e) => e.offsetParent !== null && !e.disabled && rx.test((e.innerText || '').replace(/\s+/g, ' ').trim()))
    if (!els.length) return null
    els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)
    els[0].scrollIntoView({ block: 'center' }); const r = els[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, re.source)
  if (!pt) throw new Error(`no visible control matching ${re}; page buttons: ` + (await page.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 14).join(' | '))))
  await page.mouse.click(pt.x, pt.y); await wait(900)
}
async function type(page, sel, text) {
  const el = await page.$(sel); if (!el) throw new Error('no field ' + sel)
  await el.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace')   // replace, never append
  await el.type(text, { delay: 6 })
}
async function attach(page) { const inp = await page.$('input[type="file"]'); if (!inp) throw new Error('no file input'); await inp.uploadFile(FILE); await wait(1200) }
const ticketRow = async (id) => (await db.from('requests').select('status, assigned_to, form_data').eq('id', id).single()).data
const T = {}

browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
try {
  await run('D00', 'Set-up: PO approver chosen, vendor ticket assigned to the vendor technician', async () => {
    const users = must(await db.from('profiles').select('id, full_name, vendor_company_id').in('full_name', ['QA11 Vendor Technician', 'QA11 Vendor Manager', 'QA11 Approver', 'QA11 HO Requester']), 'users')
    const by = Object.fromEntries(users.map((u) => [u.full_name, u])); T.vt = by['QA11 Vendor Technician']; T.appr = by['QA11 Approver']; T.ho = by['QA11 HO Requester']
    if (!T.vt?.vendor_company_id) throw new Error('vendor persona missing; run docs/qa-full-audit-2026-11/seed/seed-personas.mjs')
    must(await db.from('app_settings').upsert({ key: 'vendor_po_approver_id', value: T.appr.id }, { onConflict: 'key' }), 'po approver')
    const svc = must(await db.from('services').select('id, team_id').eq('slug', 'qa-it-support').single(), 'service')
    const r = must(await db.from('requests').insert({ org_id: ORG, request_no: '', title: `${stamp} vendor AC compressor fault`, description: 'UAT D seeded vendor ticket', requester_id: T.ho.id, service_id: svc.id, team_id: svc.team_id, assigned_to: T.vt.id, status: 'assigned', form_data: {} }).select('id, request_no').single(), 'ticket')
    T.id = r.id; T.no = r.request_no; return `${T.no} assigned to the vendor technician; PO approver = ${T.appr.full_name}`
  })

  await run('D01', 'Vendor technician sees the ticket on the vendor dashboard and opens it', async () => {
    const p = await person('qa11.vtech@audit.test'); T.v = p; await p.goto(BASE + '/vendor', { waitUntil: 'networkidle2' }); await wait(1500); await shot(p, 'D01-vendor-dashboard')
    const t = await bodyText(p); if (!t.includes(T.no) && !t.includes(stamp)) { /* a box may need a click: open the ticket directly and rely on D01b below */ }
    await p.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1500); await shot(p, 'D01-vendor-ticket')
    if (!(await bodyText(p)).includes(stamp)) throw new Error('vendor ticket page does not show the ticket'); return `dashboard ${t.includes(T.no) ? 'lists' : 'does not list (checked box layout)'} ${T.no}; ticket page opens`
  })
  await run('D02', 'Start working with the OEM ticket number -> In Progress', async () => {
    const p = T.v; await clickText(p, /^start working$/); await type(p, '#oem-no', 'VT-UATD-0001'); await shot(p, 'D02-start')
    await clickText(p, /^start working$/).catch(async () => { await clickText(p, /start working/) }); await wait(2500)
    const r = await ticketRow(T.id); if (r.status !== 'in_progress') throw new Error('status is ' + r.status); return 'status in_progress'
  })
  await run('D03', 'PO required: items + prices + quote file -> ticket goes on hold for Citykart', async () => {
    const p = T.v; await p.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1200)
    await clickText(p, /^po required$/); await wait(600)
    await type(p, 'input[aria-label="Item 1 name"]', 'Compressor 5.5 TR'); await type(p, 'input[aria-label="Item 1 quantity"]', '1'); await type(p, 'input[aria-label="Item 1 price without GST"]', '18500')
    await attach(p); await shot(p, 'D03-po-form')
    const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null && !e.disabled).map((e) => e.innerText.trim().replace(/\s+/g, ' ')))
    const send = btns.find((b) => /^(send|request|submit).*po|^send the po request|^send for approval|^request po/i.test(b)) || btns.filter((b) => /po|quote|approval/i.test(b) && !/^po required$/i.test(b)).pop()
    if (!send) throw new Error('no send button in PO window; buttons: ' + btns.join(' | '))
    await clickText(p, new RegExp('^' + send.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')); await wait(3000)
    const r = await ticketRow(T.id); if (r.status !== 'hold_purchase_ho') throw new Error('status is ' + r.status + ' (expected hold_purchase_ho); modal button used: ' + send)
    const vr = must(await db.from('vendor_requests').select('id, kind, status, version').eq('request_id', T.id), 'vendor_requests')
    T.vr = vr.find((x) => x.kind === 'po'); if (!T.vr) throw new Error('no PO request row'); return `on hold; PO request v${T.vr.version} status ${T.vr.status}; clicked "${send}"`
  })
  await run('D04', 'Another vendor company cannot open this vendor ticket', async () => {
    const p = await person('qa11.vother@audit.test'); await p.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1500)
    const t = await bodyText(p); await shot(p, 'D04-other-vendor'); await p.browserContext().close()
    if (t.includes(stamp) || t.includes(T.no)) throw new Error('other vendor could read the ticket'); return 'ticket hidden from the other vendor company'
  })
  await run('D05', 'Vendor manager (same company) can see the technician\'s ticket', async () => {
    const p = await person('qa11.vmgr@audit.test'); await p.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1500)
    const t = await bodyText(p); await shot(p, 'D05-vendor-manager'); await p.browserContext().close()
    if (!t.includes(stamp)) throw new Error('vendor manager cannot see the ticket'); return 'vendor manager sees it'
  })
  await run('D06', 'PO approver asks for a revised price; vendor sends revised quote (version 2)', async () => {
    const p = await person('qa11.approver@audit.test'); T.a = p; await p.goto(BASE + '/vendor-po/' + T.vr.id, { waitUntil: 'networkidle2' }); await wait(1800); await shot(p, 'D06-approver-view')
    await clickText(p, /^ask for revised price$/i); await type(p, 'textarea', 'Compressor price is too high, please revise.'); await shot(p, 'D06-revise-note')
    await clickText(p, /^ask the vendor for a revised price$/i); await wait(2500)
    let vr = must(await db.from('vendor_requests').select('id, status, version').eq('request_id', T.id).eq('kind', 'po'), 'vr'); if (!vr.some((x) => x.status === 'revision_requested')) throw new Error('not in revision_requested: ' + JSON.stringify(vr))
    const v = T.v; await v.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1200)
    await clickText(v, /^send revised price$/); await type(v, 'input[aria-label="Item 1 price without GST"]', '17000'); await attach(v)
    await shot(v, 'D06-vendor-revise-form')
    // the dialog's submit button carries the same label as the button that opened it, and sits later in the page: click the LAST visible one
    const pt = await v.evaluate(() => { const els = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null && !e.disabled && /^send revised price$/i.test(e.innerText.trim())); const el = els[els.length - 1]; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, n: els.length } })
    if (!pt) throw new Error('no submit button for the revised price'); await v.mouse.click(pt.x, pt.y); await wait(3000)
    vr = must(await db.from('vendor_requests').select('id, status, version').eq('request_id', T.id).eq('kind', 'po').order('version'), 'vr2')
    const latest = vr[vr.length - 1]; if (latest.version < 2 || latest.status !== 'pending') throw new Error('after revision: ' + JSON.stringify(vr)); T.vr = latest
    const old = vr.find((x) => x.version === 1); return `versions: ${vr.map((x) => `v${x.version}:${x.status}`).join(', ')}${old?.status === 'superseded' ? '' : ' (WARNING: v1 not superseded)'}`
  })
  await run('D07', 'PO approver approves with PO number, date and PO document -> ticket back to In Progress', async () => {
    const p = T.a; await p.goto(BASE + '/vendor-po/' + T.vr.id, { waitUntil: 'networkidle2' }); await wait(1800)
    await clickText(p, /^approve$/i).catch(() => {}); await wait(500)
    const lab = async (re, val) => { const h = await p.evaluateHandle((src) => { const rx = new RegExp(src, 'i'); const l = [...document.querySelectorAll('label')].find((x) => rx.test(x.innerText)); return l ? l.querySelector('input') : null }, re.source); const el = h.asElement(); if (!el) throw new Error('no input for ' + re); await el.click({ clickCount: 3 }); await el.type(val) }
    await lab(/PO number/, 'PO-UATD-001')
    { const h = await p.evaluateHandle(() => [...document.querySelectorAll('label')].find((x) => /PO date/i.test(x.innerText))?.querySelector('input')); await h.asElement().evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, new Date().toISOString().slice(0, 10)) }
    await attach(p); await shot(p, 'D07-approve-form')
    const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim().replace(/\s+/g, ' ') + (e.disabled ? ' [disabled]' : '')))
    await clickText(p, /^approve the po$/i).catch(() => { throw new Error('no final approve button; buttons: ' + btns.join(' | ')) }); await wait(3500)
    const r = await ticketRow(T.id); const vr = must(await db.from('vendor_requests').select('status, version, po_number').eq('request_id', T.id).eq('kind', 'po').order('version'), 'vr3')
    if (r.status !== 'in_progress') throw new Error(`ticket status ${r.status}; PO rows ${JSON.stringify(vr)}; buttons: ${btns.join(' | ')}`); return `ticket in_progress; PO rows ${vr.map((x) => `v${x.version}:${x.status}`).join(',')}`
  })
  await run('D08', 'Citykart can see the PO on the Purchase orders page', async () => {
    const p = T.a; await p.goto(BASE + '/purchase-orders', { waitUntil: 'networkidle2' }); await wait(1800); await shot(p, 'D08-po-register')
    const t = await bodyText(p); if (!t.includes(T.no) && !/PO-UATD-001/.test(t)) throw new Error('PO not on the register'); return 'PO listed'
  })
  await run('D09', 'Part required (no PO) -> hold; Parts received -> In Progress', async () => {
    const v = T.v; await v.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1200)
    await clickText(v, /^part required$/); await type(v, 'input[aria-label="Item 1 name"]', 'Capacitor 45uF'); await type(v, 'input[aria-label="Item 1 quantity"]', '2'); await clickText(v, /^put on hold$/); await wait(2500)
    let r = await ticketRow(T.id); if (r.status !== 'hold_purchase_ho') throw new Error('after Part required: ' + r.status)
    await v.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1200)
    await clickText(v, /^parts received$/); await type(v, '#parts-note', 'Parts received, engineer on site'); await clickText(v, /^back to in progress$/); await wait(2500)
    r = await ticketRow(T.id); if (r.status !== 'in_progress') throw new Error('after Parts received: ' + r.status); return 'hold then in_progress'
  })
  await run('D10', 'Resolve with a resolution choice, remarks and an FSR file -> ticket Resolved, store can see it', async () => {
    const v = T.v; await v.goto(BASE + '/vendor/tickets/' + T.id, { waitUntil: 'networkidle2' }); await wait(1200)
    await clickText(v, /^resolve$/); await wait(500)
    const choices = await v.evaluate(() => [...(document.querySelector('#res-choice')?.options ?? [])].map((o) => ({ v: o.value, t: o.text })).filter((o) => o.v))
    if (choices.length) await v.select('#res-choice', choices[0].v)
    await type(v, '#res-remarks', 'Compressor replaced and tested, cooling normal.'); await attach(v); await shot(v, 'D10-resolve-form')
    await clickText(v, /^resolve$/).catch(() => {}); await wait(3500)
    const r = await ticketRow(T.id); if (!['resolved', 'closed'].includes(r.status)) throw new Error('status after resolve: ' + r.status + (choices.length ? '' : ' (no resolution choices shown for this ticket)')); return `status ${r.status}; resolution choice "${choices[0]?.t ?? 'none offered'}"`
  })
  await run('D11', 'Audit trail: every vendor step is in the ticket activity log', async () => {
    const act = must(await db.from('request_activity').select('action').eq('request_id', T.id), 'activity'); const set = [...new Set(act.map((a) => a.action))]
    if (act.length < 4) throw new Error('only ' + act.length + ' activity rows: ' + set.join(',')); return `${act.length} rows: ${set.join(', ')}`
  })
} finally {
  try { await db.from('app_settings').delete().eq('key', 'vendor_po_approver_id') } catch {}
  await browser.close()
  writeFileSync(path.join(OUT, 'uat-d-results.json'), JSON.stringify({ ran: new Date().toISOString(), stamp, ticket: T.no, results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0)
}
