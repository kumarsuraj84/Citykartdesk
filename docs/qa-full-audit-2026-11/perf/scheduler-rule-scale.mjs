// One scheduler run (/api/business-rules/run) with ONE active scheduled rule, as the number of overdue OPEN tickets grows. Synthetic tickets, audit stack only.
//   node docs/qa-full-audit-2026-11/perf/scheduler-rule-scale.mjs
import { execFileSync } from 'node:child_process'; import { readFileSync, writeFileSync } from 'node:fs'
const ROOT = 'D:/ANKUR AI PROJECTS/CitykartDesk-ZOHO Alternate'; const env = Object.fromEntries(readFileSync(ROOT + '/audit-2026-10/env/.env.audit', 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const sql = (q) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { encoding: 'utf8' }).trim()
const gen = (n) => execFileSync('docker', ['exec', '-i', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'n=' + n], { encoding: 'utf8', input: readFileSync(ROOT + '/docs/qa-full-audit-2026-11/perf/gen-tickets.sql', 'utf8') })
sql("delete from business_rules where name like 'SCALE-RULE%'")
const rule = sql("insert into business_rules (org_id, name, is_active, trigger, schedule_check, schedule_threshold, conditions, conditions_logic, execution_order, actions) values ('00000000-0000-0000-0000-000000000001','SCALE-RULE', true, '{schedule}', 'sla_pct_elapsed', 100, '[{\"field\":\"title\",\"operator\":\"contains\",\"value\":\"NO-MATCH-qa11-scale\"}]', 'AND', 0, '[{\"type\":\"set_priority\",\"params\":{\"priority\":\"urgent\"}}]') returning id").split('\n')[0]
const rows = []
try {
  for (const add of [0, 5000, 7000, 12000, 24000]) {
    if (add) gen(add)
    const open = Number(sql("select count(*) from requests where status not in ('closed','cancelled','resolved') and resolution_due_at is not null and resolution_due_at < now()")); const total = Number(sql('select count(*) from requests'))
    const t0 = Date.now(); let st; try { const r = await fetch('http://localhost:3310/api/business-rules/run', { headers: { 'x-cron-secret': env.CRON_SECRET }, signal: AbortSignal.timeout(280000) }); st = r.status; await r.text() } catch (e) { st = 'ERR ' + (e.cause?.code || e.message) }
    const ms = Date.now() - t0; rows.push({ total, overdueOpen: open, ms, status: st }); console.log(`tickets ${total}  overdue open ${open}  one scheduler run (1 rule) ${ms} ms  status ${st}`)
    if (st !== 200) break
  }
} finally { sql(`delete from business_rule_events where rule_id='${rule}'`); sql(`delete from business_rules where id='${rule}'`); writeFileSync(ROOT + '/docs/qa-full-audit-2026-11/evidence/perf/scheduler-rule-scale.json', JSON.stringify({ ran: new Date().toISOString(), rows }, null, 1)) }
