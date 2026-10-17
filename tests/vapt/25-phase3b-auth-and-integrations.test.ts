// Phase 3B: authentication, approvals and integrations. Real database, real row security and real login service on the isolated stack; e-mail is a recorder.
// VAPT-036 push addresses, 042 webhooks, 044 approval codes, 046 mail viewer (wiring), 052 reset / invitation recipients, 053 report recipients, 061 account hygiene.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { execFileSync } from 'node:child_process'
import { flushSystemLog } from '@/lib/syslog/record'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, createTestUser, type D03Fixtures } from '../setup/fixtures-d03'
import { http } from '../remediation/helpers'

process.env.SYSTEM_LOG_IN_TESTS = '1'   // the System Log is written during this test (it is off in tests otherwise)
const sent: { to: string; subject: string; html: string; text?: string }[] = []
const cookieJar = new Map<string, string>()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async (p: { to: string; subject: string; html: string; text?: string }) => { sent.push(p); return {} }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn(async () => ({ get: (n: string) => (cookieJar.has(n) ? { value: cookieJar.get(n) } : undefined), getAll: () => [], set: (n: string, v: string) => { cookieJar.set(n, v) } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/email/auth-mail', () => ({
  emailPasswordResetLink: vi.fn(async (to: string) => { sent.push({ to, subject: 'Reset your Citykart Desk password', html: '' }); return {} }),
  emailInvitation: vi.fn(async (to: string) => { sent.push({ to, subject: 'Invitation', html: '' }); return {} }),
  isEmailConfigured: vi.fn(async () => true),
}))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) } }))

import { createClient } from '@/lib/supabase/server'
import { subscribeToPush, unsubscribeFromPush } from '@/lib/actions/push'
import { updateProfile } from '@/lib/actions/profile'
import { resetPassword } from '@/lib/actions/auth'
import { adminSendPasswordReset, inviteUser } from '@/lib/actions/admin/users'
import { createScheduledReport } from '@/lib/actions/admin/reports'
import { setPolicy } from '@/lib/actions/admin/policies'
import { invalidatePolicies } from '@/lib/permissions/policies'
import { resetCcBookCache } from '@/lib/requests/cc-recipients'
import { sendAdHocApproval } from '@/lib/actions/approvals'
import { requestApprovalCode, verifyApprovalCode } from '@/lib/actions/approvalEmail'
import { signApprovalToken } from '@/lib/approvals/email-link'
import { sharedRateLimited, firstDelivery } from '@/lib/security/shared-limits'
import { POST as gmailPost } from '@/app/api/intake/webhook/gmail/route'
import { GET as outlookGet, POST as outlookPost } from '@/app/api/intake/webhook/outlook/route'
import { GET as waGet } from '@/app/api/intake/webhook/whatsapp/route'
import { getInboxMessage } from '@/lib/queries/intake'

vi.setConfig({ testTimeout: 180_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
// the two counter tables (migration 170) are not in the generated types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyAdmin = () => getAdmin() as unknown as { from: (t: string) => any }
/** runs SQL straight on the disposable audit database (the counter tables are closed to every role except through their two functions) */
const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql], { encoding: 'utf8' }).trim()
const API = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const tag = `p25-${Date.now()}`
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const usedKeys: string[] = []
const key = (k: string) => { const full = `${k}:${tag}`; usedKeys.push(full); return full }
const createdUsers: string[] = []
const createdReports: string[] = []

beforeAll(async () => {
  fx = await setupD03Fixtures()
  process.env.APPROVAL_LINK_SECRET = 'phase3b-approval-link-secret-0123456789'
  process.env.INTAKE_WEBHOOK_TOKEN = 'phase3b-webhook-token-0123456789'
  process.env.INTAKE_WORKER_SECRET = 'phase3b-worker-secret-0123456789'
  await admin().from('app_settings').delete().like('key', 'policy.%'); invalidatePolicies()
}, 240_000)
afterAll(async () => {
  await admin().from('app_settings').delete().like('key', 'policy.%'); invalidatePolicies()
  for (const k of usedKeys) psql(`delete from rate_limit_counters where key = '${k.replace(/'/g, "''")}'; delete from webhook_seen where key = '${k.replace(/'/g, "''")}'`)
  psql(`delete from rate_limit_counters where key like '%${tag}%'; delete from webhook_seen where key like '%${tag}%' or key like 'gmail:%${tag}%' or key like 'outlook:%${tag}%'`)
  if (createdReports.length) await admin().from('scheduled_reports').delete().in('id', createdReports)
  for (const id of createdUsers) { try { await admin().auth.admin.deleteUser(id) } catch { /* best effort */ } }
  await admin().from('oems').delete().like('name', `${tag}%`)
  await fx?.cleanup()
}, 120_000)

describe('the shared limiter and replay guard (migration 170)', () => {
  it('counts parallel callers correctly: exactly `limit` are let through', async () => {
    const k = key('limit-parallel')
    const results = await Promise.all(Array.from({ length: 25 }, () => sharedRateLimited(k, 5, 60)))
    expect(results.filter((over) => !over)).toHaveLength(5)
    expect(results.filter((over) => over)).toHaveLength(20)
    expect(psql(`select count from rate_limit_counters where key = '${k}'`)).toBe('25')      // counted in the database, not in memory
  })
  it('starts a new window after the old one has passed', async () => {
    const k = key('limit-window')
    expect(await sharedRateLimited(k, 1, 1)).toBe(false)
    expect(await sharedRateLimited(k, 1, 1)).toBe(true)
    await new Promise((r) => setTimeout(r, 1300))
    expect(await sharedRateLimited(k, 1, 1)).toBe(false)
  })
  it('lets exactly one of ten parallel identical deliveries through', async () => {
    const k = key('delivery-parallel')
    const results = await Promise.all(Array.from({ length: 10 }, () => firstDelivery(k, 3600)))
    expect(results.filter(Boolean)).toHaveLength(1)
  })
  it('a signed-in user cannot call the limiter or the replay guard through the data API, and cannot read the tables', async () => {
    for (const fn of ['rate_limit_hit', 'webhook_seen_once']) {
      const r = await http('POST', `/rest/v1/rpc/${fn}`, { token: fx.admin.accessToken, body: fn === 'rate_limit_hit' ? { p_key: 'x', p_limit: 1, p_window_seconds: 1 } : { p_key: 'x', p_ttl_seconds: 1 } })
      expect(r.status, fn).toBeGreaterThanOrEqual(400)
    }
    for (const t of ['rate_limit_counters', 'webhook_seen']) expect((await http('GET', `/rest/v1/${t}?select=*`, { token: fx.admin.accessToken })).status, t).toBeGreaterThanOrEqual(400)
  })
})

describe('VAPT-036: push subscriptions', () => {
  const FCM = `https://fcm.googleapis.com/fcm/send/${tag}`
  it('a signed-in user cannot write the table directly; the server saves only a real push service address', async () => {
    const direct = await http('POST', '/rest/v1/push_subscriptions', { token: fx.requesterA.accessToken, body: { user_id: fx.requesterA.id, org_id: fx.orgId, endpoint: 'https://127.0.0.1:9/x', p256dh: 'a', auth: 'b' } })
    expect(direct.status).toBeGreaterThanOrEqual(400)
    actAs(fx.requesterA)
    for (const bad of ['https://example.org/hook', 'http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.net/x'])
      expect((await subscribeToPush({ endpoint: bad, keys: { p256dh: 'a', auth: 'b' } })).error, bad).toBeTruthy()
    expect((await subscribeToPush({ endpoint: FCM, keys: { p256dh: 'a', auth: 'b' } })).error).toBeUndefined()
    const { data } = await admin().from('push_subscriptions').select('user_id').eq('endpoint', FCM)
    expect(data).toEqual([{ user_id: fx.requesterA.id }])
  })
  it('somebody else cannot take over an address that is already stored, nor remove it', async () => {
    actAs(fx.requesterB)
    expect((await subscribeToPush({ endpoint: FCM, keys: { p256dh: 'x', auth: 'y' } })).error).toBeTruthy()
    await unsubscribeFromPush(FCM)
    expect((await admin().from('push_subscriptions').select('id').eq('endpoint', FCM)).data).toHaveLength(1)
    actAs(fx.requesterA)
    expect((await unsubscribeFromPush(FCM)).error).toBeUndefined()
    expect((await admin().from('push_subscriptions').select('id').eq('endpoint', FCM)).data).toHaveLength(0)
  })
})

describe('VAPT-061: display names and passwords', () => {
  it('a name cannot be changed through the data API any more, and the application checks it', async () => {
    const direct = await http('PATCH', `/rest/v1/profiles?id=eq.${fx.requesterA.id}`, { token: fx.requesterA.accessToken, body: { full_name: 'Direct Write' } })
    expect(direct.status).toBeGreaterThanOrEqual(400)
    expect((await admin().from('profiles').select('full_name').eq('id', fx.requesterA.id).single()).data?.full_name).not.toBe('Direct Write')
    actAs(fx.requesterA)
    for (const bad of ['<b>Boss</b>', 'x', 'Asha‮Verma']) expect((await updateProfile({ full_name: bad })).error, bad).toBeTruthy()
    expect((await updateProfile({ full_name: `Requester ${tag}` })).error).toBeUndefined()
    expect((await admin().from('profiles').select('full_name').eq('id', fx.requesterA.id).single()).data?.full_name).toBe(`Requester ${tag}`)
  })
  it('a requester cannot take the name of a member of staff; staff can rename themselves (and it is audited)', async () => {
    const staffName = (await admin().from('profiles').select('full_name').eq('id', fx.manager.id).single()).data!.full_name as string
    actAs(fx.requesterA)
    expect((await updateProfile({ full_name: staffName.toUpperCase() })).error).toMatch(/already used/i)
    actAs(fx.agentA)
    expect((await updateProfile({ full_name: `Technician ${tag}` })).error).toBeUndefined()
    await new Promise((r) => setTimeout(r, 300)); await flushSystemLog()
    const { data } = await anyAdmin().from('system_log').select('action').eq('action', 'profile.name_changed').eq('actor_id', fx.agentA.id).limit(1)
    expect(data?.length).toBe(1)
  })

  const anon = () => createSupabaseClient(API, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  /** a database client for a signed-in person whose session also reports how it started (getSession) and can change the password (updateUser) */
  function session(token: string) {
    const db = clientForToken(token)
    const auth = new Proxy(db.auth, {
      get(target, prop, receiver) {
        if (prop === 'getSession') return async () => ({ data: { session: { access_token: token } }, error: null })
        if (prop === 'updateUser') return async ({ password }: { password: string }) => {
          const r = await fetch(`${API}/auth/v1/user`, { method: 'PUT', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
          return { error: r.ok ? null : { message: await r.text() } }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    return new Proxy(db, { get: (target, prop, receiver) => (prop === 'auth' ? auth : Reflect.get(target, prop, target)) })
  }
  const fd = (password: string) => { const f = new FormData(); f.set('password', password); return f }

  it('an ordinary signed-in session cannot set a new password without the current one', async () => {
    const u = await createTestUser('p25-pw', 'P25 Password User'); createdUsers.push(u.id)
    vi.mocked(createClient).mockResolvedValue(session(u.accessToken) as never)
    const res = await resetPassword(fd('A-Brand-New-Passw0rd!'))
    expect(res).toMatchObject({ error: expect.stringMatching(/Change password/i) })
  })
  it('a session that started from a recovery link can (the "forgot password" path keeps working)', async () => {
    const u = await createTestUser('p25-rec', 'P25 Recovery User'); createdUsers.push(u.id)
    const link = await admin().auth.admin.generateLink({ type: 'recovery', email: u.email })
    const hashed = link.data.properties?.hashed_token
    expect(hashed).toBeTruthy()
    const verified = await anon().auth.verifyOtp({ type: 'recovery', token_hash: hashed! })
    const token = verified.data.session?.access_token
    expect(token).toBeTruthy()
    vi.mocked(createClient).mockResolvedValue(session(token!) as never)
    await expect(resetPassword(fd('Another-New-Passw0rd!'))).rejects.toThrow('REDIRECT:/home')
  })
})

describe('VAPT-052: reset and invitation recipients', () => {
  it('a reset link is mailed only to an existing user of the administrator\'s organisation', async () => {
    resetCcBookCache()
    actAs(fx.admin)
    sent.length = 0
    expect((await adminSendPasswordReset('someone.else@gmail.example')).error).toMatch(/does not belong/i)
    expect((await adminSendPasswordReset(' ')).error).toBeTruthy()
    expect(sent).toHaveLength(0)
    expect((await adminSendPasswordReset(fx.requesterA.email)).error).toBeUndefined()
    expect(sent.map((m) => m.to)).toEqual([fx.requesterA.email])
  })
  it('an address outside the company mail domain can be invited by default, and is refused once the owner switches that on; either way the audit trail records it', async () => {
    process.env.ORG_MAIL_DOMAINS = 'example.test'
    const outside = `invitee-${tag}@audit.test`, inside = `invitee-${tag}@example.test`
    actAs(fx.admin)
    const first = await inviteUser({ email: outside, full_name: 'Outside Invitee', role: 'user' })
    expect(first.error).toBeUndefined()
    await new Promise((r) => setTimeout(r, 300)); await flushSystemLog()
    const { data: audit } = await anyAdmin().from('system_log').select('after_data').eq('action', 'user.invited').eq('entity_label', outside).limit(1)
    expect((audit?.[0]?.after_data as { external_domain?: boolean } | undefined)?.external_domain).toBe(true)

    actAs(fx.platformOwner)
    expect((await setPolicy('external_invites', 'org_domains_only')).error).toBeUndefined()
    actAs(fx.admin)
    expect((await inviteUser({ email: `second-${tag}@audit.test`, full_name: 'Second Outside', role: 'user' })).error).toMatch(/company mail domain/i)
    expect((await inviteUser({ email: inside, full_name: 'Inside Invitee', role: 'user' })).error).toBeUndefined()
    for (const email of [outside, inside]) {
      const id = (await admin().auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)?.id
      if (id) createdUsers.push(id)
    }
    delete process.env.ORG_MAIL_DOMAINS
  })
})

describe('VAPT-053: who a scheduled report may go to', () => {
  it('OEM contacts may receive reports by default; once the owner says "users only" they may not, and users still may', async () => {
    const oemMail = `contact-${tag}@vendor-p25.test`
    await admin().from('oems').insert({ org_id: fx.orgId, name: `${tag} OEM`, emails: [oemMail] })
    resetCcBookCache()
    actAs(fx.admin)
    const base = { name: `${tag} report`, report_type: 'requests' as const, frequency: 'weekly' as const, filters: {}, is_active: false }
    const a = await createScheduledReport({ ...base, recipients: [oemMail] })
    expect(a.error).toBeUndefined(); if (a.data?.id) createdReports.push(a.data.id)

    actAs(fx.platformOwner)
    expect((await setPolicy('report_recipients', 'users_only')).error).toBeUndefined()
    actAs(fx.admin)
    expect((await createScheduledReport({ ...base, recipients: [oemMail] })).error).toMatch(/not an address of this organisation/i)
    const b = await createScheduledReport({ ...base, recipients: [fx.requesterA.email] })
    expect(b.error).toBeUndefined(); if (b.data?.id) createdReports.push(b.data.id)
    expect((await createScheduledReport({ ...base, recipients: ['stranger@elsewhere.test'] })).error).toBeTruthy()
  })
})

describe('VAPT-044: approval-link codes', () => {
  async function approval() {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    actAs(fx.agentA)
    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()
    const a = (await admin().from('approvals').select('id').eq('request_id', t.id).eq('status', 'pending').single()).data!
    return { approvalId: a.id as string, link: signApprovalToken(a.id, fx.manager.id)! }
  }
  it('someone holding the link cannot keep cancelling the approver\'s code: while one is valid, no new one is made', async () => {
    const { approvalId, link } = await approval()
    sent.length = 0
    expect((await requestApprovalCode(link)).error).toBeUndefined()
    const codeMails = () => sent.filter((m) => /verification code/i.test(m.subject))
    expect(codeMails()).toHaveLength(1)
    const code1 = codeMails()[0].html.match(/>(\d{6})</)?.[1]
    expect(code1).toBeTruthy()
    const second = await requestApprovalCode(link)
    expect(second.error).toMatch(/already sent/i)
    expect(codeMails()).toHaveLength(1)                                       // no second e-mail, no new code
    // the first code still works
    expect((await verifyApprovalCode(link, code1!)).error).toBeUndefined()
    expect((await anyAdmin().from('approval_email_codes').select('used_at').eq('approval_id', approvalId)).data?.filter((r: { used_at: string | null }) => r.used_at === null)).toHaveLength(0)
  })
  it('after a lock-out a new code can be requested, and the approver is told that wrong codes were entered', async () => {
    const { link } = await approval()
    sent.length = 0
    expect((await requestApprovalCode(link)).error).toBeUndefined()
    for (let i = 0; i < 5; i++) await verifyApprovalCode(link, '000000')
    expect((await verifyApprovalCode(link, '000000')).error).toMatch(/too many|locked|wrong/i)
    const notices = sent.filter((m) => /wrong codes were entered/i.test(m.subject))
    expect(notices).toHaveLength(1)
    expect(notices[0].to).toBe(fx.manager.email)
    // the locked code is not "usable", so a new one is allowed (the 10-minute request counter is separate)
    const again = await requestApprovalCode(link)
    expect(again.error === undefined || /moment ago|few minutes/i.test(again.error)).toBe(true)
  })
  it('the counters are kept in the database, so they hold after a restart: four requests in a row are refused', async () => {
    const { approvalId, link } = await approval()
    const keyBase = `approval-code:${approvalId}:${fx.manager.id}`
    usedKeys.push(keyBase)
    psql(`insert into rate_limit_counters (key, window_start, count) values ('${keyBase}', now(), 3) on conflict (key) do update set count = 3, window_start = now()`)
    expect((await requestApprovalCode(link)).error).toMatch(/moment ago|few minutes/i)
    psql(`delete from rate_limit_counters where key = '${keyBase}'`)
  })
})

describe('VAPT-042: webhooks', () => {
  const gmailReq = (body: unknown, headers: Record<string, string> = {}, token = process.env.INTAKE_WEBHOOK_TOKEN) =>
    new NextRequest(`http://localhost/api/intake/webhook/gmail?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const pushBody = (messageId: string, publishTime = new Date().toISOString()) =>
    ({ message: { data: Buffer.from(JSON.stringify({ emailAddress: `nobody-${tag}@example.test`, historyId: '1' })).toString('base64'), messageId, publishTime }, subscription: 's' })

  it('Gmail: the shared token is still required', async () => {
    expect((await gmailPost(gmailReq(pushBody(key('g0')), {}, 'wrong-token'))).status).toBe(401)
  })
  it('Gmail: a repeat of the same message id is dropped, and an old delivery is ignored', async () => {
    const id = key('gmail-msg')
    expect((await gmailPost(gmailReq(pushBody(id)))).status).toBe(200)
    expect(await firstDelivery(`gmail:${id}`, 3600)).toBe(false)             // the first call recorded it
    const old = key('gmail-old')
    expect((await gmailPost(gmailReq(pushBody(old, new Date(Date.now() - 3 * 3600_000).toISOString())))).status).toBe(200)
    expect(await firstDelivery(`gmail:${old}`, 3600)).toBe(true)             // not even recorded: it was ignored before that
  })
  it('Gmail: once Google\'s signed token is configured, a delivery without a valid one is refused', async () => {
    process.env.GMAIL_PUSH_OIDC_AUDIENCE = 'https://desk.example.test/api/intake/webhook/gmail'
    process.env.GMAIL_PUSH_OIDC_EMAIL = 'push@proj.iam.gserviceaccount.com'
    try {
      expect((await gmailPost(gmailReq(pushBody(key('g-oidc'))))).status).toBe(401)
      expect((await gmailPost(gmailReq(pushBody(key('g-oidc2')), { authorization: 'Bearer a.b.c' }))).status).toBe(401)
    } finally { delete process.env.GMAIL_PUSH_OIDC_AUDIENCE; delete process.env.GMAIL_PUSH_OIDC_EMAIL }
  })
  it('Outlook: only a short plain validation token is echoed back, as text', async () => {
    const ok = await outlookGet(new NextRequest('http://localhost/api/intake/webhook/outlook?validationToken=Validation%3A+abc-123_x'))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('text/plain')
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
    for (const bad of [encodeURIComponent('<script>alert(1)</script>'), 'x'.repeat(600), encodeURIComponent('a b"c')]) {
      expect((await outlookGet(new NextRequest(`http://localhost/api/intake/webhook/outlook?validationToken=${bad}`))).status).toBe(400)
    }
  })
  it('Outlook: a notification delivered twice is handled once', async () => {
    process.env.INTAKE_WORKER_URL = 'http://127.0.0.1:9'
    const msg = key('outlook-msg')
    const body = { value: [{ changeType: 'created', resourceData: { id: msg }, subscriptionId: 'sub-x', clientState: process.env.INTAKE_WEBHOOK_TOKEN }] }
    const post = () => outlookPost(new NextRequest('http://localhost/api/intake/webhook/outlook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    expect((await post()).status).toBe(200)
    expect(await firstDelivery(`outlook:sub-x:${msg}`, 3600)).toBe(false)
    expect((await post()).status).toBe(200)
    delete process.env.INTAKE_WORKER_URL
  })
  it('WhatsApp: an unknown verify token gets 403; a flood of challenge requests is slowed down', async () => {
    const url = (t: string) => `http://localhost/api/intake/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=12345`
    expect((await waGet(new NextRequest(url('nope')))).status).toBe(403)
    psql(`insert into rate_limit_counters (key, window_start, count) values ('wa-verify', now(), 119) on conflict (key) do update set count = 119, window_start = now()`)
    try {
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) statuses.push((await waGet(new NextRequest(url('nope')))).status)
      expect(statuses).toContain(429)
    } finally { psql(`delete from rate_limit_counters where key = 'wa-verify'`) }
  })
})

describe('VAPT-046: the mail viewer receives cleaned HTML', () => {
  it('getInboxMessage returns the stored mail with remote content removed or parked', async () => {
    const channel = (await admin().from('intake_channels').select('id').limit(1).single()).data!.id
    const hostile = '<p>Hello</p><img src="https://tracker.example/p.gif"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/a.css"><div style="background:url(https://evil.example/b.png)">x</div>'
    const msg = await admin().from('intake_messages').insert({ org_id: fx.orgId, channel_id: channel, subject: `${tag} mail`, body_html: hostile, body_text: 'Hello', from_address: 'a@b.test', external_message_id: `${tag}-m1` } as never).select('id').single()
    try {
      actAs(fx.agentA)
      const { message } = await getInboxMessage(msg.data!.id)
      const html = message?.body_html ?? ''
      expect(html).toContain('Hello')
      expect(html).toContain('data-remote-src="https://tracker.example/p.gif"')
      expect(html).not.toMatch(/<meta|<link|evil\.example|\ssrc="https/i)
    } finally { await admin().from('intake_messages').delete().eq('id', msg.data!.id) }
  })
})
