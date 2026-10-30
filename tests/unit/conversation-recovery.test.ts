// B-04: a WhatsApp conversation left in 'submitting' (a restart between the review -> submitting commit and the completion) is repaired by the next message
// instead of blocking that phone for ever. B-35: a message that is already being handled is not handled a second time.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './helpers/fake-db'
import { STALE_SUBMITTING_MS, isStaleSubmitting, canTransition } from '@/lib/conversations/state-machine'

let db: FakeDb
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
vi.mock('@/lib/requests/create-request-core', () => ({ createRequestCore: vi.fn() }))
const claim = vi.fn()
vi.mock('@/lib/conversations/repository', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/conversations/repository')>()
  return { ...real, claimEvent: (...a: unknown[]) => (claim as (...x: unknown[]) => unknown)(...a) }
})

import { processConversationInbound } from '@/lib/conversations/orchestrator'
import { recoverStaleSubmitting, findTicketForConversation, RECOVERED_TO_REVIEW_NOTE } from '@/lib/conversations/recovery'
import type { ConversationRow } from '@/lib/conversations/types'

const NOW = new Date('2026-10-29T10:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

function convRow(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', org_id: 'org-1', requester_id: 'u1', channel_type: 'whatsapp', channel_identity: '9199', state: 'submitting',
    service_id: 's1', issue_search_text: null, search_result_ids: null, sub_category_id: null, category_id: null, description: 'd', title: 't', answers: {},
    current_field_id: null, request_id: null, last_error: null, version: 3, last_activity_at: minutesAgo(30), expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    created_at: minutesAgo(40), updated_at: minutesAgo(30), completed_at: null, cancelled_at: null, expired_at: null, ...over,
  }
}

/** a stand-in for the database function commit_conversation_transition: applies the next state to the row and returns it */
function setup(conv: Record<string, unknown>, tickets: Record<string, unknown>[] = []) {
  db = fakeDb(
    { request_conversations: [conv], requests: tickets, conversation_attachments: [], conversation_events: [] },
    {
      rpc: (name, a) => {
        if (name !== 'commit_conversation_transition') return null
        const row = db.tables.request_conversations.find((r) => r.id === a.p_conversation_id)!
        Object.assign(row, {
          state: a.p_state, request_id: a.p_request_id, last_error: a.p_last_error, completed_at: a.p_completed_at, cancelled_at: a.p_cancelled_at,
          expired_at: a.p_expired_at, version: (row.version as number) + 1, last_activity_at: a.p_last_activity_at, expires_at: a.p_expires_at,
        })
        return { ...row }
      },
    },
  )
}

const input = (text: string) => ({ orgId: 'org-1', requesterId: 'u1', channelType: 'whatsapp' as const, channelIdentity: '9199', externalMessageId: `wamid-${text}`, kind: 'text' as const, text, receivedAt: new Date().toISOString() })

beforeEach(() => { claim.mockReset(); claim.mockResolvedValue({ status: 'new', eventId: 'e1' }) })

describe('state machine', () => {
  it('a submission becomes stale after 5 minutes, and only a submitting conversation can be stale', () => {
    expect(STALE_SUBMITTING_MS).toBe(5 * 60_000)
    expect(isStaleSubmitting({ state: 'submitting', lastActivityAt: minutesAgo(6) }, NOW)).toBe(true)
    expect(isStaleSubmitting({ state: 'submitting', lastActivityAt: minutesAgo(2) }, NOW)).toBe(false)
    expect(isStaleSubmitting({ state: 'review', lastActivityAt: minutesAgo(600) }, NOW)).toBe(false)
  })
  it('submitting still leads only to completed or back to review (recovery uses exactly these)', () => {
    expect(canTransition('submitting', 'completed')).toBe(true)
    expect(canTransition('submitting', 'review')).toBe(true)
    expect(canTransition('submitting', 'cancelled')).toBe(false)
  })
})

describe('recoverStaleSubmitting', () => {
  const nextFrom = (c: ConversationRow, o: Record<string, unknown>) => ({
    state: c.state, serviceId: c.serviceId, issueSearchText: c.issueSearchText, searchResultIds: c.searchResultIds, subCategoryId: c.subCategoryId, categoryId: c.categoryId,
    description: c.description, title: c.title, answers: c.answers, currentFieldId: c.currentFieldId, requestId: c.requestId, lastError: c.lastError,
    lastActivityAt: NOW.toISOString(), expiresAt: c.expiresAt, completedAt: c.completedAt, cancelledAt: c.cancelledAt, expiredAt: c.expiredAt, ...o,
  }) as never

  async function conv(): Promise<ConversationRow> {
    const { findConversationById } = await import('@/lib/conversations/repository')
    return (await findConversationById({ admin: db as never, orgId: 'org-1', id: 'c1' }))!
  }

  it('a young submission is left alone', async () => {
    setup(convRow({ last_activity_at: minutesAgo(1) }))
    const r = await recoverStaleSubmitting({ admin: db as never, conversation: await conv(), nextFrom, now: NOW })
    expect(r.outcome).toBe('none')
    expect(db.tables.request_conversations[0].state).toBe('submitting')
  })

  it('with a ticket carrying the conversation id, the conversation is completed with that ticket', async () => {
    setup(convRow(), [{ id: 'req-9', request_no: 'CK-0009', org_id: 'org-1', source_metadata: { conversation_id: 'c1' }, created_at: minutesAgo(29) }])
    const r = await recoverStaleSubmitting({ admin: db as never, conversation: await conv(), nextFrom, now: NOW })
    expect(r).toMatchObject({ outcome: 'completed', requestId: 'req-9', requestNo: 'CK-0009' })
    expect(db.tables.request_conversations[0]).toMatchObject({ state: 'completed', request_id: 'req-9' })
  })

  it('with no ticket, the conversation goes back to review with a note (CREATE, CANCEL and RESTART work again)', async () => {
    setup(convRow())
    const r = await recoverStaleSubmitting({ admin: db as never, conversation: await conv(), nextFrom, now: NOW })
    expect(r.outcome).toBe('returned_to_review')
    expect(db.tables.request_conversations[0]).toMatchObject({ state: 'review', last_error: RECOVERED_TO_REVIEW_NOTE })
  })

  it('another organisation\'s ticket with the same marker is not used', async () => {
    setup(convRow(), [{ id: 'x', request_no: 'CK-1', org_id: 'org-2', source_metadata: { conversation_id: 'c1' } }])
    expect(await findTicketForConversation(db as never, { id: 'c1', orgId: 'org-1' })).toBeNull()
  })
})

describe('a message arriving for a stuck conversation', () => {
  it('CANCEL on a stale submitting conversation cancels it (it used to answer "cannot be cancelled" for ever)', async () => {
    setup(convRow())
    const r = await processConversationInbound(input('cancel'))
    expect(r.state).toBe('cancelled')
    expect(db.tables.request_conversations[0].state).toBe('cancelled')
  })

  it('any message on a stale conversation whose ticket exists says the request was created', async () => {
    setup(convRow(), [{ id: 'req-9', request_no: 'CK-0009', org_id: 'org-1', source_metadata: { conversation_id: 'c1' }, created_at: minutesAgo(29) }])
    const r = await processConversationInbound(input('hello'))
    expect(r.state).toBe('completed')
    expect(r.prompt?.message).toContain('CK-0009')
  })

  it('a conversation that is only a minute into submitting still answers "please wait"', async () => {
    setup(convRow({ last_activity_at: new Date().toISOString() }))
    const r = await processConversationInbound(input('hello'))
    expect(r.state).toBe('submitting')
    expect(db.tables.request_conversations[0].state).toBe('submitting')
  })
})

describe('the same message delivered twice', () => {
  it('a delivery claimed a moment ago and still being handled is not handled again', async () => {
    setup(convRow({ state: 'review', last_activity_at: new Date().toISOString() }))
    claim.mockResolvedValue({ status: 'in_flight', eventId: 'e1', ageMs: 2_000 })
    const r = await processConversationInbound(input('1'))
    expect(r.duplicate).toBe(true)
    expect(r.conversationId).toBe('c1')
    expect(db.tables.request_conversations[0].version).toBe(3)   // nothing was committed
  })

  it('a claim old enough to have been abandoned is processed again', async () => {
    setup(convRow({ state: 'review', last_activity_at: new Date().toISOString() }))
    claim.mockResolvedValue({ status: 'in_flight', eventId: 'e1', ageMs: 5 * 60_000 })
    const r = await processConversationInbound(input('cancel'))
    expect(r.duplicate).toBeUndefined()
    expect(r.state).toBe('cancelled')
  })
})
