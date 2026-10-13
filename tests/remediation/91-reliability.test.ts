// Reliability simulations on the disposable audit stack: files (duplicate names, interrupted upload, storage unavailable, unauthorized reader),
// the API layer being down and coming back, the mail provider failing, two overlapping scheduled-job runs, and concurrent assignment.
// Every outage is created by stopping a container of the AUDIT stack (never any other) and is always undone, even when an assertion fails.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures, type TestUser } from '../setup/fixtures-d03'
import { API, SERVICE } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { uploadAttachment } from '@/lib/actions/attachments'
import { updateRequestStatus, assignRequest } from '@/lib/actions/requests'

const mockedCreateClient = vi.mocked(createClient)
const actAs = (u: TestUser) => mockedCreateClient.mockResolvedValue(clientForToken(u.accessToken) as never)
const docker = (...a: string[]) => execFileSync('docker', a, { encoding: 'utf8' }).trim()
const psql = (sql: string) => docker('exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql)
const STORAGE = 'supabase_storage_ckdesk_audit'
const REST = 'supabase_rest_ckdesk_audit'

// a real 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const png = (name: string) => { const fd = new FormData(); fd.append('file', new File([PNG], name, { type: 'image/png' })); return fd }

async function waitFor(url: string, headers: Record<string, string>, ms = 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { headers }); if (r.status < 500) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`${url} did not come back`)
}
const storageUp = () => waitFor(`${API}/storage/v1/bucket`, { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` })
const restUp = () => waitFor(`${API}/rest/v1/`, { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` })

describe('reliability simulations', () => {
  let fx: D03Fixtures
  const db = getAdmin()
  beforeAll(async () => { fx = await setupD03Fixtures() }, 120_000)
  afterAll(async () => {
    for (const c of [STORAGE, REST]) { try { docker('start', c) } catch { /* already running */ } }
    await storageUp(); await restUp()
    psql("alter table request_attachments drop constraint if exists tmp_reliability_fail")
    await fx?.cleanup()
  }, 180_000)

  const ticket = () => seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
  const objectsOf = async (requestId: string) => (await db.storage.from('request-attachments').list(requestId)).data ?? []
  const rowsOf = async (requestId: string) => (await db.from('request_attachments').select('id, storage_path, file_name').eq('request_id', requestId)).data ?? []

  it('duplicate file names are kept as separate files with separate storage keys', async () => {
    const t = await ticket()
    actAs(fx.requesterA)
    const a = await uploadAttachment(t.id, png('photo.png'))
    const b = await uploadAttachment(t.id, png('photo.png'))
    expect(a.error).toBeUndefined(); expect(b.error).toBeUndefined()
    const rows = await rowsOf(t.id)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.storage_path)).size).toBe(2)
    expect((await objectsOf(t.id)).length).toBe(2)
    // both really downloadable
    for (const r of rows) {
      const dl = await db.storage.from('request-attachments').download(r.storage_path)
      expect(dl.error).toBeNull()
      expect(Buffer.from(await dl.data!.arrayBuffer()).equals(PNG)).toBe(true)
    }
  })

  it('an upload whose database record fails leaves no orphan file behind', async () => {
    const t = await ticket()
    psql('alter table request_attachments add constraint tmp_reliability_fail check (false) not valid')
    try {
      actAs(fx.requesterA)
      const r = await uploadAttachment(t.id, png('doomed.png'))
      expect(r.error).toBeTruthy()
    } finally {
      psql('alter table request_attachments drop constraint if exists tmp_reliability_fail')
    }
    expect(await rowsOf(t.id)).toHaveLength(0)
    expect(await objectsOf(t.id)).toHaveLength(0) // the stored object was removed again
  })

  it('storage unavailable: the upload fails cleanly (no record, no crash), and works again once storage is back', async () => {
    const t = await ticket()
    docker('stop', STORAGE)
    try {
      actAs(fx.requesterA)
      const r = await uploadAttachment(t.id, png('during-outage.png'))
      expect(r.error).toBeTruthy()
      expect(await rowsOf(t.id)).toHaveLength(0)
    } finally {
      docker('start', STORAGE)
      await storageUp()
    }
    const after = await uploadAttachment(t.id, png('after-outage.png'))
    expect(after.error).toBeUndefined()
    expect(await rowsOf(t.id)).toHaveLength(1)
  }, 180_000)

  it('a user who is not on the ticket cannot attach to it, and the file is never stored', async () => {
    const t = await ticket()
    actAs(fx.requesterB)
    const r = await uploadAttachment(t.id, png('intruder.png'))
    expect(r.error).toBeTruthy()
    expect(await rowsOf(t.id)).toHaveLength(0)
    expect(await objectsOf(t.id)).toHaveLength(0)
  })

  it('files that are not what they claim to be, or too large, or empty are refused', async () => {
    const t = await ticket()
    actAs(fx.requesterA)
    const fake = new FormData(); fake.append('file', new File([Buffer.from('<html><script>alert(1)</script></html>')], 'evil.png', { type: 'image/png' }))
    expect((await uploadAttachment(t.id, fake)).error).toBeTruthy()
    const empty = new FormData(); empty.append('file', new File([], 'empty.png', { type: 'image/png' }))
    expect((await uploadAttachment(t.id, empty)).error).toBeTruthy()
    const svg = new FormData(); svg.append('file', new File([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')], 'x.svg', { type: 'image/svg+xml' }))
    expect((await uploadAttachment(t.id, svg)).error).toBeTruthy()
    expect(await rowsOf(t.id)).toHaveLength(0)
  })

  it('API layer down: actions fail without crashing or changing anything, and everything works after it is back', async () => {
    const t = await ticket()
    docker('stop', REST)
    try {
      actAs(fx.agentA)
      // With the API layer down the action either returns an error or throws (the app's error screen takes over); it must never report success.
      // (It takes minutes to give up: the 20 s client timeout is retried on every call. Recorded as a finding in the remediation reports.)
      const outcome = await updateRequestStatus(t.id, 'waiting_user', 'Please confirm.').then((r) => ({ error: r.error }), (e: unknown) => ({ error: `thrown: ${String(e)}` }))
      expect(outcome.error).toBeTruthy()
    } finally {
      docker('start', REST)
      await restUp()
    }
    expect((await db.from('requests').select('status').eq('id', t.id).single()).data?.status).toBe('in_progress')
    actAs(fx.agentA)
    expect((await updateRequestStatus(t.id, 'waiting_user', 'Please confirm.')).error).toBeUndefined()
  }, 480_000)

  it('mail provider failing does not stop the status change', async () => {
    const t = await ticket()
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('SMTP provider unreachable')).mockRejectedValue(new Error('SMTP provider unreachable'))
    actAs(fx.agentA)
    const r = await updateRequestStatus(t.id, 'waiting_user', 'Please send the serial number.')
    expect(r.error).toBeUndefined()
    expect((await db.from('requests').select('status').eq('id', t.id).single()).data?.status).toBe('waiting_user')
    vi.mocked(sendEmail).mockReset(); vi.mocked(sendEmail).mockResolvedValue({} as never)
  })

  it('concurrent assignment by a technician and a manager leaves one valid owner and a consistent history', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    // each call needs its own acting user; mockResolvedValue is global, so run them one after the other from different sessions at the same instant
    const asAgent = async () => { actAs(fx.agentA); return assignRequest(t.id, fx.agentA.id) }
    const asManager = async () => { actAs(fx.manager); return assignRequest(t.id, fx.agentA.id) }
    const results = await Promise.all([asAgent(), asManager()])
    expect(results.some((r) => !r.error)).toBe(true)
    const row = (await db.from('requests').select('assigned_to, status').eq('id', t.id).single()).data!
    expect(row.assigned_to).toBe(fx.agentA.id)
    expect(row.status).toBe('assigned')
  })

  it('two overlapping runs of the scheduled business-rules job fire a rule once per ticket', async () => {
    const tag = `d42-${Date.now()}`
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const t = await db.from('requests').insert({ request_no: '', title: `${tag} ${i}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, status: 'open', priority: 'low', org_id: fx.orgId }).select('id').single()
      ids.push(t.data!.id)
    }
    const ins = await db.from('business_rules').insert({
      org_id: fx.orgId, name: `overlap ${tag}`, is_active: true, trigger: ['schedule'], schedule_check: 'unassigned_minutes', schedule_threshold: 0,
      conditions: [{ field: 'title', operator: 'contains', value: tag }], conditions_logic: 'AND', actions: [{ type: 'set_priority', params: { priority: 'urgent' } }], execution_order: 999,
    }).select('id').single()
    if (ins.error) throw new Error('rule insert: ' + ins.error.message)
    const rule = ins.data!.id
    try {
      const { GET } = await import('@/app/api/business-rules/run/route')
      const call = () => GET(new NextRequest('http://localhost/api/business-rules/run', { headers: { 'x-cron-secret': process.env.CRON_SECRET! } }))
      const [a, b] = await Promise.all([call(), call()])
      expect([a.status, b.status]).toEqual([200, 200])
      const events = (await db.from('business_rule_events').select('request_id').eq('rule_id', rule)).data ?? []
      expect(events).toHaveLength(5)
      for (const id of ids) {
        const acts = (await db.from('request_activity').select('action').eq('request_id', id)).data ?? []
        expect(acts.filter((x) => x.action === 'priority_changed'), `ticket ${id}`).toHaveLength(1) // acted once, not twice
        expect((await db.from('requests').select('priority').eq('id', id).single()).data?.priority).toBe('urgent')
      }
    } finally {
      await db.from('business_rule_events').delete().eq('rule_id', rule)
      await db.from('business_rules').delete().eq('id', rule)
      await db.from('request_activity').delete().in('request_id', ids)
      await db.from('requests').delete().in('id', ids)
    }
  }, 240_000)
})
