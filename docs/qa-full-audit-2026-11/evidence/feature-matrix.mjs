// QA 2026-11 — counts, for each of the 30 feature areas, the source files that implement it and the test files that mention it.
// Pure read-only: walks the repository. Output: evidence/feature-matrix.json
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const ROOT = 'D:/ANKUR AI PROJECTS/CitykartDesk-ZOHO Alternate'

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.next', '.next-audit', '.next-deploy', '.git', 'docs', 'security-assessment-2026-10', 'audit-2026-10', 'qa-release-candidate-2026-10'].includes(n)) continue
    const p = path.join(dir, n); const s = statSync(p)
    if (s.isDirectory()) walk(p, out); else if (/\.(ts|tsx|sql|cjs|mjs)$/.test(n)) out.push(p.replace(/\\/g, '/').replace(ROOT + '/', ''))
  }
  return out
}
const all = walk(ROOT)
const code = all.filter((f) => !f.startsWith('tests/') && !f.startsWith('supabase/'))
const tests = all.filter((f) => f.startsWith('tests/'))
const migrations = all.filter((f) => f.startsWith('supabase/migrations/'))
const testText = new Map(tests.map((f) => [f, readFileSync(path.join(ROOT, f), 'utf8').toLowerCase()]))
const count = (text, re) => (text.match(re) || []).length

// area -> [code path regexes, test keyword regexes]
const AREAS = {
  '01 Login, authentication, passwords':        [/^(app\/\(auth\)|lib\/actions\/auth|lib\/auth\/|lib\/security\/password|app\/auth\/)/, /(password|sign.?in|login|lockout|session)/],
  '02 User and employee administration':        [/^(lib\/actions\/admin\/users|app\/\(app\)\/admin\/users|lib\/users\/|components\/admin\/(BulkImportUsers|BulkPasswordReset|UpdateUserContacts))/, /(bulk|user.?import|invite|employee|mobile.?number)/],
  '03 Roles, permissions, organisation scope':  [/^(lib\/permissions|lib\/actions\/admin\/(permissions|policies|orgScopeGuard)|lib\/admin\/target-guard|app\/\(app\)\/admin\/roles)/, /(permission|rbac|role|org.?scope|target.?guard|rls)/],
  '04 Requester dashboard / home':              [/^(app\/\(app\)\/home|components\/home)/, /(home.?dashboard|get_home|requester dashboard)/],
  '05 Ticket creation and service catalogue':   [/^(lib\/actions\/requests|app\/\(app\)\/services|lib\/requests\/create|components\/requests\/ServiceRequest)/, /(createrequest|service catalog|create.?request)/],
  '06 Categories and subcategories':            [/^(lib\/actions\/admin\/categories|app\/\(app\)\/admin\/categories|lib\/categories)/, /(sub.?categor|categor)/],
  '07 Dynamic forms and mandatory fields':      [/^(lib\/actions\/admin\/(form-templates|field-library)|lib\/forms|components\/forms|lib\/requests\/validate)/, /(form.?template|field.?library|mandatory|required field|dynamicform|validatefield)/],
  '08 Assignment and technician groups':        [/^(lib\/actions\/admin\/teams|lib\/assignment|lib\/requests\/assign)/, /(assign|technician group|team.?member|round.?robin)/],
  '09 Ticket lifecycle and status transitions': [/^(lib\/requests\/status-change|lib\/constants\/request-transitions|lib\/constants\/requests)/, /(transition|status.?change|reopen|resolved|waiting_user)/],
  '10 Priority, SLA and escalations':           [/^(lib\/sla|lib\/actions\/admin\/(sla|sla-matrix)|lib\/alerts|app\/api\/alerts)/, /(sla|escalat|breach|paused_ms)/],
  '11 Business Rules and automation':           [/^(lib\/rules|lib\/automation|lib\/actions\/admin\/business-rules|lib\/actions\/automation)/, /(business.?rule|automation|rule engine|runrules)/],
  '12 Approval workflows and delegation':       [/^(lib\/approvals|lib\/actions\/approvals|lib\/actions\/approvalEmail|components\/requests\/Approval)/, /(approval|approver|adhoc)/],
  '13 Conversations and attachments':           [/^(lib\/actions\/attachments|app\/api\/storage|lib\/attachments|components\/requests\/(CommentForm|AttachmentChips))/, /(attachment|comment|upload|storage)/],
  '14 Notifications, e-mail and WhatsApp':      [/^(lib\/notifications|lib\/email|lib\/whatsapp|lib\/push|lib\/actions\/(notifications|push))/, /(notification|e-?mail|smtp|whatsapp|push)/],
  '15 Search, filters and exports':             [/^(lib\/actions\/(search|export|reportExport|fixedReportExport)|lib\/search|lib\/export)/, /(search|filter|export|csv)/],
  '16 Dashboards and reports':                  [/^(lib\/reporting|lib\/actions\/(executiveDashboard|analytics|reporting)|app\/\(app\)\/(dashboards|reports)|components\/executive)/, /(dashboard|report|analytics|drill)/],
  '17 Knowledge Base':                          [/^(lib\/actions\/knowledge-base|app\/\(app\)\/admin\/knowledge-base)/, /(knowledge.?base|kb)/],
  '18 CSAT and feedback':                       [/^(lib\/csat|lib\/actions\/csatPublic|app\/api\/csat|components\/requests\/Csat)/, /(csat|survey|feedback)/],
  '19 Vendor / OEM access and workflows':       [/^(lib\/vendor|lib\/queries\/vendor|app\/\(app\)\/vendor|lib\/actions\/(vendor|vendor-requests)|lib\/programs|app\/\(app\)\/admin\/(vendors|programs))/, /(vendor|oem|program)/],
  '20 AC and genset management':                [/^(lib\/masters|lib\/queries\/ac-calendar|lib\/reporting\/executive\/ac-calendar|app\/\(app\)\/admin\/masters|lib\/stores)/, /(\bac\b|genset|ac.?unit|ac.?calendar)/],
  '21 Parts, quotations and purchase orders':   [/^(lib\/actions\/(vendor-po|vendor-requests)|app\/\(app\)\/(purchase-orders|vendor-po)|app\/api\/vendor\/pos|components\/vendor)/, /(purchase order|\bpo\b|quote|parts)/],
  '22 Field Service Reports':                   [/^(lib\/vendor\/fields|lib\/vendor\/fsr)/, /(fsr|field service)/],
  '23 Preventive maintenance (PMS)':            [/^(lib\/pms|app\/api\/pms|lib\/programs\/pms)/, /(\bpms\b|preventive)/],
  '24 Google Sheet Masters and sync':           [/^(lib\/masters|app\/api\/masters|app\/\(app\)\/admin\/masters)/, /(sheet|master|sync)/],
  '25 CVM and fixtures approval':               [/^(lib\/approvals\/(cvm|category)|lib\/masters\/cvm)/, /(\bcvm\b|fixture)/],
  '26 Zoho historical tickets':                 [/^(lib\/zoho|app\/\(app\)\/zoho|zoho-sync)/, /(zoho)/],
  '27 CKOneAI assistant':                       [/^(lib\/ckoneai|app\/api\/ckoneai|app\/ckoneai-ui|app\/\(app\)\/ckoneai)/, /(ckoneai|assistant|bot)/],
  '28 Scheduled tasks and background jobs':     [/^(app\/api\/(alerts|automation|csat|desktime|email|pms|reports|weather|approvals|intake\/cron)|scripts\/windows)/, /(cron|scheduled|retry|job)/],
  '29 Audit trails and system logs':            [/^(lib\/syslog|lib\/actions\/admin\/(audit|system-log|events)|app\/\(app\)\/admin\/logs|app\/api\/system-log)/, /(audit|system.?log|event.?log|logadmin)/],
  '30 Other (projects, tasks, intake inbox, data API, weather, profile)': [/^(lib\/actions\/(projects|tasks|task-attachments|ticketCopy|profile)|lib\/data-api|app\/api\/data|app\/\(app\)\/(projects|tasks|intake|profile)|lib\/weather|lib\/desktime)/, /(project|task|intake|data.?api|weather|desktime|profile)/],
}

const out = {}
for (const [name, [codeRe, testRe]] of Object.entries(AREAS)) {
  const cf = code.filter((f) => codeRe.test(f))
  const tf = tests.filter((f) => testRe.test(testText.get(f)) && count(testText.get(f), testRe) >= 2)
  const by = { unit: 0, integration: 0, remediation: 0, vapt: 0 }
  for (const f of tf) { const k = f.split('/')[1]; if (k in by) by[k]++ }
  out[name] = { codeFiles: cf.length, linesOfCode: cf.reduce((t, f) => t + readFileSync(path.join(ROOT, f), 'utf8').split('\n').length, 0), testFiles: tf.length, byLayer: by, sampleCode: cf.slice(0, 4) }
}
const pages = code.filter((f) => /^app\/.*page\.tsx$/.test(f)).length
const routes = code.filter((f) => /^app\/.*route\.ts$/.test(f)).length
const summary = { generated: new Date().toISOString(), pages, apiRoutes: routes, sourceFiles: code.length, testFiles: tests.length, migrations: migrations.length, areas: out }
writeFileSync(path.join(ROOT, 'docs/qa-full-audit-2026-11/evidence/feature-matrix.json'), JSON.stringify(summary, null, 1))
console.log(`pages ${pages}, routes ${routes}, source files ${code.length}, test files ${tests.length}, migrations ${migrations.length}`)
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(70), 'code', String(v.codeFiles).padStart(3), 'loc', String(v.linesOfCode).padStart(6), '| tests', String(v.testFiles).padStart(3), JSON.stringify(v.byLayer))
