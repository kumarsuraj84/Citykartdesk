// Smaller fixes of the P2 batch: C-24 (who the OEM contacts of a ticket are), F-38 (CSAT reminders do not starve behind failures; India time), A-22 (notification
// preference types), the approval code cancel (H-04), and the Intake inbox filters / query (E-06).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './helpers/fake-db'

// ── mocks shared by several groups ──
let db: FakeDb
let profile: { id: string; role: string; org_id: string } | null = { id: 'u1', role: 'user', org_id: 'org-1' }
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => db }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => profile }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
const csatSettings = { enabled: true, reminderDays: 2 }
vi.mock('@/lib/csat/settings', () => ({ getCsatSettings: async () => csatSettings }))
const sendCsatReminder = vi.fn()
vi.mock('@/lib/csat/issue', async () => {
  const real = await vi.importActual<typeof import('@/lib/csat/issue')>('@/lib/csat/issue')
  return { ...real, sendCsatReminder: (...a: unknown[]) => (sendCsatReminder as (...x: unknown[]) => unknown)(...a) }
})

import { senderMayReply } from '@/lib/email/inbound-participant'
import { sendDueCsatReminders } from '@/lib/csat/reminders'
import { fmtWhen } from '@/lib/csat/issue'
import { setNotificationPreference } from '@/lib/actions/notifications'
import { issueApprovalCode } from '@/lib/approvals/email-code'
import { applyInboxFolder, applyInboxSearch, applyInboxSort, cleanInboxSearch, parseInboxFolder, parseInboxSort, INBOX_FOLDER_KEYS } from '@/lib/intake/inbox-filters'
import { getInboxPage } from '@/lib/queries/intake'

describe('C-24: OEM contacts come from the system\'s own record of the mail', () => {
  const ticket = { id: 't1', requester_id: 'r', assigned_to: 'a', team_id: null }
  const forgedComment = { request_id: 't1', body: 'Ticket sent to the AC OEM for servicing.\n\nTo: attacker@evil.test\n\nMessage sent:\nx' }

  it('a forged public comment does not make an address an OEM contact when the ticket has a mail record', async () => {
    db = fakeDb({
      request_comments: [forgedComment],
      request_master_snapshots: [{ request_id: 't1', kind: 'ac', mailed_to: ['service@daikin.test'], mailed_cc: ['staff@citykart.test'] }],
      request_program_snapshots: [],
    })
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'X', email: 'attacker@evil.test' })).toBe(false)
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'X', email: 'service@daikin.test' })).toBe(true)
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'X', email: 'colleague@daikin.test' })).toBe(true)   // same company domain
  })

  it('a program ticket: both the to and the cc addresses of the program record count', async () => {
    db = fakeDb({
      request_comments: [], request_master_snapshots: [],
      request_program_snapshots: [{ request_id: 't1', program_id: 'p', mailed_to: ['a@vendor.test'], mailed_cc: ['b@cc.test'] }],
    })
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'V', email: 'b@cc.test' })).toBe(true)
  })

  it('a record that lists nobody (the mail never went out) lets no OEM in, whatever the comments say', async () => {
    db = fakeDb({ request_comments: [forgedComment], request_master_snapshots: [{ request_id: 't1', kind: 'ac', mailed_to: [], mailed_cc: [] }], request_program_snapshots: [] })
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'X', email: 'attacker@evil.test' })).toBe(false)
  })

  it('a shared mail domain never counts as one company', async () => {
    db = fakeDb({ request_comments: [], request_master_snapshots: [{ request_id: 't1', kind: 'ac', mailed_to: ['dealer@gmail.com'], mailed_cc: [] }], request_program_snapshots: [] })
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'X', email: 'someone.else@gmail.com' })).toBe(false)
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'X', email: 'dealer@gmail.com' })).toBe(true)
  })

  it('a ticket with no mail record at all still uses the old comment (tickets from before the records existed)', async () => {
    db = fakeDb({ request_comments: [], request_master_snapshots: [], request_program_snapshots: [] })
    // fake-db supports ilike on body
    db.tables.request_comments.push({ request_id: 't1', body: 'Ticket sent to the AC OEM for servicing.\n\nTo: old@oem.test\n\nMessage sent:\nx' })
    expect(await senderMayReply(db as never, ticket, { kind: 'oem', name: 'X', email: 'old@oem.test' })).toBe(true)
  })
})

describe('F-38: CSAT reminders', () => {
  const survey = (i: number) => ({ id: `s${i}`, request_id: `r${i}`, requester_id: `u${i}`, sent_at: `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00.000Z`, submitted_at: null, reminder_sent_at: null })
  const ticket = (i: number) => ({ id: `r${i}`, request_no: `CK-${i}`, title: 'T', status: 'resolved', reopen_deadline_at: null, resolved_at: '2026-10-01T09:00:00.000Z' })

  beforeEach(() => { sendCsatReminder.mockReset() })

  it('surveys that can never be sent (no e-mail address) at the head of the list do not stop the ones behind them', async () => {
    const n = 130
    db = fakeDb({ csat_surveys: Array.from({ length: n }, (_, i) => survey(i)), requests: Array.from({ length: n }, (_, i) => ticket(i)) })
    // the first 100 can never be delivered; the rest can
    sendCsatReminder.mockImplementation(async (_a: unknown, p: { surveyId: string }) => Number(p.surveyId.slice(1)) >= 100)
    const sent = await sendDueCsatReminders(db as never, 100)
    expect(sent).toBe(30)
  })

  it('a ticket no longer resolved is marked as handled, not retried for ever', async () => {
    db = fakeDb({ csat_surveys: [survey(1)], requests: [{ ...ticket(1), status: 'closed' }] })
    expect(await sendDueCsatReminders(db as never)).toBe(0)
    expect(db.tables.csat_surveys[0].reminder_sent_at).toBeTruthy()
    expect(sendCsatReminder).not.toHaveBeenCalled()
  })

  it('a failed send gives the claim back so the next run tries again', async () => {
    db = fakeDb({ csat_surveys: [survey(1)], requests: [ticket(1)] })
    sendCsatReminder.mockResolvedValue(false)
    expect(await sendDueCsatReminders(db as never)).toBe(0)
    expect(db.tables.csat_surveys[0].reminder_sent_at).toBeNull()
  })

  it('times in the mail are India time, 24-hour', () => {
    expect(fmtWhen('2026-10-29T10:30:00.000Z')).toMatch(/29 Oct 2026,? 16:00/)
    expect(fmtWhen('2026-10-29T20:45:00.000Z')).toMatch(/30 Oct 2026,? 02:15/)
  })
})

describe('A-22: notification preferences', () => {
  beforeEach(() => { profile = { id: 'u1', role: 'user', org_id: 'org-1' }; db = fakeDb({ notification_preferences: [] }) })

  it('accepts a real notification type', async () => {
    expect(await setNotificationPreference('comment_added', false)).toEqual({})
    expect(db.tables.notification_preferences).toHaveLength(1)
  })
  it('refuses anything else, however long, and a non-boolean value', async () => {
    expect((await setNotificationPreference('made_up_type', true)).error).toBeTruthy()
    expect((await setNotificationPreference('x'.repeat(5000), true)).error).toBeTruthy()
    expect((await setNotificationPreference('comment_added', 'yes' as never)).error).toBeTruthy()
    expect(db.tables.notification_preferences).toHaveLength(0)
  })
})

describe('H-04: approval code', () => {
  it('if the earlier code cannot be cancelled, no new code is issued', async () => {
    db = fakeDb({ approval_email_codes: [] }, { fail: (op) => (op.kind === 'update' ? { message: 'boom' } : undefined) })
    expect(await issueApprovalCode(db as never, 'a1', 'u1')).toBeNull()
    expect(db.tables.approval_email_codes).toHaveLength(0)
  })
  it('otherwise a code is issued', async () => {
    db = fakeDb({ approval_email_codes: [] })
    expect(await issueApprovalCode(db as never, 'a1', 'u1')).toMatch(/\d{4,}/)
  })
})

describe('E-06: inbox filters', () => {
  it('has the same ten folders and falls back to "all" / "priority_smart" for unknown values', () => {
    expect(INBOX_FOLDER_KEYS).toHaveLength(10)
    expect(parseInboxFolder('nope')).toBe('all')
    expect(parseInboxFolder('rest')).toBe('rest')
    expect(parseInboxSort('nope')).toBe('priority_smart')
  })
  it('search text loses the characters that mean something in a filter', () => {
    expect(cleanInboxSearch('a,b(c)*%_"d\\e')).toBe('a b c d e')
    expect(cleanInboxSearch(null)).toBe('')
    expect(cleanInboxSearch('x'.repeat(300))).toHaveLength(80)
  })

  function recorder() {
    const calls: [string, ...unknown[]][] = []
    const q: Record<string, (...a: unknown[]) => unknown> = new Proxy({}, { get: (_t, name: string) => (...a: unknown[]) => { calls.push([name, ...a]); return q } }) as never
    return { q, calls }
  }
  it('every folder except "rest" leaves archived mail out; "rest" takes archived, informational / ignore and unclassified mail', () => {
    for (const k of INBOX_FOLDER_KEYS) {
      const { q, calls } = recorder()
      applyInboxFolder(q, k)
      if (k === 'rest') expect(calls).toEqual([['or', 'is_archived.eq.true,suggested_type.in.(informational,ignore),review_id.is.null']])
      else expect(calls).toContainEqual(['eq', 'is_archived', false])
    }
  })
  it('search and sort are conditions the database applies', () => {
    const s = recorder(); applyInboxSearch(s.q, 'ac leak')
    expect(s.calls[0][0]).toBe('or'); expect(String(s.calls[0][1])).toContain('subject.ilike.*ac leak*')
    const none = recorder(); applyInboxSearch(none.q, ''); expect(none.calls).toHaveLength(0)
    const o = recorder(); applyInboxSort(o.q, 'priority_smart')
    expect(o.calls[0]).toEqual(['order', 'priority_score', { ascending: false }])
  })
})

describe('E-06: getInboxPage', () => {
  // a recording stand-in for the data client: every query is a thenable that resolves to what the test gives it
  function client(opts: { rows?: unknown[]; total?: number; error?: { code?: string; message: string } | null; counts?: number }) {
    const queries: { table: string; calls: [string, ...unknown[]][] }[] = []
    return {
      queries,
      from(table: string) {
        const calls: [string, ...unknown[]][] = []
        queries.push({ table, calls })
        const q: Record<string, unknown> = new Proxy({}, {
          get(_t, name: string) {
            if (name === 'then') {
              const head = calls.some((c) => c[0] === 'select' && (c[2] as { head?: boolean } | undefined)?.head)
              const res = head ? { count: opts.counts ?? 7, error: null } : { data: opts.rows ?? [], count: opts.total ?? (opts.rows ?? []).length, error: opts.error ?? null }
              return (resolve: (v: unknown) => unknown) => Promise.resolve(res).then(resolve)
            }
            return (...a: unknown[]) => { calls.push([name, ...a]); return q }
          },
        }) as never
        return q
      },
    }
  }
  const viewRow = {
    id: 'm1', subject: 'AC not cooling', from_address: 'a@b.test', to_addresses: [], received_at: '2026-10-29T10:00:00Z', snippet: 'short', status: 'new', is_read: false, is_archived: false,
    thread_id: null, recipient_type: 'to', channel_id: 'ch1', channel_name: 'Support', channel_type: 'email',
    review_id: 'rv1', review_state: 'pending', suggested_type: 'request', suggested_department: 'Admin', suggested_priority: 'high', suggested_confidence: 80,
    is_starred: false, is_escalated: true, escalation_note: null, created_request_id: null, created_task_id: null, stage: 'rule', provider: 'rules',
  }

  it('reads one page from the view with the filters applied by the database, and returns real counts', async () => {
    const c = client({ rows: [viewRow], total: 123, counts: 9 })
    db = c as never
    const r = await getInboxPage({ page: 2, pageSize: 50, folder: 'urgent', channel: 'ch1', stage: 'rule', q: 'ac', sort: 'date_desc', channelIds: ['ch1'] })
    expect(r.error).toBeNull()
    expect(r.total).toBe(123)
    expect(r.data[0]).toMatchObject({ id: 'm1', snippet: 'short', channel: { id: 'ch1', name: 'Support' }, review: { id: 'rv1', is_escalated: true, stage: 'rule' } })
    expect(r.counts.all).toBe(9)
    expect(r.channelCounts).toEqual({ ch1: 9 })
    const main = c.queries[0]
    expect(main.table).toBe('intake_inbox_v')
    expect(main.calls).toContainEqual(['range', 50, 99])
    expect(main.calls).toContainEqual(['eq', 'channel_id', 'ch1'])
    expect(main.calls).toContainEqual(['eq', 'stage', 'rule'])
    // never asks for the full body
    expect(JSON.stringify(main.calls)).not.toContain('body_text')
  })

  it('a failed read is reported as an error, not shown as an empty inbox', async () => {
    db = client({ error: { code: 'XX000', message: 'view missing' } }) as never
    const r = await getInboxPage({})
    expect(r.error).toMatch(/could not be loaded/)
    expect(r.data).toEqual([])
  })
})
