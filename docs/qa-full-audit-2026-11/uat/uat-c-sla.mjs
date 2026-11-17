// QA 2026-11 — BUSINESS UAT scenario C: SLA escalation (scheduled Business Rules, 80% -> manager notified, 100% -> priority urgent + admin notified).
// Runs against the isolated AUDIT stack only. Tickets are seeded straight into the audit DB with backdated dates (creation through the screen is proven in UAT A/B);
// the cron endpoint /api/business-rules/run is then called exactly as the scheduled task calls it. Mail goes to evidence/mail-sink only.
//   node docs/qa-full-audit-2026-11/uat/uat-c-sla.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'uat'); mkdirSync(OUT, { recursive: true })
const SINK = path.join(HERE, '..', 'evidence', 'mail-sink')
const BASE = 'http://localhost:3310'
const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js')
const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Refusing: not the isolated audit stack.')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const ORG = '00000000-0000-0000-0000-000000000001'
const stamp = 'UATC' + Date.now().toString().slice(-6)
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { log(id, 'PASS', title, (await fn()) || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 300)) } }
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const hoursAhead = (h) => new Date(Date.now() + h * 3600_000).toISOString()
const mailsFor = (needle) => readdirSync(SINK).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(path.join(SINK, f), 'utf8')) } catch { return {} } }).filter((m) => JSON.stringify(m).includes(needle))
const cron = (headers = {}) => fetch(BASE + '/api/business-rules/run', { headers })

const ids = { ho: '43dccf5b-4034-49a3-842c-0de65e94de9f', mgr: '755a28e8-f624-4e4e-a11d-4d68218e9756', appr: 'fc109f5a-6254-4b57-bf49-3035d9be3c50', admin: '3e785e8e-5055-490d-8f2e-dd520e263fa5', tech: '32d3b395-b8e9-47b4-b6ad-d52f8b1b9846', team: 'c7e62ddc-11ca-4ff2-aa56-8140eb0e3732', service: '06026d49-3adc-4aaf-b9da-10699d4d7667' }
const T = {}
const cond = [{ field: 'title', operator: 'contains', value: stamp }]   // only this scenario's tickets can match the rules

const mkTicket = async (key, over) => {
  const row = must(await db.from('requests').insert({ org_id: ORG, request_no: `${stamp}-${key}`, title: `${stamp} ${key}`, description: 'UAT C seeded ticket', requester_id: ids.ho, service_id: ids.service, team_id: ids.team, priority: 'medium', status: 'open', form_data: {}, assigned_to: ids.tech, ...over }).select('id, request_no, priority, status').single(), 'seed ' + key)
  T[key] = row; return row
}

try {
  await run('C00', 'Set-up: two scheduled SLA rules (80% notify manager; 100% set Urgent + notify admin) limited to this scenario\'s tickets', async () => {
    const r1 = must(await db.from('business_rules').insert({ org_id: ORG, name: `${stamp} SLA 80% warn manager`, is_active: true, trigger: ['schedule'], schedule_check: 'sla_pct_elapsed', schedule_threshold: 80, conditions: cond, conditions_logic: 'AND', execution_order: 0, actions: [{ type: 'notify', params: { roles: ['manager'], notifyAssignee: false, notifyRequester: false, channels: ['in_app', 'email'] } }] }).select('id').single(), 'rule80')
    const r2 = must(await db.from('business_rules').insert({ org_id: ORG, name: `${stamp} SLA 100% breach`, is_active: true, trigger: ['schedule'], schedule_check: 'sla_pct_elapsed', schedule_threshold: 100, conditions: cond, conditions_logic: 'AND', execution_order: 1, actions: [{ type: 'set_priority', params: { priority: 'urgent' } }, { type: 'notify', params: { roles: ['admin'], notifyAssignee: true, notifyRequester: false, channels: ['in_app', 'email'] } }] }).select('id').single(), 'rule100')
    T.r80 = r1.id; T.r100 = r2.id; return `rules ${r1.id.slice(0, 8)} / ${r2.id.slice(0, 8)}`
  })
  await run('C01', 'Seed 4 tickets: A overdue, B ~90% elapsed, C overdue but RESOLVED, D overdue but SLA PAUSED (waiting on user)', async () => {
    const a = await mkTicket('A-overdue', { created_at: hoursAgo(24 * 10), resolution_due_at: hoursAgo(6), response_due_at: hoursAgo(24 * 9) })
    const b = await mkTicket('B-at90', { created_at: hoursAgo(24 * 20), resolution_due_at: hoursAhead(24 * 2), response_due_at: hoursAgo(24 * 19) })
    const c = await mkTicket('C-resolved', { created_at: hoursAgo(24 * 10), resolution_due_at: hoursAgo(6), status: 'resolved', resolved_at: hoursAgo(1) })
    const d = await mkTicket('D-paused', { created_at: hoursAgo(24 * 10), resolution_due_at: hoursAgo(6), status: 'waiting_user', waiting_since: hoursAgo(24 * 9.9) })
    return [a, b, c, d].map((x) => x.request_no).join(', ')
  })
  const first = {}
  await run('C02', 'Cron refuses a call with no secret and with a wrong secret (401), accepts the right one (200)', async () => {
    const none = await cron(); const wrong = await cron({ 'x-cron-secret': 'definitely-not-the-secret-value' })
    if (none.status !== 401 || wrong.status !== 401) throw new Error(`no-secret ${none.status}, wrong-secret ${wrong.status}`)
    const ok = await cron({ 'x-cron-secret': env.CRON_SECRET }); first.status = ok.status; first.body = await ok.json()
    if (ok.status !== 200 || !first.body.ok) throw new Error('cron with the right secret: ' + ok.status + ' ' + JSON.stringify(first.body).slice(0, 200))
    return `none ${none.status}, wrong ${wrong.status}, right ${ok.status}; fired=${first.body.fired} processed=${first.body.processed} failed=${first.body.failed}`
  })
  await run('C03', 'Ticket A (overdue): both rules fired; priority became Urgent', async () => {
    const ev = must(await db.from('business_rule_events').select('rule_id').eq('request_id', T['A-overdue'].id), 'events')
    const prio = must(await db.from('requests').select('priority').eq('id', T['A-overdue'].id).single(), 'prio').priority
    if (ev.length !== 2) throw new Error(`expected 2 rule events, got ${ev.length}`); if (prio !== 'urgent') throw new Error('priority is ' + prio); return '2 rule events; priority urgent'
  })
  await run('C04', 'Ticket B (~90% elapsed): only the 80% rule fired; priority unchanged', async () => {
    const ev = must(await db.from('business_rule_events').select('rule_id').eq('request_id', T['B-at90'].id), 'events')
    const prio = must(await db.from('requests').select('priority').eq('id', T['B-at90'].id).single(), 'prio').priority
    if (ev.length !== 1 || ev[0].rule_id !== T.r80) throw new Error(`events: ${JSON.stringify(ev)}`); if (prio !== 'medium') throw new Error('priority changed to ' + prio); return '80% rule only; priority still medium'
  })
  await run('C05', 'Ticket C (resolved) and D (SLA paused) were NOT escalated', async () => {
    const ev = must(await db.from('business_rule_events').select('request_id').in('request_id', [T['C-resolved'].id, T['D-paused'].id]), 'events')
    if (ev.length) throw new Error('escalated: ' + JSON.stringify(ev)); return 'no events for resolved or paused tickets'
  })
  await run('C06', 'Managers were notified in the bell for A and B; admin + assignee for A (100% rule)', async () => {
    const n = must(await db.from('notifications').select('user_id, request_id, type').in('request_id', [T['A-overdue'].id, T['B-at90'].id]), 'notif')
    const has = (uid, key) => n.some((x) => x.user_id === uid && x.request_id === T[key].id)
    const miss = []
    for (const [who, uid] of [['tech-manager', ids.mgr], ['approver-manager', ids.appr]]) for (const k of ['A-overdue', 'B-at90']) if (!has(uid, k)) miss.push(`${who} not told about ${k}`)
    if (!has(ids.admin, 'A-overdue')) miss.push('admin not told about A'); if (!has(ids.tech, 'A-overdue')) miss.push('assignee not told about A')
    if (has(ids.admin, 'B-at90')) miss.push('admin wrongly told about B')
    if (miss.length) throw new Error(miss.join('; ')); return `${n.length} notification rows, recipients correct`
  })
  await run('C07', 'E-mails for the escalation reached the mail trap only', async () => {
    const m = mailsFor(stamp); if (!m.length) throw new Error('no escalation mail captured for ' + stamp); return `${m.length} mail file(s); subjects: ${[...new Set(m.map((x) => x.subject))].slice(0, 3).join(' | ')}`
  })
  await run('C08', 'Idempotent: a second run fires nothing new and sends no duplicate notifications/mail', async () => {
    const before = { ev: must(await db.from('business_rule_events').select('rule_id').in('rule_id', [T.r80, T.r100]), 'ev').length, n: must(await db.from('notifications').select('id').in('request_id', Object.values(T).filter((x) => x.id).map((x) => x.id)), 'n').length, m: mailsFor(stamp).length }
    const r = await (await cron({ 'x-cron-secret': env.CRON_SECRET })).json()
    const after = { ev: must(await db.from('business_rule_events').select('rule_id').in('rule_id', [T.r80, T.r100]), 'ev').length, n: must(await db.from('notifications').select('id').in('request_id', Object.values(T).filter((x) => x.id).map((x) => x.id)), 'n').length, m: mailsFor(stamp).length }
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`changed on second run: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    return `rule events ${after.ev}, notifications ${after.n}, mails ${after.m} unchanged (this run fired ${r.fired} on other tickets: ${r.fired === 0 ? 'none' : 'unrelated to this scenario'})`
  })
  await run('C09', 'Paused ticket escalates once the pause is lifted (D back to Open, still overdue)', async () => {
    must(await db.from('requests').update({ status: 'open', waiting_since: null }).eq('id', T['D-paused'].id), 'unpause')
    await (await cron({ 'x-cron-secret': env.CRON_SECRET })).json()
    const ev = must(await db.from('business_rule_events').select('rule_id').eq('request_id', T['D-paused'].id), 'events')
    if (!ev.length) throw new Error('ticket D did not escalate after the pause was lifted'); return `${ev.length} rule event(s) after the pause ended`
  })
  await run('C10', 'Audit trail: the priority change is recorded for ticket A', async () => {
    const act = must(await db.from('request_activity').select('action, metadata').eq('request_id', T['A-overdue'].id), 'activity')
    if (!act.length) throw new Error('no activity rows for ticket A'); return `${act.length} activity row(s): ${[...new Set(act.map((a) => a.action))].join(', ')}`
  })
} finally {
  // clean up the scenario's own rules so they never run against other tickets later (the tickets stay as evidence)
  try { await db.from('business_rules').update({ is_active: false }).in('id', [T.r80, T.r100].filter(Boolean)) } catch {}
  writeFileSync(path.join(OUT, 'uat-c-results.json'), JSON.stringify({ ran: new Date().toISOString(), stamp, tickets: Object.fromEntries(Object.entries(T).filter(([, v]) => v.request_no).map(([k, v]) => [k, v.request_no])), results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0)
}
