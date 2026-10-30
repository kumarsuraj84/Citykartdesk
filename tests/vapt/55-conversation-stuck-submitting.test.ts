// B-04 on the isolated audit stack: a WhatsApp conversation stuck in 'submitting' (the process died between the review -> submitting commit and the completion) is
// repaired by the next message: completed when its ticket exists, otherwise back to review, and CANCEL then works.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, getAdmin, seedRequestLike, type D03Fixtures } from '../setup/fixtures-d03'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { processConversationInbound } from '@/lib/conversations/orchestrator'

vi.setConfig({ testTimeout: 120_000 })
let fx: D03Fixtures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => getAdmin() as any
const tag = `t55${String(Date.now()).slice(-6)}`
const conversations: string[] = []
let n = 0

async function stuckConversation(minutesOld: number) {
  const identity = `91${tag}${++n}`
  const old = new Date(Date.now() - minutesOld * 60_000).toISOString()
  const c = (await admin().from('request_conversations').insert({
    org_id: fx.orgId, requester_id: fx.requesterA.id, channel_type: 'whatsapp', channel_identity: identity, state: 'submitting',
    service_id: fx.teamA.serviceId, last_activity_at: old, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }).select('id').single()).data.id as string
  conversations.push(c)
  return { id: c, identity }
}
const send = (identity: string, text: string) => processConversationInbound({
  orgId: fx.orgId, requesterId: fx.requesterA.id, channelType: 'whatsapp', channelIdentity: identity, externalMessageId: `${tag}-${++n}`, kind: 'text', text, receivedAt: new Date().toISOString(),
})
const state = async (id: string) => (await admin().from('request_conversations').select('state, request_id, last_error').eq('id', id).single()).data

beforeAll(async () => { fx = await setupD03Fixtures() }, 180_000)
afterAll(async () => {
  if (conversations.length) await admin().from('request_conversations').delete().in('id', conversations)
  await fx?.cleanup()
}, 120_000)

describe('a conversation stuck in submitting', () => {
  it('a young one still says "please wait" and is left alone', async () => {
    const c = await stuckConversation(1)
    const r = await send(c.identity, 'hello')
    expect(r.state).toBe('submitting')
    expect((await state(c.id))!.state).toBe('submitting')
  })

  it('an old one with no ticket goes back to review, and CANCEL then works', async () => {
    const c = await stuckConversation(30)
    const r = await send(c.identity, 'cancel')
    expect(r.state).toBe('cancelled')
    expect((await state(c.id))!.state).toBe('cancelled')
  })

  it('an old one whose ticket exists is completed with that ticket', async () => {
    const c = await stuckConversation(30)
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'open' })
    await admin().from('requests').update({ source_metadata: { conversation_id: c.id } }).eq('id', t.id)
    const r = await send(c.identity, 'hello')
    expect(r.state).toBe('completed')
    expect(await state(c.id)).toMatchObject({ state: 'completed', request_id: t.id })
  })
})
