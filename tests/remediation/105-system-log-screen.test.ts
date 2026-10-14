// The System Log screen's server actions, as real signed-in users with row security on: who may use them, filters, paging, that another
// organization's administrator sees nothing of ours, grouping, export, the "copy for Claude" bundle, and the integrity check (including tampering).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'
import { svc, http, createUser, deleteUser, SERVICE, ORG_A, type Session } from './helpers'

process.env.SYSTEM_LOG_IN_TESTS = '1'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { listSystemLog, listErrorGroups, buildErrorBundle, exportSystemLog, verifyLogIntegrity, SYSTEM_LOG_PAGE_SIZE } from '@/lib/actions/admin/system-log'
import { flushSystemLog } from '@/lib/syslog/record'

const mockedCreateClient = vi.mocked(createClient)
const actAs = (u: { accessToken: string }) => mockedCreateClient.mockResolvedValue(clientForToken(u.accessToken) as never)
const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const tag = `scr${Date.now()}`
let fx: D03Fixtures
let orgB: string
let adminB: Session & { accessToken: string }
const extraUsers: string[] = []

const base = (n: number, extra: Record<string, unknown> = {}) => ({ org_id: ORG_A, category: 'error', source: 'app_server', severity: 'error', outcome: 'failure', action: `${tag}.e${n}`, message: `${tag} problem number ${n}`, ...extra })

beforeAll(async () => {
  fx = await setupD03Fixtures()
  await svc('POST', '/system_log', Array.from({ length: 120 }, (_, i) => base(i, { action: `${tag}.page`, message: `${tag} paging row ${i}`, fingerprint: `${tag}-pg` })))
  const oneByOne = async (rows: Record<string, unknown>[]) => { for (const r of rows) { const res = await svc('POST', '/system_log', r); if (res.status !== 201) throw new Error('seed failed: ' + res.text) } }
  await oneByOne([
    ...Array.from({ length: 5 }, (_, i) => base(i, { action: `${tag}.timeout`, source: 'database', error_code: '57014', fingerprint: `${tag}-fp1`, message: `${tag} canceling statement due to statement timeout (mail suraj@citykart.org)`, path: '/requests', from_click: i < 2, click_target: i < 2 ? 'button:Refresh' : null, stack: 'Error: timeout\n at q (lib/q.ts:1:1)' })),
    base(1, { action: `${tag}.warn`, severity: 'warning', source: 'integration', fingerprint: `${tag}-fp2`, message: `${tag} slow mail provider` }),
    { org_id: ORG_A, category: 'audit', source: 'admin', severity: 'info', outcome: 'success', action: `${tag}.audit`, entity_type: 'user', entity_label: 'someone', message: `${tag} audit thing` },
  ])
  orgB = (await svc<{ id: string }[]>('POST', '/organizations', { name: `Screen B ${tag}`, slug: `${tag}-b`, status: 'active', seat_limit: 5 }, { Prefer: 'return=representation' })).json[0].id
  const s = await createUser(`${tag}-adminb@audit.test`, 'Screen Admin B')
  extraUsers.push(s.id)
  await svc('PATCH', `/profiles?id=eq.${s.id}`, { org_id: orgB, role: 'admin', is_active: true })
  adminB = { ...s, accessToken: s.token }
  await svc('POST', '/system_log', { org_id: orgB, category: 'error', source: 'app_server', severity: 'error', outcome: 'failure', action: `${tag}.orgb`, message: `${tag} secret of organization B` })
}, 180_000)

afterAll(async () => {
  psql('alter table system_log enable trigger trg_system_log_guard')
  psql('alter table system_log enable trigger trg_system_log_chain')
  for (const id of extraUsers) await deleteUser(id)
  await http('POST', '/rest/v1/rpc/owner_delete_org', { key: SERVICE, token: SERVICE, body: { p_org_id: orgB } })
  await fx?.cleanup()
}, 180_000)

describe('who may use the screen', () => {
  it('only administrators and platform owners; everyone else is refused', async () => {
    for (const who of [fx.manager, fx.agentA, fx.requesterA] as TestUser[]) {
      actAs(who)
      expect((await listSystemLog({ days: 7 })).error, who.email).toMatch(/Unauthorized/)
      expect((await listErrorGroups({ days: 7 })).error).toMatch(/Unauthorized/)
      expect((await buildErrorBundle({ days: 7 })).error).toMatch(/Unauthorized/)
      await expect(exportSystemLog({ days: 7 }, 'csv')).rejects.toThrow(/Unauthorized/)
    }
    actAs(fx.admin)
    expect((await listSystemLog({ days: 7 })).error).toBeUndefined()
  })
})

describe('the log', () => {
  it('filters by category, source, severity, click and text; pages of 100 with a next-page flag', async () => {
    actAs(fx.admin)
    const all = await listSystemLog({ days: 7, q: tag })
    expect(all.rows).toHaveLength(SYSTEM_LOG_PAGE_SIZE); expect(all.hasMore).toBe(true)
    const p2 = await listSystemLog({ days: 7, q: tag }, 1)
    expect(p2.rows.length).toBeGreaterThanOrEqual(20); expect(p2.hasMore).toBe(false)
    expect((await listSystemLog({ days: 7, q: `${tag}.audit` })).rows.map((r) => r.category)).toEqual(['audit'])
    expect((await listSystemLog({ days: 7, q: tag, category: 'audit' })).rows).toHaveLength(1)
    expect((await listSystemLog({ days: 7, q: `${tag}.timeout`, source: 'database' })).rows).toHaveLength(5)
    expect((await listSystemLog({ days: 7, q: `${tag}.warn`, minSeverity: 'error' })).rows).toHaveLength(0)
    expect((await listSystemLog({ days: 7, q: `${tag}.warn`, minSeverity: 'warning' })).rows).toHaveLength(1)
    expect((await listSystemLog({ days: 7, q: `${tag}.timeout`, click: 'click' })).rows).toHaveLength(2)
    expect((await listSystemLog({ days: 7, q: `${tag}.timeout`, click: 'no_click' })).rows).toHaveLength(3)
    expect((await listSystemLog({ days: 7, fingerprint: `${tag}-fp2` })).rows).toHaveLength(1)
  })
  it('hostile search text cannot break the query', async () => {
    actAs(fx.admin)
    const r = await listSystemLog({ days: 7, q: `${tag}%,message.eq.x)(*\\` })
    expect(r.error).toBeUndefined()
  })
  it('another organization\'s administrator sees none of our rows, and we see none of theirs', async () => {
    actAs(adminB)
    // adminB is not in the fixtures' organization: they get their own organization's rows only
    const theirs = await listSystemLog({ days: 7, q: tag })
    expect(theirs.rows.map((r) => r.action)).toEqual([`${tag}.orgb`])
    actAs(fx.admin)
    expect((await listSystemLog({ days: 7, q: `${tag}.orgb` })).rows).toHaveLength(0)
  })
})

describe('grouped errors, export and the Claude bundle', () => {
  it('counts the same problem once, with how often and how many followed a click', async () => {
    actAs(fx.admin)
    const { groups } = await listErrorGroups({ days: 7, q: tag })
    const g = groups.find((x) => x.fingerprint === `${tag}-fp1`)!
    expect(g).toMatchObject({ count: 5, source: 'database', errorCode: '57014', clickCount: 2 })
    expect(g.paths).toEqual(['/requests'])
  })
  it('the bundle is redacted markdown naming the problem; copying it is itself audited', async () => {
    actAs(fx.admin)
    const { text } = await buildErrorBundle({ days: 7, q: `${tag}.timeout` })
    expect(text).toContain('canceling statement due to statement timeout')
    expect(text).toContain('Followed a click: 2 of 5')
    expect(text).not.toContain('suraj@citykart.org')
    await new Promise((r) => setTimeout(r, 300)); await flushSystemLog()
    expect((await svc<unknown[]>('GET', `/system_log?action=eq.data.exported.system_log_bundle&actor_id=eq.${fx.admin.id}`)).json.length).toBeGreaterThanOrEqual(1)
  })
  it('CSV and JSON exports hold the rows and are audited with the filters used', async () => {
    actAs(fx.admin)
    const csv = await exportSystemLog({ days: 7, q: `${tag}.timeout` }, 'csv')
    expect(csv.split(`${tag}.timeout`).length - 1).toBe(5)   // five rows (stack traces are quoted, so lines are not rows)
    expect(csv).toContain('57014')
    const json = JSON.parse(await exportSystemLog({ days: 7, q: `${tag}.timeout` }, 'json')) as { action: string }[]
    expect(json).toHaveLength(5)
    await new Promise((r) => setTimeout(r, 300)); await flushSystemLog()
    const audit = (await svc<{ after_data: { rows: number; format: string } }[]>('GET', `/system_log?action=eq.data.exported.system_log&actor_id=eq.${fx.admin.id}&order=id.desc&limit=2`)).json
    expect(audit.map((a) => a.after_data.format).sort()).toEqual(['csv', 'json'])
  })
})

describe('integrity check', () => {
  it('reports an intact chain, and finds a record changed behind the application\'s back', async () => {
    actAs(fx.admin)
    const ok = await verifyLogIntegrity()
    expect(ok).toMatchObject({ ok: true })
    expect(ok.checked).toBeGreaterThan(0)
    const victim = Number(psql("select id from system_log where row_hash is not null order by id desc limit 1 offset 2"))
    const original = psql(`select coalesce(message,'') from system_log where id = ${victim}`)
    psql('alter table system_log disable trigger trg_system_log_guard')
    try {
      psql(`update system_log set message = 'tampered' where id = ${victim}`)
      const bad = await verifyLogIntegrity()
      expect(bad).toMatchObject({ ok: false, brokenId: victim })
      psql(`update system_log set message = '${original.replace(/'/g, "''")}' ${original === '' ? ', message = NULL' : ''} where id = ${victim}`)
    } finally {
      psql('alter table system_log enable trigger trg_system_log_guard')
    }
    expect((await verifyLogIntegrity()).ok).toBe(true)
  })
})
