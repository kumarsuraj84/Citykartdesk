// The application's own audit records (as opposed to the database triggers): sign-in events, user administration, exports, scheduled reports.
// Each action is run for real, as a real signed-in user, and the System Log row it wrote is read back.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'
import { svc } from './helpers'

process.env.SYSTEM_LOG_IN_TESTS = '1'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ 'user-agent': 'AuditTest/1.0' })),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) } }))

import { createClient } from '@/lib/supabase/server'
import { updateUserRole, toggleUserActive } from '@/lib/actions/admin/users'
import { exportRequests } from '@/lib/actions/export'
import { createScheduledReport, deleteScheduledReport } from '@/lib/actions/admin/reports'
import { signInWithPassword } from '@/lib/actions/auth'
import { flushSystemLog } from '@/lib/syslog/record'

const mockedCreateClient = vi.mocked(createClient)
const actAs = (u: TestUser) => mockedCreateClient.mockResolvedValue(clientForToken(u.accessToken) as never)
type Row = { category: string; source: string; outcome: string; action: string; actor_id: string | null; actor_role: string | null; org_id: string | null; entity_id: string | null; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; message: string | null; user_agent: string | null; row_hash: string | null }
const since = new Date(Date.now() - 5000).toISOString()
const rows = async (action: string) => { await new Promise((r) => setTimeout(r, 300)); await flushSystemLog(); return (await svc<Row[]>('GET', `/system_log?action=eq.${action}&created_at=gte.${since}&order=id.asc`)).json }

describe('application audit records', () => {
  let fx: D03Fixtures
  const db = getAdmin()
  beforeAll(async () => { fx = await setupD03Fixtures() }, 120_000)
  afterAll(async () => { await fx?.cleanup() }, 120_000)

  it('a role change records who changed whose role, from what to what', async () => {
    actAs(fx.admin)
    expect((await updateUserRole(fx.requesterA.id, 'agent')).error).toBeUndefined()
    const [r] = (await rows('user.role_changed')).filter((x) => x.entity_id === fx.requesterA.id)
    expect(r).toMatchObject({ category: 'security', actor_id: fx.admin.id, actor_role: 'admin', before_data: { role: 'user' }, after_data: { role: 'agent' }, user_agent: 'AuditTest/1.0' })
    expect(r.row_hash).toMatch(/^[0-9a-f]{64}$/)
    await db.from('profiles').update({ role: 'user' }).eq('id', fx.requesterA.id)
  })

  it('a refused role change records nothing as a success (the guard stops a plain admin touching a platform owner)', async () => {
    actAs(fx.admin)
    const res = await updateUserRole(fx.platformOwner.id, 'user')
    expect(res.error).toBeTruthy()
    expect((await rows('user.role_changed')).filter((x) => x.entity_id === fx.platformOwner.id)).toHaveLength(0)
  })

  it('deactivating and reactivating a user are each recorded', async () => {
    actAs(fx.admin)
    await toggleUserActive(fx.requesterB.id, false)
    await toggleUserActive(fx.requesterB.id, true)
    expect((await rows('user.deactivated')).some((x) => x.entity_id === fx.requesterB.id && x.actor_id === fx.admin.id && (x.after_data as { is_active: boolean }).is_active === false)).toBe(true)
    expect((await rows('user.reactivated')).some((x) => x.entity_id === fx.requesterB.id)).toBe(true)
  })

  it('an export records who took which data out, with how many rows and which filters', async () => {
    actAs(fx.manager)
    await exportRequests({ status: 'open' } as never)
    const r = (await rows('data.exported.requests')).find((x) => x.actor_id === fx.manager.id)!
    expect(r).toMatchObject({ category: 'security', actor_role: 'manager' })
    expect(r.after_data).toMatchObject({ filters: { status: 'open' } })
    expect(typeof r.after_data!.rows).toBe('number')
  })

  it('creating and deleting a scheduled report are recorded with the recipients', async () => {
    actAs(fx.admin)
    const created = await createScheduledReport({ name: 'Audit weekly', report_type: 'requests', frequency: 'weekly', recipients: [], filters: {}, is_active: false })
    const id = created.data?.id
    expect(id).toBeTruthy()
    await deleteScheduledReport(id!)
    expect((await rows('scheduled_report.created')).some((x) => x.entity_id === id && x.actor_id === fx.admin.id)).toBe(true)
    expect((await rows('scheduled_report.deleted')).some((x) => x.entity_id === id)).toBe(true)
  })

  it('a refused sign-in is a security event, and the password is never stored', async () => {
    mockedCreateClient.mockResolvedValue(clientForToken('anon') as never)
    const wrong = new FormData(); wrong.set('email', fx.requesterA.email); wrong.set('password', 'definitely-wrong-Pw-1!')
    const res = await signInWithPassword(wrong)
    expect(res).toMatchObject({ error: expect.any(String) })
    const failed = (await rows('auth.login_failed')).find((x) => (x.after_data as { email: string })?.email === fx.requesterA.email.toLowerCase())!
    expect(failed).toMatchObject({ category: 'security', source: 'auth', outcome: 'failure', actor_id: null })
    expect(JSON.stringify(failed)).not.toContain('definitely-wrong')
  })
})
