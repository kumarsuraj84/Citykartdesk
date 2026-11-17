// QA 2026-11 — UAT H: THE REAL MAIL PATH AFTER A ZOHO TICKET IS MOVED. Black-box through a real Chrome against the isolated AUDIT app (localhost:3310); every mail goes to the local mail sink
// folder (evidence/mail-sink), never to anyone. It answers one question: after the silent move, does a moved ticket send mails and notifications like any other CK Desk ticket when people use it?
//   node docs/qa-full-audit-2026-11/uat/uat-h-mail-path.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'uat'); mkdirSync(OUT, { recursive: true })
const SINK = path.join(HERE, '..', 'evidence', 'mail-sink')
const BASE = 'http://localhost:3310', PW = 'QA-Audit-Pw-2026!'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)('C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js')
const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Refusing: not the isolated audit stack.')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const mailNames = () => { try { return readdirSync(SINK).filter((f) => f.endsWith('.json')).sort() } catch { return [] } }
const readMail = (f) => { try { return JSON.parse(readFileSync(path.join(SINK, f), 'utf8')) } catch { return {} } }
const toList = (m) => [].concat(m.to ?? []).map((x) => (typeof x === 'string' ? x : x?.address ?? JSON.stringify(x))).join(', ')
let seen = new Set(mailNames())
/** the mails written since the last call */
const newMails = () => { const now = mailNames(); const fresh = now.filter((f) => !seen.has(f)); seen = new Set(now); return fresh.map((f) => { const m = readMail(f); return { to: toList(m), subject: m.subject ?? '' } }) }
const countNotes = async (ids) => (await db.from('notifications').select('id', { count: 'exact', head: true }).in('request_id', ids)).count ?? 0
const show = (m) => m.map((x) => `[${x.to}] ${x.subject}`).join(' | ') || '(none)'

let browser
async function person(email) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 1366, height: 1000 })
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await page.type('input[type="email"]', email); await page.type('input[type="password"]', PW)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 })
  return page
}
async function clickText(page, re, scope = 'button, a, [role="button"]') {
  const pt = await page.evaluate((src, sel) => {
    const rx = new RegExp(src, 'i')
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null && !e.disabled && rx.test((e.innerText || '').replace(/\s+/g, ' ').trim()))
    if (!els.length) return null
    els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)
    els[0].scrollIntoView({ block: 'center' }); const r = els[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, re.source, scope)
  if (!pt) throw new Error(`no visible control matching ${re}`)
  await page.mouse.click(pt.x, pt.y); await wait(400)
}
const hasControl = (page, re) => page.evaluate((src) => [...document.querySelectorAll('button, a')].some((e) => e.offsetParent !== null && new RegExp(src, 'i').test((e.innerText || '').trim())), re.source)
async function openTicket(page, requestNo) {
  const { data } = await db.from('requests').select('id').eq('request_no', requestNo).maybeSingle()
  await page.goto(`${BASE}/requests/${data.id}`, { waitUntil: 'networkidle2' }); await wait(800); return data.id
}
async function postComment(page, text) {
  await page.waitForSelector('textarea', { timeout: 15000 })
  const ta = await page.$('textarea'); await ta.click(); await ta.type(text)
  await clickText(page, /^Post$/); await wait(2500)
}
const shot = (p, n) => p.screenshot({ path: path.join(OUT, `uat-h-${n}.png`) })

// ── setup: a rule that gives a moved ticket to a technician (as the real rules do), and the numbers to move ───────────────────────────────────────────────
const NOS = [700001, 700002]
const { data: org } = await db.from('organizations').select('id').limit(1).single()
const { data: tech } = await db.from('profiles').select('id, full_name').eq('role', 'agent').limit(1).single()
const { data: techAuth } = await db.auth.admin.getUserById(tech.id)
const TECH_EMAIL = techAuth.user.email
await db.from('business_rules').delete().eq('name', 'ZOHO-MAIL-TEST')
await db.from('zoho_transfers').delete().in('zoho_ticket_no', NOS); await db.from('requests').delete().in('request_no', NOS.map((n) => `ZOHO-${n}`))
await db.from('business_rules').insert({ org_id: org.id, name: 'ZOHO-MAIL-TEST', is_active: true, trigger: ['created'], conditions: [{ field: 'title', operator: 'contains', value: 'Demo' }], conditions_logic: 'AND', actions: [{ type: 'assign', params: { strategy: 'direct', assigneeIds: [tech.id] } }], execution_order: 1 })

browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
try {
  newMails() // forget what is already in the folder
  // ── 1. the move is silent ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const admin = await person('qa11.admin@audit.test')
  const notesBefore = (await db.from('notifications').select('id', { count: 'exact', head: true })).count
  await admin.goto(`${BASE}/zoho/move?go=1&numbers=${NOS.join(',')}&moved=not`, { waitUntil: 'networkidle2' }); await wait(800)
  await admin.evaluate(() => document.querySelectorAll('input[name=n]').forEach((b) => b.click()))
  await clickText(admin, /Move the ticked tickets/); await clickText(admin, /Yes, move them now/)
  await admin.waitForFunction(() => /moved\./.test(document.body.innerText), { timeout: 60000 }); await wait(1500)
  const { data: moved } = await db.from('requests').select('id, request_no, status, assigned_to, requester_id').in('request_no', NOS.map((n) => `ZOHO-${n}`))
  const ids = moved.map((r) => r.id)
  log('H01', moved.length === NOS.length ? 'PASS' : 'FAIL', 'the three tickets were moved', moved.map((r) => `${r.request_no}:${r.status}`).join(' '))
  const mv = newMails(); const notesAfter = (await db.from('notifications').select('id', { count: 'exact', head: true })).count
  log('H02', mv.length === 0 && notesAfter === notesBefore ? 'PASS' : 'FAIL', 'the move sent no mail and made no notification', `mails: ${show(mv)} | notifications ${notesBefore} -> ${notesAfter}`)
  log('H03', moved.every((r) => r.assigned_to === tech.id) ? 'PASS' : 'FAIL', 'CK Desk\'s rule gave each ticket to the technician, quietly', `${tech.full_name}`)

  // ── 2. the technician ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const t = await person(TECH_EMAIL)
  await openTicket(t, 'ZOHO-700001')
  const startOnInProgress = await hasControl(t, /Start Working/)
  log('H04', !startOnInProgress ? 'PASS' : 'FAIL', 'a ticket that was In Process in Zoho shows NO "Start Working" button', startOnInProgress ? 'the button is there' : 'hidden, as expected')
  await shot(t, '02-technician-view')

  await openTicket(t, 'ZOHO-700002')
  const hasStart = await hasControl(t, /Start Working/)
  log('H05', hasStart ? 'PASS' : 'FAIL', 'a ticket that was Open in Zoho still shows "Start Working"')
  newMails(); const n0 = await countNotes(ids)
  if (hasStart) { await clickText(t, /Start Working/); await wait(3500) }
  const m5 = newMails(); const { data: r4 } = await db.from('requests').select('status').eq('request_no', 'ZOHO-700002').single()
  log('H06', r4.status === 'in_progress' ? 'PASS' : 'FAIL', 'Start Working moves the moved ticket to In progress', `status ${r4.status}`)
  log('H07', 'INFO', 'mail and notifications after Start Working (normal CK Desk behaviour)', `mails: ${show(m5)} | new notifications ${await countNotes(ids) - n0}`)

  // ── 3. conversation with the requester, both ways ───────────────────────────────────────────────────────────────────────────────────────────────────
  await openTicket(t, 'ZOHO-700002'); newMails(); const n1 = await countNotes(ids)
  await postComment(t, 'Hello, the technician has checked your AC remotely and will visit tomorrow morning.')
  const m8 = newMails()
  log('H08', m8.some((m) => /qa11\.store@audit\.test/i.test(m.to) && /ZOHO-700002/.test(m.subject)) ? 'PASS' : 'FAIL', 'a technician\'s public comment mails the requester, with the ticket number in the subject', `mails: ${show(m8)}`)
  log('H09', 'INFO', 'notifications after the technician\'s comment', `${await countNotes(ids) - n1} new`)

  const r = await person('qa11.store@audit.test')
  await openTicket(r, 'ZOHO-700002'); newMails(); const n2 = await countNotes(ids)
  await postComment(r, 'Thank you, please come after 10 am.')
  const m10 = newMails()
  log('H10', m10.some((m) => new RegExp(TECH_EMAIL.replace('.', '\\.'), 'i').test(m.to)) ? 'PASS' : 'FAIL', 'the requester\'s reply mails the technician', `mails: ${show(m10)}`)
  log('H11', (await countNotes(ids)) - n2 > 0 ? 'PASS' : 'FAIL', 'the requester\'s reply makes a bell notification for the technician', `${await countNotes(ids) - n2} new`)

  // ── 4. a requester who was NOT in CK Desk (made inactive by the move) ───────────────────────────────────────────────────────────────────────────────────
  await openTicket(t, 'ZOHO-700001'); newMails()
  await postComment(t, 'Hello, we are looking into your AC problem.')
  const m12 = newMails()
  log('H12', 'INFO', 'comment on a ticket whose requester is an INACTIVE profile (a person CK Desk did not know)', `mails: ${show(m12)}`)

  // ── 5. resolve it ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await openTicket(t, 'ZOHO-700002'); newMails(); const n3 = await countNotes(ids)
  const opened = await t.evaluate(() => { const lab = [...document.querySelectorAll('span, p, div, label, dt')].find((e) => (e.textContent || '').trim() === 'Status' && e.children.length === 0); const row = lab?.parentElement; const b = row?.querySelector('button'); if (!b) return false; b.click(); return true })
  await wait(700); await shot(t, '03-status-menu')
  if (opened) await clickText(t, /^Resolved$/i, 'span, button, div').catch(() => {})
  await wait(900)
  await shot(t, '03b-resolution-box')
  const boxes = await t.$$('textarea'); const noteBox = boxes.length > 1 ? boxes[boxes.length - 1] : null
  let resolved = false
  if (noteBox) {
    await noteBox.type('The AC gas was low and the filter was blocked. We refilled the gas, cleaned the filter and checked the cooling with the store manager.')
    await shot(t, '03c-note-typed'); await clickText(t, /^(Resolve|Mark Resolved|Mark as resolved|Confirm|Save|Done|Send|Submit|Apply|Update)/i).catch(() => {}); await wait(4500)
  }
  const { data: r2 } = await db.from('requests').select('status').eq('request_no', 'ZOHO-700002').single(); resolved = r2.status === 'resolved'
  const m13 = newMails()
  log('H13', resolved ? 'PASS' : 'FAIL', 'the technician can resolve a moved ticket', `status ${r2.status}`)
  log('H14', resolved && m13.some((m) => /qa11\.store@audit\.test/i.test(m.to)) ? 'PASS' : resolved ? 'FAIL' : 'NOT RUN', 'resolving mails the requester (resolved mail / satisfaction survey)', `mails: ${show(m13)} | new notifications ${await countNotes(ids) - n3}`)
  await shot(t, '04-after-resolve')
} finally {
  await browser.close()
  // leave the audit database as it was
  await db.from('business_rules').delete().eq('name', 'ZOHO-MAIL-TEST')
  await db.from('zoho_transfers').delete().in('zoho_ticket_no', NOS); await db.from('requests').delete().in('request_no', NOS.map((n) => `ZOHO-${n}`))
}
writeFileSync(path.join(OUT, 'uat-h-mail-path.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1))
const c = (s) => results.filter((r) => r.status === s).length
console.log(`PASS ${c('PASS')}  FAIL ${c('FAIL')}  INFO ${c('INFO')}  NOT RUN ${c('NOT RUN')}  of ${results.length}`); process.exit(c('FAIL') ? 1 : 0)
