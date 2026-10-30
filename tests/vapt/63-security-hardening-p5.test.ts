// Migration 192 (security hardening, P5) on the isolated audit stack. NOT part of the default run: tests/vapt runs only through the audit-only config.
//  D-01  a manager can no longer write the form field library through the data API (an administrator still can)
//  D-15  error_reports: a signed-in person can only report as themselves, for their own organisation, with the default status
//  A-17  csat_surveys: a signed-in person cannot update org_id / request_id / requester_id any more
//  D-09  request_automation_state, program_pms_dates, program_pms_log: not readable by signed-in users
//  D-21  the storage buckets no longer accept the types the application refuses
//  D-27  system_log_archive_old refuses silly values;  A-05 revoke_user_sessions and A-07 quota_add are for the server's key only
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => getAdmin() as any
const tag = `t63${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const madeFields: string[] = []
const madeReports: string[] = []

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => {
  if (madeFields.length) await svc().from('form_field_library').delete().in('id', madeFields)
  if (madeReports.length) await svc().from('error_reports').delete().in('id', madeReports)
  await fx?.cleanup()
}, 90_000)

describe('D-01: configuration tables are administrator-only through the data API', () => {
  it('a manager cannot add a library field; an administrator can', async () => {
    const asManager = clientForToken(fx.manager.accessToken)
    const denied = await asManager.from('form_field_library').insert({ org_id: fx.orgId, label: `${tag}-m`, type: 'text' }).select('id')
    expect(denied.error ?? (denied.data?.length === 0 ? 'no rows' : null)).toBeTruthy()
    const asAdmin = clientForToken(fx.admin.accessToken)
    const ok = await asAdmin.from('form_field_library').insert({ org_id: fx.orgId, label: `${tag}-a`, type: 'text' }).select('id').single()
    expect(ok.error).toBeNull()
    madeFields.push(ok.data!.id)
  })
})

describe('D-15: error_reports insert', () => {
  const report = (over: Record<string, unknown>) => ({ app: 'citykart-desk', error_type: 'error', message: `${tag} message`, org_id: fx.orgId, user_id: fx.requesterA.id, ...over })
  it('accepts a report made as oneself, for one\'s own organisation', async () => {
    const { error } = await clientForToken(fx.requesterA.accessToken).from('error_reports').insert(report({}))
    expect(error).toBeNull()
    const { data } = await svc().from('error_reports').select('id').eq('message', `${tag} message`)
    for (const r of data ?? []) madeReports.push(r.id)
  })
  it('refuses a report made in someone else\'s name, for another organisation, with another status or an owner note', async () => {
    const c = clientForToken(fx.requesterA.accessToken)
    expect((await c.from('error_reports').insert(report({ user_id: fx.requesterB.id }))).error).toBeTruthy()
    expect((await c.from('error_reports').insert(report({ org_id: '00000000-0000-0000-0000-00000000dead' }))).error).toBeTruthy()
    expect((await c.from('error_reports').insert(report({ status: 'resolved' }))).error).toBeTruthy()
    expect((await c.from('error_reports').insert(report({ owner_note: 'fixed' }))).error).toBeTruthy()
  })
})

describe('A-17: csat_surveys columns', () => {
  it('a signed-in person cannot update org_id, request_id or requester_id (permission denied), whatever rows exist', async () => {
    const c = clientForToken(fx.requesterA.accessToken)
    for (const col of ['org_id', 'request_id', 'requester_id']) {
      const { error } = await c.from('csat_surveys').update({ [col]: '00000000-0000-0000-0000-000000000000' } as never).eq('id', '00000000-0000-0000-0000-000000000000')
      expect(error?.code, col).toBe('42501')
    }
  })
  it('rating, comment and submitted_at remain updatable (the column grant, not a blanket revoke)', async () => {
    const { error } = await clientForToken(fx.requesterA.accessToken).from('csat_surveys').update({ rating: 5, comment: null, submitted_at: new Date().toISOString() }).eq('id', '00000000-0000-0000-0000-000000000000')
    expect(error).toBeNull()                 // no row matches, but the privilege check passed
  })
})

describe('D-09: server-only tables', () => {
  it('signed-in users cannot read them', async () => {
    const c = clientForToken(fx.admin.accessToken)
    for (const t of ['request_automation_state', 'program_pms_dates', 'program_pms_log']) {
      const { error } = await c.from(t as never).select('*').limit(1)
      expect(error?.code, t).toBe('42501')
    }
  })
})

describe('D-21: storage bucket types', () => {
  it('the application\'s refused types are gone from the buckets', async () => {
    const req = await svc().storage.getBucket('request-attachments')
    expect(req.data?.allowed_mime_types).not.toContain('image/svg+xml')
    expect(req.data?.allowed_mime_types).toContain('application/pdf')
    const intake = await svc().storage.getBucket('intake-attachments')
    expect(intake.data?.allowed_mime_types).not.toContain('application/octet-stream')
    expect(intake.data?.allowed_mime_types).toContain('application/pdf')
  })
})

describe('D-27 / A-05 / A-07: functions', () => {
  it('system_log_archive_old refuses 0 / negative days and years', async () => {
    for (const args of [{ p_error_days: 0, p_audit_years: 7 }, { p_error_days: -5, p_audit_years: 7 }, { p_error_days: 180, p_audit_years: 0 }, { p_error_days: 29, p_audit_years: 7 }]) {
      const { error } = await svc().rpc('system_log_archive_old', args)
      expect(error?.code, JSON.stringify(args)).toBe('22023')
    }
  })
  it('revoke_user_sessions and quota_add belong to the server\'s key only', async () => {
    const c = clientForToken(fx.admin.accessToken)
    expect((await c.rpc('revoke_user_sessions' as never, { p_user_id: fx.requesterA.id } as never)).error?.code).toBe('42501')
    expect((await c.rpc('quota_add' as never, { p_key: 'x', p_amount: 1, p_limit: 5, p_window_seconds: 60 } as never)).error?.code).toBe('42501')
  })
  it('quota_add adds an amount and reports when the total passes the limit', async () => {
    const key = `${tag}:quota`
    const first = await svc().rpc('quota_add', { p_key: key, p_amount: 400, p_limit: 500, p_window_seconds: 3600 })
    const second = await svc().rpc('quota_add', { p_key: key, p_amount: 200, p_limit: 500, p_window_seconds: 3600 })
    expect([first.data, second.data]).toEqual([false, true])
    await svc().from('rate_limit_counters').delete().eq('key', key)
  })
  it('revoke_user_sessions ends the sessions of one person only', async () => {
    const before = await clientForToken(fx.requesterB.accessToken).auth.getUser()
    expect(before.data.user?.id).toBe(fx.requesterB.id)
    const { data, error } = await svc().rpc('revoke_user_sessions', { p_user_id: fx.requesterA.id })
    expect(error).toBeNull()
    expect(data).toBeGreaterThanOrEqual(0)
    const other = await clientForToken(fx.requesterB.accessToken).auth.getUser()
    expect(other.data.user?.id).toBe(fx.requesterB.id)      // somebody else is untouched
  })
})
