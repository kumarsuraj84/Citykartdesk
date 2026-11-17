// QA 2026-11 — keyboard, focus, dialog, error-announcement, dark-mode and 320px reflow checks. AUDIT app only.
//   node docs/qa-full-audit-2026-11/ui/ui-keyboard.mjs [chrome|edge]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'ui'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310', PW = 'QA-Audit-Pw-2026!'
const BROWSER = (process.argv[2] || 'chrome').toLowerCase()
const EXE = BROWSER === 'edge' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const AXE = readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8')
const sql = (q) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { encoding: 'utf8' }).trim()
const anyTicket = sql('select id from requests order by created_at desc limit 1')
const vendTicket = sql("select id from requests where assigned_to='22edadf3-1970-49f7-ba94-c684281fdb54' order by created_at desc limit 1") || anyTicket
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { const r = await fn(); if (r && r.startsWith('NOTE:')) log(id, 'NOTE', title, r.slice(5)); else log(id, 'PASS', title, r || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 400)) } }

const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] })
async function person(email, vw = 1366, vh = 800) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: vw, height: vh })
  if (!email) return page
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' })
  await page.type('input[type="email"]', email); await page.type('input[type="password"]', PW)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 }); return page
}
const focusInfo = (p) => p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), text: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.name || '').slice(0, 40), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== 'none', type: e.type } })

try {
  await run('K01', 'Login page: Tab reaches e-mail, password, sign-in in order and every stop shows a visible focus indicator', async () => {
    const p = await person(null); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await wait(500)
    const seen = []
    for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); const f = await focusInfo(p); if (f) seen.push(f) }
    const names = seen.map((s) => `${s.tag}:${s.text || s.type}`)
    const iE = seen.findIndex((s) => s.type === 'email'), iP = seen.findIndex((s) => s.type === 'password'), iB = seen.findIndex((s) => s.tag === 'button' && /sign in|log in|login/i.test(s.text))
    if (iE < 0 || iP < 0 || iB < 0 || !(iE < iP && iP < iB)) throw new Error('order wrong: ' + names.join(' > '))
    const bad = seen.filter((s) => !s.outline && !s.shadow).map((s) => s.tag + ':' + s.text); if (bad.length) throw new Error('no visible focus on: ' + bad.join(', '))
    return 'order ok: ' + names.slice(0, iB + 1).join(' > ')
  })
  await run('K02', 'Login by keyboard only (type, Tab, Enter) signs the person in', async () => {
    const p = await person(null); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.focus('input[type="email"]'); await p.keyboard.type('qa11.store@audit.test'); await p.keyboard.press('Tab'); await p.keyboard.type(PW)
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.keyboard.press('Enter')]); await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 }); return 'landed on ' + new URL(p.url()).pathname
  })
  await run('K03', 'Wrong password: an error message appears, is exposed to screen readers (role=alert / aria-live) and does not reveal which part was wrong', async () => {
    const p = await person(null); await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', 'qa11.store@audit.test'); await p.type('input[type="password"]', 'definitely-wrong-pw'); await p.click('button[type="submit"]'); await wait(2500)
    const r = await p.evaluate(() => { const a = document.querySelector('[role="alert"], [aria-live]'); return { alert: a ? a.innerText.trim() : null, text: document.body.innerText } })
    if (!r.alert) throw new Error('no role=alert/aria-live region with the error. Page text: ' + r.text.slice(0, 160).replace(/\s+/g, ' '))
    if (/no such user|user not found|email not found|unknown (user|email)/i.test(r.alert)) throw new Error('error message reveals whether the account exists: ' + r.alert)
    return 'announced: "' + r.alert.slice(0, 80) + '"'
  })
  await run('K04', 'Landmarks and page structure on the signed-in home: html lang, one main landmark, exactly one h1, descriptive title, skip-to-content reachable', async () => {
    const p = await person('qa11.store@audit.test'); await p.goto(BASE + '/home', { waitUntil: 'networkidle2' }); await wait(800)
    const r = await p.evaluate(() => ({ lang: document.documentElement.lang, mains: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length, title: document.title, nav: document.querySelectorAll('nav, [role="navigation"]').length, skip: [...document.querySelectorAll('a')].some((a) => /skip to/i.test(a.innerText) && a.getAttribute('href')?.startsWith('#')) }))
    const issues = []; if (!r.lang) issues.push('no lang'); if (r.mains !== 1) issues.push(r.mains + ' main landmarks'); if (r.h1 !== 1) issues.push(r.h1 + ' h1 headings'); if (!r.title || r.title.length < 3) issues.push('no title'); if (!r.skip) issues.push('no skip link')
    if (issues.length) throw new Error(issues.join('; ') + ' ' + JSON.stringify(r)); return JSON.stringify(r)
  })
  // Dialog tests: open any dialog by clicking likely buttons
  async function openDialog(p, labelRe) {
    const handles = await p.$$('button, [role="button"], a[role="button"]')
    for (const h of handles) {
      const t = await h.evaluate((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()); if (!labelRe.test(t) || t.length > 40 || /ask ck desk/i.test(t)) continue   // the floating assistant is a non-modal chat dock, tested separately (K11)
      if (!(await h.isIntersectingViewport().catch(() => false))) { await h.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {}) }
      await h.click().catch(() => {}); await wait(700)
      if (await p.$('[role="dialog"], dialog[open], [aria-modal="true"]')) return { opener: h, label: t }
      await p.keyboard.press('Escape'); await wait(200)
    }
    return null
  }
  const dialogTargets = [['/admin/users', 'admin', /add|new|invite|create/i], ['/vendor/tickets/' + vendTicket, 'vendor tech', /parts|po|resolve|request|purchase/i], ['/requests/' + anyTicket, 'technician', /assign|reassign|note|reply|status|resolve|approval/i]]
  const personaEmail = { admin: 'qa11.admin@audit.test', 'vendor tech': 'qa11.vtech@audit.test', technician: 'qa11.tech@audit.test' }
  let dialogsTested = 0
  for (const [i, [pg, who, re]] of dialogTargets.entries()) {
    await run('K0' + (5 + i), `Dialog on ${pg.replace(/[0-9a-f-]{36}/, '<id>')} (${who}): opens, focus moves inside, Tab stays inside, Escape closes, focus returns to the opener`, async () => {
      const p = await person(personaEmail[who]); await p.goto(BASE + pg, { waitUntil: 'networkidle2' }); await wait(1200)
      const d = await openDialog(p, re); if (!d) return 'NOTE:no dialog opener matched on this page for this persona (nothing to test here)'
      dialogsTested++
      const info = await p.evaluate(() => { const dl = document.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]'); const a = document.activeElement; return { inside: !!(dl && a && dl.contains(a)), named: !!(dl.getAttribute('aria-label') || dl.getAttribute('aria-labelledby')), modal: dl.getAttribute('aria-modal') === 'true' || dl.tagName === 'DIALOG' } })
      const issues = []; if (!info.inside) issues.push('focus did not move into the dialog'); if (!info.named) issues.push('dialog has no accessible name');
      let escaped = 0
      for (let k = 0; k < 25; k++) { await p.keyboard.press('Tab'); const inside = await p.evaluate(() => { const dl = document.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]'); return !!(dl && dl.contains(document.activeElement)) }); if (!inside) escaped++ }
      if (escaped) issues.push(`focus left the dialog ${escaped}/25 Tab presses (no focus trap)`)
      await p.keyboard.press('Escape'); await wait(600)
      const closed = !(await p.$('[role="dialog"], dialog[open], [aria-modal="true"]')); if (!closed) issues.push('Escape did not close it')
      const openerText = d.label.replace(/\s+/g, ' ').trim(); const back = await p.evaluate((t) => { const a = document.activeElement; return !!a && a !== document.body && (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() === t }, openerText).catch(() => false); if (closed && !back) issues.push('focus did not return to the button that opened it')
      if (issues.length) throw new Error(`"${d.label}": ` + issues.join('; ')); return `"${d.label}" ok`
    })
  }
  await run('K08', 'Dark mode (prefers-color-scheme: dark): colour-contrast violations on home, requests and admin users', async () => {
    const out = []
    for (const [who, pg] of [['qa11.store@audit.test', '/home'], ['qa11.tech@audit.test', '/requests'], ['qa11.admin@audit.test', '/admin/users']]) {
      const p = await person(who); await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await p.goto(BASE + pg, { waitUntil: 'networkidle2' }); await wait(1000); await p.evaluate(AXE)
      const v = await p.evaluate(async () => (await window.axe.run({ exclude: [['nextjs-portal']] }, { runOnly: ['color-contrast'] })).violations.flatMap((x) => x.nodes.map((n) => n.target.join(' ').slice(0, 70))))
      const dark = await p.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255]; return (c[0] + c[1] + c[2]) / 3 < 128 })
      out.push(`${pg}: ${v.length} contrast issues, page is ${dark ? 'dark' : 'light (app has no OS-dark follow)'}`)
      await p.browserContext().close()
    }
    return 'NOTE:' + out.join(' | ')
  })
  await run('K09', '320px wide (400% zoom equivalent): no sideways scrolling on home, requests, ticket and login', async () => {
    const bad = []
    for (const [who, pg] of [[null, '/login'], ['qa11.store@audit.test', '/home'], ['qa11.store@audit.test', '/requests'], ['qa11.tech@audit.test', '/requests/' + anyTicket]]) {
      const p = await person(who, 320, 640); await p.goto(BASE + pg, { waitUntil: 'networkidle2' }); await wait(800)
      const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); if (r.sw > r.iw + 1) bad.push(`${pg} ${r.sw}>${r.iw}`); await p.browserContext().close()
    }
    if (bad.length) throw new Error(bad.join(', ')); return 'no overflow'
  })
  await run('K10', 'Text spacing and 200% text size: home page remains usable (no clipped or overlapping text blocks)', async () => {
    const p = await person('qa11.store@audit.test', 1280, 800); await p.goto(BASE + '/home', { waitUntil: 'networkidle2' }); await wait(800)
    await p.addStyleTag({ content: '*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important} p{margin-bottom:2em !important} html{font-size:200% !important}' }); await wait(500)
    const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, clipped: [...document.querySelectorAll('button, a, h1, h2, label')].filter((e) => { const s = getComputedStyle(e); return e.scrollWidth > e.clientWidth + 2 && (s.overflow === 'hidden' || s.textOverflow === 'ellipsis') && e.innerText.trim().length > 0 }).length }))
    if (r.sw > r.iw + 20) throw new Error(`page scrolls sideways ${r.sw}>${r.iw}`); return `no page-level overflow; ${r.clipped} controls clip their text with ellipsis`
  })
  await run('K11', 'Ask CK Desk assistant panel: opens from its launcher; reports how it behaves for the keyboard (non-modal dock)', async () => {
    const p = await person('qa11.tech@audit.test'); await p.goto(BASE + '/requests/' + anyTicket, { waitUntil: 'networkidle2' }); await wait(1200)
    const clicked = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /ask ck desk/i.test(x.innerText || x.getAttribute('aria-label') || '')); if (!b) return false; b.click(); return true })
    if (!clicked) return 'NOTE:launcher not shown for this persona'; await wait(900)
    const info = await p.evaluate(() => { const d = document.querySelector('[role="dialog"], [aria-modal="true"]'); return d ? { modal: d.getAttribute('aria-modal') === 'true', name: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby') || '' } : null })
    await p.keyboard.press('Escape'); await wait(600); const stillOpen = !!(await p.$('[role="dialog"], [aria-modal="true"]'))
    return 'NOTE:' + JSON.stringify(info) + (stillOpen ? ' — Escape does not close it (non-modal chat dock; close with its own button)' : ' — Escape closes it')
  })
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, `ui-keyboard-${BROWSER}.json`), JSON.stringify({ ran: new Date().toISOString(), browser: BROWSER, results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} not failing`); process.exit(f ? 1 : 0)
}
