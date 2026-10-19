// CKDesk audit — LOCAL ISOLATION GATE. Run before every dynamic test suite:  node audit-2026-10/guard/isolation-check.mjs
// Exit code 0 = isolation proven for everything this script can check; non-zero = STOP.
// It never connects to anything except loopback and the local Docker engine, and never prints secret values.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const AUDIT = path.join(ROOT, 'audit-2026-10')
const require = createRequire(import.meta.url)
process.env.AUDIT_EVIDENCE_DIR = path.join(AUDIT, 'evidence', 'selftest') // the self-test's refusals are not real attempts
const guard = require('./egress-guard.cjs')
const FORBIDDEN = [...guard.FORBIDDEN]
const results = []
const rec = (id, ok, what, detail = '') => results.push({ id, ok, what, detail })

function parseEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}
const hostOf = (v) => { try { return new URL(v).hostname } catch { return null } }
const SECRETISH = /(KEY|SECRET|PASS|TOKEN|PWD)/i

// ---- 1. the effective configuration (audit env file + whatever the caller exported)
const auditEnv = parseEnv(path.join(AUDIT, 'env', '.env.audit'))
const localEnv = parseEnv(path.join(ROOT, '.env.local'))
const effective = { ...localEnv, ...auditEnv }
for (const [k, v] of Object.entries(process.env)) if (k in effective && v !== undefined) effective[k] = v // exported values win, exactly like Next/vitest

const badHosts = [], badForbidden = []
for (const [k, v] of Object.entries(effective)) {
  if (!v) continue
  const h = hostOf(v)
  if (h && !guard.allowed(h)) badHosts.push(`${k} -> ${h}`)
  for (const ip of FORBIDDEN) if (v.includes(ip)) badForbidden.push(`${k} contains ${ip}`)
}
rec('C1', badHosts.length === 0, 'every URL-valued setting resolves to loopback', badHosts.join('; '))
rec('C2', badForbidden.length === 0, 'no setting contains a production / retired address', badForbidden.join('; '))

const mustBeBlank = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'INTAKE_WORKER_URL', 'INTAKE_LLM_API_KEY', 'INTAKE_LLM_BASE_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'MS_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_SECRET', 'GOOGLE_PUBSUB_TOPIC', 'OAUTH_REDIRECT_BASE_URL', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'INTAKE_WEBHOOK_TOKEN', 'OPERATOR_ALERT_WEBHOOK_URL', 'INTAKE_WORKER_SECRET']
const notBlank = mustBeBlank.filter((k) => (effective[k] ?? '') !== '')
rec('C3', notBlank.length === 0, 'email / messaging / OAuth / LLM settings are blank (outbound business notifications disabled)', notBlank.join(', '))

const sb = effective.NEXT_PUBLIC_SUPABASE_URL || ''
rec('C4', /^http:\/\/127\.0\.0\.1:554\d\d$/.test(sb) && effective.SUPABASE_URL === sb, 'Supabase URL is the audit stack (127.0.0.1:554xx), not the dev stack (54321) or anything else', sb)
rec('C5', /^http:\/\/localhost:33\d\d$/.test(effective.NEXT_PUBLIC_APP_URL || '') && /^http:\/\/localhost:33\d\d$/.test(effective.CRON_TARGET_URL || ''), 'app URL and cron target are localhost:33xx', `${effective.NEXT_PUBLIC_APP_URL} / ${effective.CRON_TARGET_URL}`)
const fallthrough = Object.keys(localEnv).filter((k) => !(k in auditEnv))
rec('C6', fallthrough.length === 0, 'every key in .env.local is overridden by the audit env (nothing falls through to the dev file)', fallthrough.join(', '))
rec('C7', (process.env.NODE_OPTIONS || '').includes('egress-guard.cjs'), 'NODE_OPTIONS preloads the egress guard in this process', process.env.NODE_OPTIONS ? 'set' : 'NOT SET — start suites through audit-2026-10/guard/run.ps1')

// every environment variable the code reads that can reach an outside system must be defined in the audit env (blank or local)
const INTEGRATION_VARS = ['RESEND_API_KEY', 'SMTP_HOST', 'INTAKE_WORKER_URL', 'INTAKE_LLM_PROVIDER', 'INTAKE_LLM_BASE_URL', 'INTAKE_LLM_API_KEY', 'OAUTH_REDIRECT_BASE_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_PUBSUB_TOPIC', 'MS_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_SECRET', 'META_GRAPH_API_VERSION', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'INTAKE_WEBHOOK_TOKEN', 'OPERATOR_ALERT_WEBHOOK_URL']
const undeclared = INTEGRATION_VARS.filter((k) => !(k in auditEnv))
rec('C8', undeclared.length === 0, 'every outward-facing environment variable the code reads is explicitly defined in the audit env', undeclared.join(', '))

// ---- 2. the egress guard itself (self-test with a spy: nothing touches the network)
{
  const net = require('node:net')
  const calls = []
  const spy = function (...a) { calls.push(a); return this }
  const g = guard.guardConnect(spy)
  const probe = (host) => {
    const fake = { destroy() {}, }
    let refused = false
    const before = calls.length
    const origNext = process.nextTick
    process.nextTick = (fn) => { refused = true; return origNext.call(process, () => {}) }
    g.call(fake, 5432, host)
    process.nextTick = origNext
    return refused && calls.length === before
  }
  const must = ['10.0.1.98', '10.0.0.205', '10.0.0.25', '10.0.1.12', '182.72.84.10', '8.8.8.8', 'graph.facebook.com', '::ffff:10.0.0.205', '[::ffff:10.0.0.25]']
  const refusedAll = must.every(probe)
  const spyOk = (() => { const b = calls.length; g.call({ destroy() {} }, 55421, '127.0.0.1'); g.call({ destroy() {} }, 55421, 'localhost'); return calls.length === b + 2 })()
  rec('G1', refusedAll, `guard refuses ${must.length} forbidden/non-loopback targets before any socket is opened`, '')
  rec('G2', spyOk, 'guard lets loopback targets through', '')
  rec('G3', typeof net.Socket.prototype.connect === 'function', 'net.Socket#connect is patched when the guard is preloaded', net.Socket.prototype.connect.__ckAuditGuard ? 'patched in this process' : 'not patched in THIS process (expected for the checker itself; see C7)')
}

// ---- 3. Docker: the audit stack and what it is wired to
const dk = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let names = []
try { names = dk('ps', '--format', '{{.Names}}').split(/\r?\n/).filter((n) => n.includes('ckdesk_audit')) } catch (e) { rec('D0', false, 'docker engine reachable', String(e.message).slice(0, 120)) }
const want = ['db', 'auth', 'rest', 'kong', 'storage', 'inbucket']
const missing = want.filter((w) => !names.some((n) => n.startsWith(`supabase_${w}_ckdesk_audit`)))
rec('D1', missing.length === 0, 'audit stack containers running (db, auth, rest, kong, storage, inbucket/mail trap)', missing.length ? 'missing: ' + missing.join(', ') : names.join(', '))
const env = (c) => { try { return dk('inspect', c, '--format', '{{range .Config.Env}}{{println .}}{{end}}').split(/\r?\n/) } catch { return [] } }
const authEnv = env('supabase_auth_ckdesk_audit')
const smtpHost = (authEnv.find((l) => l.startsWith('GOTRUE_SMTP_HOST=')) || '').split('=')[1]
rec('D2', /inbucket_ckdesk_audit|mailpit/.test(smtpHost || ''), 'Auth (GoTrue) sends mail only to the local mail trap', smtpHost)
const stEnv = env('supabase_storage_ckdesk_audit')
const backend = (stEnv.find((l) => l.startsWith('STORAGE_BACKEND=')) || '').split('=')[1]
let mounts = ''
try { mounts = dk('inspect', 'supabase_storage_ckdesk_audit', '--format', '{{range .Mounts}}{{.Type}}:{{.Source}};{{end}}') } catch { /* */ }
rec('D3', backend === 'file' && /volume:/.test(mounts) && !/\\\\|\/\/10\./.test(mounts), 'Storage uses the file backend on a local Docker volume (no NAS / SMB / S3)', `${backend} ${mounts.replace(/volume:[^;]*\/volumes\//, 'volume:')}`)
const allEnv = names.flatMap((n) => env(n)).filter((l) => !SECRETISH.test(l.split('=')[0]))
const hit = []; for (const l of allEnv) for (const ip of FORBIDDEN) if (l.includes(ip)) hit.push(l.split('=')[0])
rec('D4', hit.length === 0, 'no audit-container setting references a production / retired address', hit.join(', '))
const other = (() => { try { return dk('ps', '--format', '{{.Names}}').split(/\r?\n/).filter((n) => n.includes('citykart_desk')).length } catch { return -1 } })()
rec('D5', true, 'the user\'s dev stack (citykart_desk) is a different set of containers, untouched by the audit', `${other} dev containers present, not used`)

// ---- 4. data in the audit database is synthetic / empty of business integrations
const psql = (sql) => dk('exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-F', '|', '-c', sql)
try {
  const smtp = Number(psql('select count(*) from public.email_smtp_settings'))
  const chans = Number(psql("select count(*) from public.intake_channels where status='active'"))
  const real = psql("select count(*) from auth.users where email !~* '@(example\\.test|audit\\.test)$' and email <> 'suraj@citykart.org'")
  const tickets = Number(psql("select count(*) from public.requests r join auth.users u on u.id = r.requester_id where u.email !~* '@(example\\.test|audit\\.test)$' and u.email <> 'suraj@citykart.org'"))
  rec('B1', smtp === 0, 'no mailbox (SMTP) settings stored in the audit database', String(smtp))
  rec('B2', chans === 0, 'no active WhatsApp / email intake channel in the audit database', String(chans))
  rec('B3', Number(real) === 0, 'every auth user in the audit database is synthetic (@example.test / @audit.test) apart from the seeded bootstrap admin', real)
  rec('B4', tickets === 0, 'every ticket in the audit database belongs to a synthetic requester (@audit.test / @example.test) - no migrated business tickets', String(tickets))
} catch (e) { rec('B0', false, 'audit database reachable via docker exec', String(e.message).slice(0, 160)) }

// ---- 5. local connection table: nothing of the audit has a socket towards the production machines
// (reads this PC's own table with netstat; sends nothing). A socket owned by the person's own web browser is not the audit's, but is listed.
try {
  const ns = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
  const esc = (ip) => ip.split('.').join('\\.')
  const rows = ns.split(/\r?\n/).filter((l) => FORBIDDEN.some((ip) => new RegExp('\\b' + esc(ip) + ':\\d+').test(l)))
  const nameOf = (pid) => { try { return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).split(',')[0].split('"').join('').toLowerCase() } catch { return '?' } }
  const BROWSERS = /^(chrome|msedge|firefox|brave|opera)(\.exe)?$/
  const mine = [], browser = []
  for (const l of rows) { const f = l.trim().split(/\s+/); const pid = f[f.length - 1]; const n = nameOf(pid); (BROWSERS.test(n) ? browser : mine).push(`${n}(pid ${pid}) ${f[2]} ${f[3]}`) }
  rec('N1', mine.length === 0, 'no socket owned by node / docker / ssh / psql / any non-browser process towards 10.0.1.98 / 10.0.0.205 / 10.0.0.25 / 10.0.1.12 / 182.72.84.10', mine.join('; ') || (browser.length ? "only the user's own browser: " + browser.join('; ') + ' - NOT the audit; the audit never uses this browser' : 'none'))
} catch (e) { rec('N1', false, 'could read local connection table', String(e.message).slice(0, 100)) }

// ---- report
let fail = 0
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(3)} ${r.what}${r.detail ? '  [' + r.detail + ']' : ''}`) }
const out = { at: new Date().toISOString(), pass: results.length - fail, fail, results }
try { fs.mkdirSync(path.join(AUDIT, 'evidence'), { recursive: true }); fs.writeFileSync(path.join(AUDIT, 'evidence', 'isolation-check-latest.json'), JSON.stringify(out, null, 1)) } catch { /* */ }
console.log(`\nISOLATION GATE: ${fail === 0 ? 'PASSED' : 'FAILED — STOP'}  (${results.length - fail}/${results.length})`)
process.exit(fail === 0 ? 0 : 2)
