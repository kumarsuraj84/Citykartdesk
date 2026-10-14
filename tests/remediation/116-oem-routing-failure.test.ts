// D-045: automatic routing of a ticket to the OEM must not say "Ticket sent to ..." or move the ticket on when the e-mail did not go.
// Also checks that migration 162's one-ticket-per-message index exists on this database.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
const send = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/send', () => ({ sendEmail: send }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { runOemAutoRouting } from '@/lib/requests/create-request-core'

vi.setConfig({ testTimeout: 90_000 })
const db = getAdmin()
let fx: D03Fixtures
let oemId: string
const created: string[] = []

async function ticket() {
  const r = await db.from('requests').insert({ request_no: '', title: `oem test ${created.length}`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, org_id: fx.orgId, priority: 'low', status: 'open' }).select('id, request_no').single()
  if (r.error) throw new Error(r.error.message)
  created.push(r.data!.id)
  return r.data!
}
const route = (t: { id: string; request_no: string }) => runOemAutoRouting({
  admin: db, actorId: fx.agentA.id, orgId: fx.orgId, request: t, autoOemRouting: true, storeOemId: oemId,
  title: 'AC not cooling', description: 'x', requesterName: 'R', requesterEmail: 'r@audit.test', requesterPhone: '', storeAddress: null,
})
const comments = async (id: string) => (await db.from('request_comments').select('body, is_internal').eq('request_id', id)).data ?? []
const statusOf = async (id: string) => (await db.from('requests').select('status').eq('id', id).single()).data!.status

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const o = await db.from('oems').insert({ org_id: fx.orgId, name: 'Audit OEM', emails: ['oem@audit.test'], is_active: true }).select('id').single()
  if (o.error) throw new Error(o.error.message)
  oemId = o.data!.id
}, 120_000)
afterAll(async () => {
  if (created.length) { await db.from('request_activity').delete().in('request_id', created); await db.from('request_comments').delete().in('request_id', created); await db.from('requests').delete().in('id', created) }
  if (oemId) await db.from('oems').delete().eq('id', oemId)
  await fx?.cleanup()
}, 120_000)

describe('OEM auto-routing (D-045)', () => {
  it('when the e-mail fails, nothing claims it was sent, the ticket stays open, and a technician is told in an internal note', async () => {
    send.mockResolvedValue({ error: 'SMTP is down' })
    const t = await ticket()
    await route(t)
    const c = await comments(t.id)
    expect(c.some((x) => /Ticket sent to/.test(x.body))).toBe(false)
    expect(c.filter((x) => x.is_internal && /could not be sent/i.test(x.body))).toHaveLength(1)
    expect(await statusOf(t.id)).toBe('open')
  })
  it('when the e-mail goes, the requester is told and the ticket moves on', async () => {
    send.mockResolvedValue({})
    const t = await ticket()
    await route(t)
    expect((await comments(t.id)).some((x) => !x.is_internal && /Ticket sent to Audit OEM/.test(x.body))).toBe(true)
    expect(await statusOf(t.id)).toBe('in_progress')
  })
})

describe('one ticket per e-mail (D-045, migration 162)', () => {
  it('the unique index exists on this database', () => {
    const def = execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', "select indexdef from pg_indexes where indexname = 'requests_one_per_intake_message'"], { encoding: 'utf8' })
    expect(def).toMatch(/CREATE UNIQUE INDEX requests_one_per_intake_message ON public\.requests .*intake_message_id/)
  })
})
