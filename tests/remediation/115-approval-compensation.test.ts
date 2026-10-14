// D-045: sending a ticket for approval is several writes (workflow, steps, approval, ticket status). When the last one fails, what was already
// written is taken back, so the ticket is not left blocked by "an approval is already pending" that nobody can decide.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setupD03Fixtures, seedRequestLike, getAdmin, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { sendAdHocApproval } from '@/lib/actions/approvals'

vi.setConfig({ testTimeout: 120_000 })

const psql = (sql: string) => execFileSync('docker', ['exec', 'supabase_db_ckdesk_audit', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim()
let fx: D03Fixtures
const db = getAdmin()

beforeAll(async () => { fx = await setupD03Fixtures(); vi.mocked(createClient).mockResolvedValue(clientForToken(fx.agentA.accessToken) as never) }, 120_000)
afterAll(async () => { psql('alter table requests drop constraint if exists tmp_no_pending_approval'); await fx?.cleanup() }, 120_000)

describe('sending for approval takes back what it wrote when the last step fails (D-045)', () => {
  it('no approval or workflow is left behind, the ticket is unchanged, and sending works once the fault is gone', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    const before = (await db.from('approval_workflows').select('id', { count: 'exact', head: true }).like('name', 'Ad-hoc:%')).count ?? 0
    psql("alter table requests add constraint tmp_no_pending_approval check (status <> 'pending_approval') not valid")
    try {
      const r = await sendAdHocApproval(t.id, [fx.manager.id])
      expect(r.error).toBeTruthy()
    } finally { psql('alter table requests drop constraint if exists tmp_no_pending_approval') }

    expect((await db.from('approvals').select('id').eq('request_id', t.id)).data ?? []).toHaveLength(0)
    expect((await db.from('approval_workflows').select('id', { count: 'exact', head: true }).like('name', 'Ad-hoc:%')).count ?? 0).toBe(before)
    expect((await db.from('requests').select('status').eq('id', t.id).single()).data?.status).toBe('in_progress')

    expect((await sendAdHocApproval(t.id, [fx.manager.id])).error).toBeUndefined()   // not blocked by a leftover pending approval
    expect((await db.from('requests').select('status').eq('id', t.id).single()).data?.status).toBe('pending_approval')
  })
})
