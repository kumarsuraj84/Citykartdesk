// E-06 on the isolated audit stack: the Intake inbox view (migration 195). It behaves like the tables underneath (own organisation, staff only), returns only a short
// preview of the body, and the folder conditions in lib/intake/inbox-filters.ts select the right rows. A user session is used for the reads.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, createTestUser, type D03Fixtures } from '../setup/fixtures-d03'
import { applyInboxFolder, applyInboxSort, INBOX_FOLDER_KEYS } from '@/lib/intake/inbox-filters'

vi.mock('server-only', () => ({}))
vi.setConfig({ testTimeout: 120_000 })

let fx: D03Fixtures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => getAdmin() as any
const tag = `t54${String(Date.now()).slice(-6)}`
let channelId = ''
const messageIds: string[] = []
let orgB = ''
let staffB: { id: string; accessToken: string } | null = null

async function mail(over: Record<string, unknown>, review?: Record<string, unknown>) {
  const m = (await admin().from('intake_messages').insert({
    org_id: fx.orgId, channel_id: channelId, from_address: 'someone@shop.test', received_at: new Date().toISOString(),
    body_text: 'x'.repeat(5000), ...over,
    subject: `${tag} ${String(over.subject ?? 'mail')}`,   // after the spread, so the tag is not overwritten by the plain subject
  }).select('id').single()).data.id as string
  messageIds.push(m)
  if (review) await admin().from('intake_reviews').insert({ org_id: fx.orgId, message_id: m, ...review })
  return m
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  channelId = (await admin().from('intake_channels').insert({ org_id: fx.orgId, type: 'email', name: `${tag} box`, provider: 'imap', status: 'active' }).select('id').single()).data.id
  await mail({ subject: 'urgent one' }, { suggested_type: 'request', suggested_priority: 'urgent', suggested_confidence: 90 })
  await mail({ subject: 'starred one' }, { suggested_type: 'task', suggested_priority: 'low', is_starred: true })
  await mail({ subject: 'info one' }, { suggested_type: 'informational' })
  await mail({ subject: 'archived one', is_archived: true }, { suggested_type: 'request' })
  await mail({ subject: 'unclassified one' })
  // a technician of ANOTHER organisation
  orgB = (await admin().from('organizations').insert({ name: `${tag} Org B`, slug: `${tag}-b`, status: 'active', seat_limit: 5 }).select('id').single()).data.id
  staffB = await createTestUser('p54-staffb', 'P54 Staff B')
  await admin().from('profiles').update({ org_id: orgB, role: 'agent' }).eq('id', staffB.id)
}, 180_000)
afterAll(async () => {
  if (messageIds.length) await admin().from('intake_messages').delete().in('id', messageIds)
  if (channelId) await admin().from('intake_channels').delete().eq('id', channelId)
  if (staffB) { try { await admin().auth.admin.deleteUser(staffB.id) } catch { /* best effort */ } }
  if (orgB) await admin().rpc('owner_delete_org', { p_org_id: orgB })
  await fx?.cleanup()
}, 120_000)

const read = (token: string, folder: (typeof INBOX_FOLDER_KEYS)[number]) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (clientForToken(token) as any).from('intake_inbox_v').select('id, subject, snippet, priority_score').like('subject', `${tag}%`)
  q = applyInboxFolder(q, folder)
  return applyInboxSort(q, 'priority_smart')
}
const subjects = async (token: string, folder: (typeof INBOX_FOLDER_KEYS)[number]) => {
  const res = await read(token, folder)
  // a failed read must show its reason, not look like "no mail"
  if (res.error) throw new Error(`inbox view read failed: ${res.error.code} ${res.error.message}`)
  return (res.data ?? []).map((r: { subject: string }) => r.subject.replace(`${tag} `, '')).sort()
}

describe('the view', () => {
  it('staff see their organisation\'s mail, a requester sees nothing', async () => {
    expect((await subjects(fx.agentA.accessToken, 'all')).length).toBeGreaterThan(0)
    expect(await subjects(fx.requesterA.accessToken, 'all')).toEqual([])
  })

  it('another organisation\'s staff do not see this mail', async () => {
    expect(await subjects(staffB!.accessToken, 'all')).toEqual([])
  })

  it('returns a preview of at most 160 characters, never the whole body', async () => {
    const rows = (await read(fx.agentA.accessToken, 'all')).data as { snippet: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.snippet.length).toBeLessThanOrEqual(160)
  })

  it('folders select the right mail', async () => {
    const t = fx.agentA.accessToken
    expect(await subjects(t, 'all')).toEqual(['info one', 'starred one', 'unclassified one', 'urgent one'])   // not the archived one
    expect(await subjects(t, 'urgent')).toEqual(['urgent one'])
    expect(await subjects(t, 'starred')).toEqual(['starred one'])
    expect(await subjects(t, 'request')).toEqual(['urgent one'])
    expect(await subjects(t, 'rest')).toEqual(['archived one', 'info one', 'unclassified one'])
  })

  it('the smart order puts urgent above low priority', async () => {
    const rows = (await read(fx.agentA.accessToken, 'all')).data as { subject: string }[]
    const order = rows.map((r) => r.subject.replace(`${tag} `, ''))
    expect(order.indexOf('urgent one')).toBeLessThan(order.indexOf('starred one'))
  })
})
