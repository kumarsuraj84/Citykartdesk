// The e-mail reply sync runs once a minute. It used to download and read every mail of the last 3 days on every run, and the library's own wait on a quiet connection
// is 5 minutes, so a bad pass blocked the scheduled job until it timed out (the System Log recorded three such failures in a week). Now it asks for the headers first,
// downloads only the mails not handled before, stops starting new downloads after a time limit, and every network wait is short.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  uids: [] as number[],
  messageIds: {} as Record<number, string>,
  downloaded: [] as number[],
  logout: vi.fn(),
  close: vi.fn(),
  handled: [] as string[],
}))

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(o: Record<string, unknown>) { state.options = o }
    async connect() {}
    async getMailboxLock() { return { release() {} } }
    async search() { return state.uids }
    async *fetch(uids: number[]) { for (const uid of uids) yield { uid, envelope: state.messageIds[uid] ? { messageId: state.messageIds[uid] } : {} } }
    async fetchOne(uid: number) { state.downloaded.push(uid); return { source: Buffer.from(`mail ${uid}`) } }
    async logout() { state.logout() }
    close() { state.close() }
  },
}))
vi.mock('mailparser', () => ({ simpleParser: async (buf: Buffer) => ({ messageId: `<m${String(buf).split(' ')[1]}@x>`, subject: 'hello', from: undefined, to: undefined, cc: undefined, headers: new Map() }) }))
vi.mock('@/lib/email/mailbox', () => ({ loadDbSmtpConfig: async () => ({ host: 'smtp.gmail.com', user: 'desk@x.test', pass: 'secret' }) }))
vi.mock('@/lib/requests/email-reply-comment', () => ({ appendEmailReplyComment: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain, in: () => ({ then: (r: (v: unknown) => void) => r({ data: state.handled.map((message_id) => ({ message_id })) }) }),
        eq: () => chain, maybeSingle: async () => ({ data: null }), insert: async () => ({ error: null }), delete: () => chain,
      }
      return chain
    },
  }),
}))

import { syncInboundReplies } from '@/lib/email/inbound'

beforeEach(() => {
  state.options = undefined; state.uids = []; state.messageIds = {}; state.downloaded = []; state.handled = []
  state.logout.mockClear(); state.close.mockClear()
})

describe('the e-mail reply sync', () => {
  it('has short waits on every network step (not the library\'s 5 minutes)', async () => {
    await syncInboundReplies()
    expect(state.options).toMatchObject({ connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 })
  })

  it('downloads only the mails it has not handled before', async () => {
    state.uids = [1, 2, 3, 4, 5]
    state.messageIds = { 1: '<m1@x>', 2: '<m2@x>', 3: '<m3@x>', 4: '<m4@x>', 5: '<m5@x>' }
    state.handled = ['<m1@x>', '<m2@x>', '<m3@x>', '<m4@x>']                      // four were handled in earlier runs
    await syncInboundReplies()
    expect(state.downloaded).toEqual([5])
  })

  it('a mail with no Message-ID in its header is still downloaded (it cannot be skipped safely)', async () => {
    state.uids = [1, 2]
    state.messageIds = { 1: '<m1@x>' }                                               // mail 2 has none
    state.handled = ['<m1@x>']
    await syncInboundReplies()
    expect(state.downloaded).toEqual([2])
  })

  it('an empty mailbox downloads nothing and still logs out', async () => {
    await syncInboundReplies()
    expect(state.downloaded).toEqual([])
    expect(state.logout).toHaveBeenCalledTimes(1)
  })
})
