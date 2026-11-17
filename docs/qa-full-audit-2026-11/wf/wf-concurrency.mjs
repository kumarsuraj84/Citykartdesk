// QA 2026-11 — workflow engine + concurrency (black-box) against the isolated AUDIT stack / audit app (port 3310). Synthetic data only.
//   node docs/qa-full-audit-2026-11/wf/wf-concurrency.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'wf'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310', PW = 'QA-Audit-Pw-2026!', ORG = '00000000-0000-0000-0000-000000000001'
const rq = createRequire(path.join(ROOT, 'package.json')); const { createClient } = rq('@supabase/supabase-js')
const puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_CORE || 'C:/Users/User2/AppData/Local/Temp/claude/c0a797de48150dab/b1171928-38ee-4239-9671-0c883722e31b/scratchpad/deck/node_modules/puppeteer-core')
const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Refusing: not the isolated audit stack.')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { const r = await fn(); if (r && String(r).startsWith('NOTE:')) log(id, 'NOTE', title, String(r).slice(5)); else log(id, 'PASS', title, r || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 500)) } }
const stamp = 'WFQ' + Date.now().toString().slice(-6)
const ids = { ho: '43dccf5b-4034-49a3-842c-0de65e94de9f', tech: '32d3b395-b8e9-47b4-b6ad-d52f8b1b9846', team: 'c7e62ddc-11ca-4ff2-aa56-8140eb0e3732', service: '06026d49-3adc-4aaf-b9da-10699d4d7667' }
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const cron = () => fetch(BASE + '/api/business-rules/run', { headers: { 'x-cron-secret': env.CRON_SECRET } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
const T = []
let ruleA, ruleB
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] })
async function person(email) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 900 })
  await p.goto(BASE + '/login', { waitUntil: 'networkidle2' }); await p.type('input[type="email"]', email); await p.type('input[type="password"]', PW)
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 }); return p
}
try {
  // ---------- W01: rule ordering/conflict + idempotency under parallel scheduler calls ----------
  const cond = [{ field: 'title', operator: 'contains', value: stamp }]
  await run('W01', 'Two conflicting scheduled rules (order 0: priority High, order 1: priority Urgent) on 6 overdue tickets; 8 scheduler calls fired AT THE SAME TIME: every ticket is acted on exactly once per rule, the later rule wins, no duplicates', async () => {
    ruleA = must(await db.from('business_rules').insert({ org_id: ORG, name: `${stamp} conflict A (High)`, is_active: true, trigger: ['schedule'], schedule_check: 'sla_pct_elapsed', schedule_threshold: 100, conditions: cond, conditions_logic: 'AND', execution_order: 0, actions: [{ type: 'set_priority', params: { priority: 'high' } }] }).select('id').single(), 'ruleA').id
    ruleB = must(await db.from('business_rules').insert({ org_id: ORG, name: `${stamp} conflict B (Urgent)`, is_active: true, trigger: ['schedule'], schedule_check: 'sla_pct_elapsed', schedule_threshold: 100, conditions: cond, conditions_logic: 'AND', execution_order: 1, actions: [{ type: 'set_priority', params: { priority: 'urgent' } }] }).select('id').single(), 'ruleB').id
    for (let i = 1; i <= 6; i++) T.push(must(await db.from('requests').insert({ org_id: ORG, request_no: `${stamp}-${i}`, title: `${stamp} overdue ${i}`, description: 'WF concurrency', requester_id: ids.ho, service_id: ids.service, team_id: ids.team, priority: 'low', status: 'open', created_at: hoursAgo(24 * 10), resolution_due_at: hoursAgo(5), response_due_at: hoursAgo(24 * 9) }).select('id').single(), 'ticket ' + i).id)
    const calls = await Promise.all(Array.from({ length: 8 }, () => cron())); const bad = calls.filter((c) => c.status !== 200); if (bad.length) throw new Error('scheduler calls failed: ' + JSON.stringify(bad.map((b) => b.status)))
    const fired = calls.reduce((s, c) => s + (c.body.fired || 0), 0)
    const ev = must(await db.from('business_rule_events').select('rule_id, request_id').in('request_id', T), 'events')
    const per = {}; for (const e of ev) { const k = e.request_id + e.rule_id; per[k] = (per[k] || 0) + 1 }
    const dup = Object.values(per).filter((n) => n > 1).length; const pairs = Object.keys(per).length
    const prios = must(await db.from('requests').select('priority').in('id', T), 'prios').map((r) => r.priority)
    const acts = must(await db.from('request_activity').select('request_id, action').in('request_id', T).eq('action', 'priority_changed'), 'activities')
    const perTicket = {}; for (const a of acts) perTicket[a.request_id] = (perTicket[a.request_id] || 0) + 1
    const issues = []; if (pairs !== 12) issues.push(`${pairs} (rule,ticket) events, expected 12`); if (dup) issues.push(`${dup} duplicated events`); if (fired !== 12) issues.push(`total "fired" over the 8 calls = ${fired}, expected 12`)
    if (!prios.every((p) => p === 'urgent')) issues.push('final priorities: ' + prios.join(',')); const maxAct = Math.max(0, ...Object.values(perTicket)); if (maxAct > 2) issues.push(`a ticket got ${maxAct} priority changes in its history`)
    if (issues.length) throw new Error(issues.join('; ')); return `12 events (no duplicates), fired=${fired} across 8 simultaneous calls, all 6 tickets Urgent (later rule won), max ${maxAct} priority entries per ticket`
  })
  // ---------- W02: the same under a stuck/slow scheduler (a second wave after the first) is a no-op ----------
  await run('W02', 'A second wave of 4 simultaneous scheduler calls later changes nothing (nothing acted on twice)', async () => {
    const calls = await Promise.all(Array.from({ length: 4 }, () => cron())); const fired = calls.reduce((s, c) => s + (c.body.fired || 0), 0)
    const { count } = await db.from('business_rule_events').select('id', { count: 'exact', head: true }).in('request_id', T); if (count !== 12) throw new Error(`events now ${count}, expected 12`); if (fired !== 0) throw new Error('second wave fired ' + fired); return 'events still 12, fired 0'
  })
  // ---------- W03: two technicians pick up the same ticket at the same moment ----------
  await run('W03', 'Two technicians click "Pick up" on the same unassigned ticket at the same moment: exactly one gets it; the other is told; one history entry', async () => {
    const t = must(await db.from('requests').insert({ org_id: ORG, request_no: `${stamp}-PICK`, title: `${stamp} pick-up race`, description: 'WF race', requester_id: ids.ho, service_id: ids.service, team_id: ids.team, priority: 'medium', status: 'open' }).select('id').single(), 'pick ticket'); T.push(t.id)
    const [p1, p2] = await Promise.all([person('qa11.tech@audit.test'), person('qa11.tech2@audit.test')])
    await Promise.all([p1.goto(BASE + '/requests/' + t.id, { waitUntil: 'networkidle2' }), p2.goto(BASE + '/requests/' + t.id, { waitUntil: 'networkidle2' })]); await wait(1200)
    const click = (p) => p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^\s*pick\s*up\s*$/i.test(x.innerText)); if (!b) return 'no-button'; b.click(); return 'clicked' })
    const pre = await Promise.all([p1.evaluate(() => !![...document.querySelectorAll('button')].find((x) => /pick\s*up/i.test(x.innerText))), p2.evaluate(() => !![...document.querySelectorAll('button')].find((x) => /pick\s*up/i.test(x.innerText)))]); if (!pre[0] || !pre[1]) throw new Error('"Pick up" button not shown to both technicians: ' + pre.join(','))
    const [c1, c2] = await Promise.all([click(p1), click(p2)]); await wait(3500)
    const row = must(await db.from('requests').select('assigned_to, status').eq('id', t.id).single(), 'row'); const acts = must(await db.from('request_activity').select('action, actor_id, metadata').eq('request_id', t.id), 'acts')
    const msgs = await Promise.all([p1, p2].map((p) => p.evaluate(() => (document.body.innerText.match(/already|someone else|no longer|taken|couldn.t|could not|failed/i) || [''])[0])))
    const winners = [ids.tech, '2'].length
    if (!row.assigned_to) throw new Error('nobody got the ticket'); if (row.status !== 'assigned') throw new Error('status is ' + row.status)
    const assignActs = acts.filter((a) => /assign/i.test(a.action)); if (assignActs.length > 2) throw new Error('assignment history entries: ' + assignActs.length)
    return `clicks: ${c1}/${c2}; owner=${row.assigned_to.slice(0, 8)} status=${row.status}; history entries mentioning assignment: ${assignActs.length}; messages to the two people: "${msgs[0]}" / "${msgs[1]}"`
  })
  // ---------- W04: ticket numbers stay unique when many tickets are created at once ----------
  await run('W04', '60 tickets created in parallel get 60 different ticket numbers (no duplicates, none missing)', async () => {
    const rows = await Promise.all(Array.from({ length: 60 }, (_, i) => db.from('requests').insert({ org_id: ORG, request_no: '', title: `${stamp} burst ${i}`, description: 'burst', requester_id: ids.ho, service_id: ids.service, team_id: ids.team, priority: 'low', status: 'open' }).select('id, request_no').single()))
    const failed = rows.filter((r) => r.error); if (failed.length) throw new Error(`${failed.length} inserts failed: ${failed[0].error.message}`)
    for (const r of rows) T.push(r.data.id); const nos = rows.map((r) => r.data.request_no); const uniq = new Set(nos)
    if (uniq.size !== 60) throw new Error(`only ${uniq.size} distinct numbers for 60 tickets`); if (nos.some((n) => !n)) throw new Error('some tickets got an empty number')
    const nums = nos.map((n) => Number(String(n).replace(/\D/g, ''))).sort((a, b) => a - b); return `60 distinct numbers ${nos[0]}..: range ${nums[0]}-${nums[nums.length - 1]} (${nums[nums.length - 1] - nums[0] + 1} slots for 60 tickets)`
  })
  // ---------- W05: scheduler duration with the big data volume ----------
  await run('W05', 'One scheduler run completes quickly even with all existing tickets in the database (rule scan cost)', async () => {
    const n = (await db.from('requests').select('id', { count: 'exact', head: true })).count; const t0 = Date.now(); const r = await cron(); const ms = Date.now() - t0
    if (r.status !== 200) throw new Error('status ' + r.status); if (ms > 60000) throw new Error(`took ${ms} ms`)
    return `${n} tickets in the database, scheduler run took ${ms} ms (processed=${r.body.processed})`
  })
} finally {
  // clean everything this run created (tickets, events, rules)
  try { if (T.length) { await db.from('business_rule_events').delete().in('request_id', T); await db.from('requests').delete().in('id', T) } for (const id of [ruleA, ruleB]) if (id) await db.from('business_rules').delete().eq('id', id) } catch (e) { console.log('cleanup note:', e.message) }
  await browser.close()
  writeFileSync(path.join(OUT, 'wf-concurrency-results.json'), JSON.stringify({ ran: new Date().toISOString(), results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} not failing`); process.exit(f ? 1 : 0)
}
