// H-13: the branches of the inbound e-mail processing (lib/email/inbound.ts, processParsedMessage), with mails built in the test and an in-memory database.
// No mailbox, no network. Covers: automatic answers, two From lines, unknown sender, an OEM sender (mailed / not mailed), a reply to a closed ticket,
// re-processing after a failed record, and a mail with no Message-ID (G-19).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb, type Op } from './helpers/fake-db'

vi.mock('@/lib/masters/contacts', () => ({ loadSheetOemContacts: async () => [] }))
vi.mock('@/lib/events/record', () => ({ recordEvents: async () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('not used') } }))
const append = vi.fn()
vi.mock('@/lib/requests/email-reply-comment', () => ({ appendEmailReplyComment: (...a: unknown[]) => append(...a) }))

import { processParsedMessage, noIdMessageKey, legacyNoIdKey, type InboundSyncResult } from '@/lib/email/inbound'

const REQ = { id: 'req-1', request_no: 'CKSD-000520', org_id: 'org-1', requester_id: 'u-req', assigned_to: 'u-tech', team_id: null, status: 'in_progress' }

function newResult(): InboundSyncResult { return { checked: 0, matched: 0, noMatch: 0, senderNotRecognized: 0, errors: [] } }

type MailOpts = {
  messageId?: string | null; subject?: string; from?: string; text?: string
  headers?: Record<string, string>; fromLines?: number
}
function mail(o: MailOpts = {}) {
  const from = o.from ?? 'requester@citykart.test'
  const parsed: Record<string, unknown> = {
    subject: o.subject ?? `Re: [${REQ.request_no}] Not cooling`,
    from: { value: [{ address: from, name: 'Someone' }], text: from },
    to: { text: 'desk@citykart.test' },
    text: o.text ?? 'It is working again, thanks.',
    headers: new Map(Object.entries(o.headers ?? {})),
    headerLines: Array.from({ length: o.fromLines ?? 1 }, () => ({ key: 'from', line: `From: ${from}` })),
    attachments: [],
  }
  if (o.messageId !== null) parsed.messageId = o.messageId ?? '<m1@mail.test>'
  return parsed
}

function setup(extra: { oems?: { name: string; emails: string[] }[]; snapshots?: Record<string, unknown>[]; fail?: (op: Op) => { message: string; code?: string } | undefined; request?: Partial<typeof REQ> } = {}) {
  const db: FakeDb = fakeDb({
    requests: [{ ...REQ, ...extra.request }],
    profiles: [
      { id: 'u-req', full_name: 'Store Requester', org_id: 'org-1', is_active: true, role: 'user' },
      { id: 'u-tech', full_name: 'Tech Nician', org_id: 'org-1', is_active: true, role: 'agent' },
    ],
    oems: (extra.oems ?? []).map((o) => ({ ...o, org_id: 'org-1' })),
    request_program_snapshots: extra.snapshots ?? [],
    request_master_snapshots: [],
    processed_inbound_emails: [], request_comments: [], request_collaborators: [], team_members: [],
  }, { fail: extra.fail })
  db.auth.admin.listUsers = (async () => ({ data: { users: [{ id: 'u-req', email: 'requester@citykart.test' }, { id: 'u-tech', email: 'tech@citykart.test' }] } })) as never
  return db
}
const run = (db: FakeDb, parsed: unknown, result = newResult(), uid = 7) =>
  processParsedMessage({ admin: db as never, parsed, uid, uidValidity: 42, identityCache: new Map(), result }).then(() => result)

beforeEach(() => {
  append.mockReset()
  append.mockImplementation(async (p: { requestId: string; body: string }) => ({ commentId: `c-${p.requestId}` }))
})

describe('inbound mail processing', () => {
  it('skips an automatic answer (out of office) and records it as handled, posting nothing', async () => {
    const db = setup()
    const r = await run(db, mail({ headers: { 'auto-submitted': 'auto-replied' } }))
    expect(r.noMatch).toBe(1)
    expect(append).not.toHaveBeenCalled()
    expect(db.tables.processed_inbound_emails).toEqual([expect.objectContaining({ message_id: '<m1@mail.test>', outcome: 'no_match' })])
  })

  it('does not trust a mail with two From lines', async () => {
    const db = setup()
    const r = await run(db, mail({ fromLines: 2 }))
    expect(r.noMatch).toBe(1)
    expect(append).not.toHaveBeenCalled()
    expect(db.tables.processed_inbound_emails[0]).toMatchObject({ outcome: 'no_match', from_address: '' })
  })

  it('refuses an unknown sender, records it, and posts nothing', async () => {
    const db = setup()
    const r = await run(db, mail({ from: 'stranger@elsewhere.test' }))
    expect(r.senderNotRecognized).toBe(1)
    expect(append).not.toHaveBeenCalled()
    expect(db.tables.processed_inbound_emails[0]).toMatchObject({ outcome: 'sender_not_recognized', request_id: 'req-1' })
  })

  it('posts a known requester\'s reply once', async () => {
    const db = setup()
    const r = await run(db, mail())
    expect(r.matched).toBe(1)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', author: expect.objectContaining({ kind: 'profile', profileId: 'u-req' }) }))
    expect(db.tables.processed_inbound_emails[0]).toMatchObject({ outcome: 'matched' })
  })

  it('accepts an OEM sender only when the ticket was mailed to that OEM (the system\'s own record)', async () => {
    const snapshot = { request_id: 'req-1', program_id: 'p1', mailed_to: ['service@daikin.test'], mailed_cc: [] }
    const mailed = setup({ oems: [{ name: 'Daikin', emails: ['service@daikin.test'] }], snapshots: [snapshot] })
    expect((await run(mailed, mail({ from: 'service@daikin.test' }))).matched).toBe(1)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ author: { kind: 'oem', name: 'Daikin', email: 'service@daikin.test' } }))

    append.mockClear()
    const notMailed = setup({ oems: [{ name: 'Voltas', emails: ['service@voltas.test'] }], snapshots: [snapshot] })
    const r = await run(notMailed, mail({ from: 'service@voltas.test' }))
    expect(r.senderNotRecognized).toBe(1)
    expect(append).not.toHaveBeenCalled()
  })

  it('still hands a reply to a closed ticket to the append step (which stores it and notes the late reply)', async () => {
    const db = setup({ request: { status: 'closed' } })
    const r = await run(db, mail())
    expect(r.matched).toBe(1)
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('re-processes a mail after the record of it could not be written, and then handles it only once', async () => {
    let failInsert = true
    const db = setup({ fail: (op) => (failInsert && op.table === 'processed_inbound_emails' && op.kind === 'insert' ? { message: 'connection reset' } : undefined) })
    const first = await run(db, mail())
    expect(first.matched).toBe(0)
    expect(first.errors[0]).toMatch(/Could not record the e-mail as handled/)
    expect(append).not.toHaveBeenCalled()
    expect(db.tables.processed_inbound_emails).toHaveLength(0)

    failInsert = false
    const second = await run(db, mail())
    expect(second.matched).toBe(1)
    expect(append).toHaveBeenCalledTimes(1)

    const third = await run(db, mail())
    expect(third.checked).toBe(0)   // already handled: skipped before anything else
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('reports (does not hide) a failed write of the "no match" record', async () => {
    const db = setup({ fail: (op) => (op.table === 'processed_inbound_emails' && op.kind === 'insert' ? { message: 'disk full', code: '53100' } : undefined) })
    const r = await run(db, mail({ headers: { 'auto-submitted': 'auto-replied' } }))
    expect(r.errors.join(' ')).toMatch(/Could not record a mail as handled/)
  })

  it('gives a mail with no Message-ID a stable key, so a second pass skips it (G-19)', async () => {
    const db = setup()
    const first = await run(db, mail({ messageId: null }))
    expect(first.matched).toBe(1)
    expect(db.tables.processed_inbound_emails[0].message_id).toBe(noIdMessageKey(42, 7))
    const second = await run(db, mail({ messageId: null }))
    expect(second.checked).toBe(0)
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('still recognises a no-Message-ID mail recorded under the older key', async () => {
    const db = setup()
    db.tables.processed_inbound_emails.push({ id: 'old', message_id: legacyNoIdKey(7), outcome: 'matched' })
    const r = await run(db, mail({ messageId: null }))
    expect(r.checked).toBe(0)
    expect(append).not.toHaveBeenCalled()
  })
})
