// QA 2026-11 — BUSINESS UAT scenario G: WhatsApp intake, black-box through the REAL webhook route of the isolated AUDIT app.
// Meta is never contacted (the egress guard refuses graph.facebook.com; replies therefore fail, which is itself one of the checks).
// A synthetic WhatsApp channel (fake phone-number id, fake secrets) is created in the audit DB and removed again at the end.
// The full conversation flow (service -> sub category -> description -> fields -> review -> ticket) is covered by the integration suite with only Meta's HTTP boundary mocked
// (tests/integration/stage5-webhook-e2e.test.ts, stage7b-*): see report 06. This script checks the part those cannot: the deployed HTTP surface.
//   node docs/qa-full-audit-2026-11/uat/uat-g-whatsapp.mjs
import { createHmac } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..')
const OUT = path.join(HERE, '..', 'evidence', 'uat'); mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3310'
const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js')
const env = Object.fromEntries(readFileSync(path.join(ROOT, 'audit-2026-10/env/.env.audit'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Refusing: not the isolated audit stack.')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const ORG = '00000000-0000-0000-0000-000000000001'
const tag = 'qa11wa' + Date.now().toString().slice(-6)
const PNID = '1555' + tag.slice(-6), APP_SECRET = `qa-app-secret-${tag}`, VERIFY = `qa-verify-${tag}`, TOKEN = `qa-token-${tag}`
const KNOWN = '9666' + tag.slice(-6), KNOWN_WA = '91' + KNOWN, STRANGER = '919000000099'
const results = []
const log = (id, status, title, detail = '') => { results.push({ id, status, title, detail }); console.log(`${status.padEnd(5)} ${id}  ${title}${detail ? '  — ' + detail : ''}`) }
const run = async (id, title, fn) => { try { log(id, 'PASS', title, (await fn()) || '') } catch (e) { log(id, 'FAIL', title, String(e.message || e).slice(0, 320)) } }
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const sign = (body, secret = APP_SECRET) => 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
let seq = 0
const payload = (from, body, over = {}) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba-qa', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PNID, display_phone_number: PNID }, contacts: [{ wa_id: from, profile: { name: 'QA Sender' } }], messages: [{ from, id: `wamid.${tag}.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body }, ...over }] } }] }] })
const post = (body, sig) => fetch(BASE + '/api/intake/webhook/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) }, body })
const counts = async () => ({ requests: (await db.from('requests').select('id', { count: 'exact', head: true })).count, convs: (await db.from('request_conversations').select('id', { count: 'exact', head: true })).count, events: (await db.from('conversation_events').select('id', { count: 'exact', head: true })).count })
const S = {}

try {
  await run('G00', 'Set-up: synthetic WhatsApp channel + one registered requester (WhatsApp on) and one stranger', async () => {
    const ch = must(await db.from('intake_channels').insert({ org_id: ORG, type: 'whatsapp', name: 'QA WhatsApp ' + tag, config: { phone_number_id: PNID }, status: 'active' }).select('id').single(), 'channel'); S.ch = ch.id
    must(await db.rpc('intake_store_credential', { p_channel_id: ch.id, p_secret: JSON.stringify({ type: 'whatsapp', access_token: TOKEN, app_secret: APP_SECRET, verify_token: VERIFY }) }), 'vault')
    const u = await db.auth.admin.createUser({ email: `${tag}@audit.test`, password: 'QA-Audit-Pw-2026!', email_confirm: true, user_metadata: { full_name: 'QA WA Requester' } }); if (u.error) throw new Error(u.error.message); S.user = u.data.user.id
    must(await db.from('profiles').update({ org_id: ORG, role: 'user', is_active: true, must_reset_password: false, whatsapp_enabled: true }).eq('id', S.user), 'profile')
    must(await db.from('profile_mobile_numbers').insert({ profile_id: S.user, org_id: ORG, mobile_number: KNOWN }), 'mobile')
    return `channel ${S.ch.slice(0, 8)}, phone id ${PNID}`
  })
  await run('G01', 'Handshake: right verify token echoes the challenge; wrong token, wrong mode and a script-like challenge are all refused (403)', async () => {
    const q = (o) => fetch(BASE + '/api/intake/webhook/whatsapp?' + new URLSearchParams(o))
    const ok = await q({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '12345' }); const t = await ok.text()
    const bad = await q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '12345' }); const mode = await q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '12345' }); const xss = await q({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '<script>alert(1)</script>' })
    if (ok.status !== 200 || t !== '12345') throw new Error(`good handshake ${ok.status} "${t}"`); if (ok.headers.get('content-type') !== 'text/plain') throw new Error('challenge not text/plain')
    if (bad.status !== 403 || mode.status !== 403 || xss.status !== 403) throw new Error(`refusals ${bad.status}/${mode.status}/${xss.status}`); return 'echo 12345 as text/plain; 3 refusals 403'
  })
  await run('G02', 'Unsigned, wrongly signed and tampered messages are rejected and change nothing', async () => {
    const before = await counts(); const body = payload(KNOWN_WA, 'Hi')
    const a = await post(body); const b = await post(body, sign(body, 'wrong-secret')); const c = await post(body, sign(body) + '00'); const d = await post(body + ' ', sign(body))   // d: body changed after signing
    const codes = [a.status, b.status, c.status, d.status]; if (codes.some((x) => x === 200)) throw new Error('accepted a bad signature: ' + codes.join(','))
    const after = await counts(); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`data changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`); return `statuses ${codes.join('/')}; no rows created`
  })
  await run('G03', 'Oversized body (>1 MB) is refused with 413 before it is read', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(1_200_000) }); const r = await post(big, sign(big)); if (r.status !== 413) throw new Error('got ' + r.status); return '413'
  })
  await run('G04', 'Malformed JSON with a VALID signature gets 200 (no retry storm) and creates nothing', async () => {
    const before = await counts(); const body = '{"object": "whatsapp_business_account", "entry": [ BROKEN'; const r = await post(body, sign(body)); const after = await counts()
    if (r.status !== 200) throw new Error('got ' + r.status); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('rows created'); return '200, nothing created'
  })
  await run('G05', 'Unknown destination phone-number id (not our channel) is ignored safely; creates nothing', async () => {
    const before = await counts(); const body = payload(KNOWN_WA, 'Hi').replace(PNID, '1999000111'); const r = await post(body, sign(body)); const after = await counts()
    if (r.status >= 500) throw new Error('server error ' + r.status); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('rows created'); return `status ${r.status}, nothing created`
  })
  await run('G06', 'Stranger (number not registered to any user) writing "Hi": no ticket and no conversation is created for them', async () => {
    const before = await counts(); const body = payload(STRANGER, 'Hi, my AC is broken'); const r = await post(body, sign(body)); await new Promise((x) => setTimeout(x, 1500)); const after = await counts()
    if (r.status >= 500) throw new Error('server error ' + r.status); if (after.requests !== before.requests) throw new Error('a ticket was created for a stranger'); if (after.convs !== before.convs) throw new Error('a conversation was started for a stranger'); return `status ${r.status}; no ticket, no conversation`
  })
  await run('G07', 'Registered requester says "Hi": a conversation starts for THAT person; Meta being unreachable does not crash the webhook', async () => {
    const body = payload(KNOWN_WA, 'Hi'); const r = await post(body, sign(body)); await new Promise((x) => setTimeout(x, 2500))
    if (r.status !== 200) throw new Error('webhook answered ' + r.status)
    const conv = must(await db.from('request_conversations').select('id, state, requester_id').eq('requester_id', S.user), 'conv')
    if (!conv.length) throw new Error('no conversation for the registered requester'); S.conv = conv[0]
    return `200; conversation state "${conv[0].state}" for the right person`
  })
  await run('G08', 'Replaying the SAME message id is idempotent: no second conversation and no duplicate processing', async () => {
    const body = payload(KNOWN_WA, 'Hi again'); await post(body, sign(body)); const c1 = await counts(); await post(body, sign(body)); await post(body, sign(body)); await new Promise((x) => setTimeout(x, 1500)); const c2 = await counts()
    if (JSON.stringify(c1) !== JSON.stringify(c2)) throw new Error(`replays changed data: ${JSON.stringify(c1)} -> ${JSON.stringify(c2)}`); return 'two replays changed nothing'
  })
  await run('G09', 'A one-person conversation is never shared: the stranger cannot read or change the requester\'s conversation', async () => {
    const before = must(await db.from('request_conversations').select('state').eq('id', S.conv.id).single(), 'before').state
    const body = payload(STRANGER, 'cancel'); await post(body, sign(body)); const body2 = payload(STRANGER, S.conv.id); await post(body2, sign(body2)); await new Promise((x) => setTimeout(x, 1200))
    const after = must(await db.from('request_conversations').select('state').eq('id', S.conv.id).single(), 'after').state; if (before !== after) throw new Error(`state ${before} -> ${after}`); return `state unchanged ("${after}")`
  })
  await run('G10', 'No secret leaks: webhook responses never contain the app secret, token or verify token', async () => {
    const body = payload(KNOWN_WA, 'status please'); const r = await post(body, sign(body)); const t = await r.text(); for (const s of [APP_SECRET, TOKEN, VERIFY]) if (t.includes(s)) throw new Error('a secret appears in the response'); return 'no secrets in the response body'
  })
  await run('G11', 'Meta replies were attempted and refused by the egress guard (nothing left the machine)', async () => {
    const lines = readFileSync(path.join(ROOT, 'audit-2026-10/evidence/egress-denied.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.target?.startsWith('graph.facebook.com') && x.t > new Date(Date.now() - 30 * 60_000).toISOString())
    if (!lines.length) throw new Error('no graph.facebook.com attempt was recorded in the last 30 minutes (guard evidence missing)'); return `${lines.length} refused attempt(s) to graph.facebook.com in this run`
  })
} finally {
  try {
    if (S.user) { await db.from('request_conversations').delete().eq('requester_id', S.user); await db.from('requests').delete().eq('requester_id', S.user); await db.from('profile_mobile_numbers').delete().eq('profile_id', S.user); await db.from('profiles').delete().eq('id', S.user); await db.auth.admin.deleteUser(S.user) }
    if (S.ch) await db.from('intake_channels').delete().eq('id', S.ch)
  } catch (e) { console.log('cleanup warning:', e.message) }
  writeFileSync(path.join(OUT, 'uat-g-results.json'), JSON.stringify({ ran: new Date().toISOString(), tag, results }, null, 1))
  const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0)
}
