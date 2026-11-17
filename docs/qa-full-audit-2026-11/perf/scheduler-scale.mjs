// How long one scheduler run (/api/business-rules/run) takes as the number of OPEN tickets with an SLA grows (synthetic tickets, audit stack only).
import { execFileSync } from 'node:child_process'; import { readFileSync, writeFileSync } from 'node:fs'
const ROOT = 'D:/ANKUR AI PROJECTS/CitykartDesk-ZOHO Alternate'; const env = Object.fromEntries(readFileSync(ROOT + '/audit-2026-10/env/.env.audit', 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const sql = (q) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', q], { encoding: 'utf8' }).trim()
const gen = (n) => execFileSync('docker', ['exec', '-i', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'n=' + n], { encoding: 'utf8', input: readFileSync(ROOT + '/docs/qa-full-audit-2026-11/perf/gen-tickets.sql', 'utf8') })
const rows = []
for (const add of [0, 7000, 15000, 25000, 50000]) {
  if (add) gen(add)
  const open = Number(sql("select count(*) from requests where status not in ('closed','cancelled','resolved') and resolution_due_at is not null")); const total = Number(sql('select count(*) from requests'))
  const t0 = Date.now(); let status = 0; try { const r = await fetch('http://localhost:3310/api/business-rules/run', { headers: { 'x-cron-secret': env.CRON_SECRET }, signal: AbortSignal.timeout(900000), dispatcher: undefined }); status = r.status; await r.text() } catch (e) { status = 'ERR ' + (e.cause?.code || e.message) }
  const ms = Date.now() - t0; rows.push({ total, openWithSla: open, ms, status }); console.log(`tickets ${total}  open-with-SLA ${open}  scheduler run ${ms} ms  status ${status}`)
}
writeFileSync(ROOT + '/docs/qa-full-audit-2026-11/evidence/perf/scheduler-scale.json', JSON.stringify({ ran: new Date().toISOString(), rows }, null, 1))
