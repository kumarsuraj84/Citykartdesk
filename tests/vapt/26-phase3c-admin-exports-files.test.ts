// Phase 3C: admin writes across organisations, page guards, exports, uploads, health route.
// VAPT-048 cross-organisation identifiers, 049 page-level role checks, 051 exports audited and limited, 065 uploads, 066 health route.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, clientForToken, getAdmin, createTestUser, type D03Fixtures } from '../setup/fixtures-d03'
import { http } from '../remediation/helpers'

process.env.SYSTEM_LOG_IN_TESTS = '1'   // the System Log is written during this test (it is off in tests otherwise)
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))

import { createClient } from '@/lib/supabase/server'
import { upsertFieldSlaOverride } from '@/lib/actions/admin/sla-matrix'
import { createDepartment, updateDepartment } from '@/lib/actions/admin/org'
import { addTeamMember } from '@/lib/actions/admin/teams'
import { exportFixedReportXlsx } from '@/lib/actions/fixedReportExport'
import { exportReportXlsx } from '@/lib/actions/reportExport'
import { bulkExportRequests } from '@/lib/actions/requests'
import { exportEventsCsv } from '@/lib/actions/admin/events'
import { sharedRateLimited } from '@/lib/security/shared-limits'
import { EXPORT_LIMIT_MESSAGE } from '@/lib/security/export-guard'
import { validateAttachmentServer } from '@/lib/attachments/validate-server'
import { uploadAllowed } from '@/lib/attachments/quota'
import { flushSystemLog } from '@/lib/syslog/record'
import { GET as healthGet } from '@/app/api/health/route'
import AdminTeamsPage from '@/app/(app)/admin/teams/page'
import KnowledgeBasePage from '@/app/(app)/admin/knowledge-base/page'

vi.setConfig({ testTimeout: 180_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql], { encoding: 'utf8' }).trim()
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const tag = `p26-${Date.now()}`
const created = { orgs: [] as string[], users: [] as string[], depts: [] as string[] }
let orgB = '', deptB = '', serviceB = '', userB: { id: string; email: string; accessToken: string }

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const org = await admin().from('organizations').insert({ name: `${tag} Org B`, slug: `${tag}-b`, status: 'active', seat_limit: 5 } as never).select('id').single()
  orgB = org.data!.id; created.orgs.push(orgB)
  deptB = (await admin().from('departments').insert({ name: `${tag} dept B`, org_id: orgB } as never).select('id').single()).data!.id
  const teamB = (await admin().from('teams').insert({ name: `${tag} team B`, slug: `${tag}-tb`, prefix: 'PB26', department_id: deptB, org_id: orgB }).select('id').single()).data!.id
  serviceB = (await admin().from('services').insert({ name: `${tag} service B`, slug: `${tag}-sb`, team_id: teamB, org_id: orgB, form_fields: [], form_sections: [] }).select('id').single()).data!.id
  userB = await createTestUser('p26-userb', 'P26 User In Org B'); created.users.push(userB.id)
  await admin().from('profiles').update({ org_id: orgB }).eq('id', userB.id)
}, 240_000)

afterAll(async () => {
  psql(`delete from rate_limit_counters where key like '%${tag}%' or key like 'export:%' or key like 'upload:%' or key like 'upload-day:%'`)
  for (const id of created.depts) await admin().from('departments').delete().eq('id', id)
  for (const id of created.users) { try { await admin().auth.admin.deleteUser(id) } catch { /* best effort */ } }
  for (const id of created.orgs) await admin().rpc('owner_delete_org', { p_org_id: id })
  await fx?.cleanup()
}, 120_000)

describe('VAPT-048: an administrator of one organisation cannot point a write at another organisation\'s ids', () => {
  it('Field SLA matrix: another organisation\'s service is refused by the action, and by the database function even for the server\'s own key', async () => {
    actAs(fx.admin)
    const input = { serviceId: serviceB, fieldId: 'f', fieldLabel: 'F', optionValue: 'o', optionLabel: 'O', priority: 'high' as const, responseHours: 1, resolutionHours: 4 }
    expect((await upsertFieldSlaOverride(input)).error).toMatch(/not found in your organisation/i)
    const direct = await admin().rpc('upsert_field_sla_override', { p_org_id: fx.orgId, p_service_id: serviceB, p_field_id: 'f', p_field_label: 'F', p_option_value: 'o', p_option_label: 'O', p_priority: 'high', p_response_hours: 1, p_resolution_hours: 4, p_updated_by: fx.admin.id })
    expect(direct.error?.message).toMatch(/does not belong/i)
    // a signed-in user cannot call the function at all
    expect((await http('POST', '/rest/v1/rpc/upsert_field_sla_override', { token: fx.admin.accessToken, body: { p_org_id: fx.orgId, p_service_id: serviceB, p_field_id: 'f', p_field_label: 'F', p_option_value: 'o', p_option_label: 'O', p_priority: 'high', p_response_hours: 1, p_resolution_hours: 4, p_updated_by: fx.admin.id } })).status).toBeGreaterThanOrEqual(400)
    expect((await admin().from('field_sla_overrides').select('id').eq('service_id', serviceB)).data).toHaveLength(0)
  })
  it('Departments: a parent or head from another organisation is refused; the organisation\'s own are fine', async () => {
    actAs(fx.admin)
    expect((await createDepartment({ name: `${tag} child`, parent_id: deptB })).error).toMatch(/not found in your organisation/i)
    expect((await createDepartment({ name: `${tag} headed`, head_user_id: userB.id })).error).toMatch(/not found in your organisation/i)
    const own = await createDepartment({ name: `${tag} own`, head_user_id: fx.agentA.id })
    expect(own.error).toBeUndefined(); if (own.data?.id) created.depts.push(own.data.id)
    expect((await updateDepartment(own.data!.id, { parent_id: deptB })).error).toMatch(/not found in your organisation/i)
    expect((await admin().from('departments').select('parent_id').eq('id', own.data!.id).single()).data?.parent_id).toBeNull()
  })
  it('Technician groups: a person from another organisation cannot be added', async () => {
    actAs(fx.admin)
    expect((await addTeamMember(fx.teamA.id, userB.id)).error).toMatch(/not found in your organisation/i)
    expect((await admin().from('team_members').select('user_id').eq('user_id', userB.id)).data).toHaveLength(0)
  })
})

describe('VAPT-049: the pages check the role themselves', () => {
  it('a requester and a technician are sent home from the Teams and Knowledge Base admin pages; a manager is not', async () => {
    for (const who of [fx.requesterA, fx.agentA]) {
      actAs(who)
      await expect(AdminTeamsPage()).rejects.toThrow('REDIRECT:/home')
      await expect(KnowledgeBasePage()).rejects.toThrow('REDIRECT:/home')
    }
    actAs(fx.manager)
    await expect(AdminTeamsPage()).resolves.toBeTruthy()
    await expect(KnowledgeBasePage()).resolves.toBeTruthy()
  })
})

describe('VAPT-051: exports are limited and audited', () => {
  const since = new Date(Date.now() - 5000).toISOString()
  async function auditRows(action: string) {
    await new Promise((r) => setTimeout(r, 300)); await flushSystemLog()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((await (admin() as any).from('system_log').select('actor_id, after_data, message').eq('action', action).gte('created_at', since)).data ?? []) as { actor_id: string; after_data: { rows?: number | null; filters?: unknown }; message: string }[]
  }
  it('a fixed report export writes an audit entry (who, which report, how many rows) and no contents', async () => {
    actAs(fx.admin)
    const res = await exportFixedReportXlsx('admin-summary-report')
    expect(res.error).toBeUndefined()
    expect(res.data).toBeTruthy()
    const rows = (await auditRows('data.exported.fixed_report')).filter((r) => r.actor_id === fx.admin.id)
    expect(rows.length).toBeGreaterThan(0)
    expect(typeof rows[0].after_data.rows).toBe('number')
    expect(JSON.stringify(rows[0])).not.toMatch(/ticket|CKSD-/i)            // counts and filters only
  })
  it('the ticket CSV export from the list and the event log export are audited too', async () => {
    actAs(fx.admin)
    const ids = (await admin().from('requests').select('id').limit(3)).data!.map((r) => r.id)
    expect((await bulkExportRequests(ids)).csv).toBeTruthy()
    expect((await auditRows('data.exported.bulk_requests')).filter((r) => r.actor_id === fx.admin.id).length).toBeGreaterThan(0)
    await exportEventsCsv({} as never)
    expect((await auditRows('data.exported.event_log')).filter((r) => r.actor_id === fx.admin.id).length).toBeGreaterThan(0)
  })
  it('after the hourly allowance is used up, a person is told to wait (counted in the database)', async () => {
    actAs(fx.admin)
    const k = `export:fixed_report:${fx.admin.id}`
    for (let i = 0; i < 31; i++) await sharedRateLimited(k, 30, 3600)
    expect((await exportFixedReportXlsx('admin-summary-report')).error).toBe(EXPORT_LIMIT_MESSAGE)
    psql(`delete from rate_limit_counters where key = '${k}'`)
    expect((await exportFixedReportXlsx('admin-summary-report')).error).toBeUndefined()
  })
  it('Report Builder refuses a malformed configuration before doing any work', async () => {
    actAs(fx.admin)
    for (const bad of [{ mode: 'sql', columns: [], pivot: {} }, { mode: 'table', columns: [1, 2], pivot: {} }, { mode: 'table', columns: Array(200).fill('x'), pivot: {} }]) {
      const r = await exportReportXlsx('requests' as never, bad as never)
      expect(r.error, JSON.stringify(bad).slice(0, 40)).toBeTruthy()
    }
  })
})

describe('VAPT-065: uploads', () => {
  const file = (bytes: Buffer, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type })
  const ole = (extra: Buffer) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512), extra])
  const zip = (name: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(name), Buffer.alloc(40)])
  it('a workbook with a macro project is refused; an ordinary one is accepted', async () => {
    const macro = await validateAttachmentServer(file(ole(Buffer.from('_VBA_PROJECT', 'utf16le')), 'a.xls', 'application/vnd.ms-excel'))
    expect(macro).toMatchObject({ valid: false, code: 'macro' })
    const macroX = await validateAttachmentServer(file(zip('xl/vbaProject.bin'), 'a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
    expect(macroX).toMatchObject({ valid: false, code: 'macro' })
    const clean = await validateAttachmentServer(file(zip('xl/worksheets/sheet1.xml'), 'b.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
    expect(clean.valid).toBe(true)
  })
  it('with a scanner configured but not reachable, the upload is refused, and says so', async () => {
    process.env.ATTACHMENT_SCANNER = 'clamd'; process.env.ATTACHMENT_SCANNER_HOST = '127.0.0.1'; process.env.ATTACHMENT_SCANNER_PORT = '9'
    try {
      expect(await validateAttachmentServer(file(Buffer.from('hello'), 'a.txt', 'text/plain'))).toMatchObject({ valid: false, code: 'scan_unavailable' })
    } finally { delete process.env.ATTACHMENT_SCANNER; delete process.env.ATTACHMENT_SCANNER_HOST; delete process.env.ATTACHMENT_SCANNER_PORT }
    expect((await validateAttachmentServer(file(Buffer.from('hello'), 'a.txt', 'text/plain'))).valid).toBe(true)
  })
  it('one person cannot upload without limit: after the burst allowance the action says wait', async () => {
    const k = `upload:${userB.id}`
    expect(await uploadAllowed(userB.id)).toBe(true)
    for (let i = 0; i < 60; i++) await sharedRateLimited(k, 60, 600)
    expect(await uploadAllowed(userB.id)).toBe(false)
    psql(`delete from rate_limit_counters where key in ('${k}', 'upload-day:${userB.id}')`)
    expect(await uploadAllowed(userB.id)).toBe(true)
  })
})

describe('VAPT-066: the public health route', () => {
  it('answers from a short shared cache, so repeated calls do not each query the database', async () => {
    const first = await healthGet()
    const second = await healthGet()
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await second.json()).cached).toBe(true)
    expect(second.headers.get('cache-control')).toBe('no-store')
  })
})
