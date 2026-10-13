// D-020: an inbound e-mail reply is posted once, and is retried (not lost) when posting fails.

import { describe, it, expect } from 'vitest'
import { postReplyOnce } from '@/lib/email/inbound-claim'

/** A tiny stand-in for the processed_inbound_emails table with its UNIQUE(message_id) rule. */
function fakeAdmin(opts: { failInsertWith?: { code?: string; message: string } } = {}) {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    rows,
    from: (_t: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (opts.failInsertWith) return { error: opts.failInsertWith }
        if (rows.has(row.message_id as string)) return { error: { code: '23505', message: 'duplicate key' } }
        rows.set(row.message_id as string, row)
        return { error: null }
      },
      delete: () => ({ eq: async (_c: string, id: string) => { rows.delete(id); return { error: null } } }),
    }),
  }
}
const ROW = { message_id: '<m1@mail>', request_id: 'r1', from_address: 'asha@citykart.org' }

describe('postReplyOnce', () => {
  it('posts the reply and keeps the record', async () => {
    const admin = fakeAdmin(); let posted = 0
    const r = await postReplyOnce(admin, ROW, async () => { posted++; return {} })
    expect(r.outcome).toBe('posted'); expect(posted).toBe(1)
    expect(admin.rows.get('<m1@mail>')).toMatchObject({ outcome: 'matched' })
  })

  it('a failed post is NOT marked handled, so the next run tries again (the original data-loss bug)', async () => {
    const admin = fakeAdmin()
    const first = await postReplyOnce(admin, ROW, async () => ({ error: 'database busy' }))
    expect(first).toEqual({ outcome: 'failed', error: 'database busy' })
    expect(admin.rows.has('<m1@mail>')).toBe(false)
    let posted = 0
    const second = await postReplyOnce(admin, ROW, async () => { posted++; return {} })
    expect(second.outcome).toBe('posted'); expect(posted).toBe(1)
  })

  it('an exception while posting also releases the claim', async () => {
    const admin = fakeAdmin()
    await expect(postReplyOnce(admin, ROW, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(admin.rows.has('<m1@mail>')).toBe(false)
  })

  it('two overlapping runs post the reply once (the original double-post bug)', async () => {
    const admin = fakeAdmin(); let posted = 0
    const slow = async () => { posted++; await new Promise((r) => setTimeout(r, 20)); return {} }
    const [a, b] = await Promise.all([postReplyOnce(admin, ROW, slow), postReplyOnce(admin, ROW, slow)])
    expect([a.outcome, b.outcome].sort()).toEqual(['duplicate', 'posted'])
    expect(posted).toBe(1)
  })

  it('an e-mail that was already handled is skipped without posting', async () => {
    const admin = fakeAdmin(); admin.rows.set('<m1@mail>', { outcome: 'matched' }); let posted = 0
    const r = await postReplyOnce(admin, ROW, async () => { posted++; return {} })
    expect(r.outcome).toBe('duplicate'); expect(posted).toBe(0)
  })

  it('if the record itself cannot be written nothing is posted', async () => {
    const admin = fakeAdmin({ failInsertWith: { message: 'connection reset' } }); let posted = 0
    const r = await postReplyOnce(admin, ROW, async () => { posted++; return {} })
    expect(r.outcome).toBe('failed'); expect(posted).toBe(0)
  })
})
