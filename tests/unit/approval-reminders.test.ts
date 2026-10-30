import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/queries/approvals', () => ({ getActionableApprovalsForUser: vi.fn() }))
vi.mock('@/lib/email/notify-email', () => ({ absoluteAppUrl: (l: string) => `https://desk.test${l}` }))
vi.mock('@/lib/approvals/email-link', () => ({
  approvalLinkUrls: (a: string, p: string) => ({ pageUrl: `https://desk.test/approve/${a}.${p}`, approveUrl: `https://desk.test/approve/${a}.${p}?do=approve`, rejectUrl: `https://desk.test/approve/${a}.${p}?do=reject` }),
  LINK_DAYS: 7,
}))

import { sendApprovalReminders, LAST_RUN_KEY } from '@/lib/approvals/reminders'
import { approvalReminderEmail } from '@/lib/email/approval-reminder'
import type { PendingApprovalItem } from '@/lib/queries/approvals'

type Person = { id: string; full_name: string; role: string; org_id: string; is_active: boolean }

// a minimal in-memory database: just what the job reads and writes
function fakeAdmin(o: { pending: { id: string; workflow_id: string }[]; steps: { workflow_id: string; approver_user_id: string }[]; people: Person[] }) {
  const settings: Record<string, string> = {}
  const emails: Record<string, string> = Object.fromEntries(o.people.map((p) => [p.id, `${p.full_name.split(' ')[0].toLowerCase()}@citykart.test`]))
  return {
    settings,
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: emails[id] ? { email: emails[id] } : null } }) } },
    from(table: string) {
      const rows = table === 'approvals' ? o.pending : table === 'approval_workflow_steps' ? o.steps : table === 'profiles' ? o.people : []
      let readKey = LAST_RUN_KEY
      const chain: Record<string, unknown> = {
        select: () => chain, eq: (c: string, v: string) => { if (c === 'key') readKey = v; return chain }, in: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: settings[readKey] !== undefined ? { value: settings[readKey] } : null }),
        insert: async (row: { key: string; value: string }) => {
          if (settings[row.key] !== undefined) return { error: { code: '23505' } }
          settings[row.key] = row.value
          return { error: null }
        },
        update: (patch: { value: string }) => {
          const where: unknown[] = []
          const u = {
            eq: (_k: string, v: unknown) => { where.push(v); return u },
            // a conditional change (key, then the value expected) finishes with select(); a plain change is awaited as it is
            select: async () => {
              const [key, expected] = where as string[]
              if (settings[key] === expected) { settings[key] = patch.value; return { data: [{ key }] } }
              return { data: [] }
            },
            then: (resolve: (v: unknown) => void) => { settings[where[0] as string] = patch.value; resolve({}) },
          }
          return u
        },
        delete: () => ({ eq: async (_k: string, key: string) => { delete settings[key]; return {} } }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows }),
      }
      return chain
    },
  }
}

const now = new Date('2026-10-15T10:00:00+05:30')
const dayStart = new Date('2026-10-15T00:00:00+05:30').getTime()
/** a moment `days` calendar days before today, at `hour` India time */
const ago = (days: number, hour = 12) => new Date(dayStart - days * 86_400_000 + hour * 3_600_000).toISOString()
const item = (n: number, createdAt: string): PendingApprovalItem => ({
  approvalId: `a${n}`, requestId: `r${n}`, requestNo: `CKSD-00000${n}`, requestTitle: `Ticket ${n}`, requesterName: 'Store A', sentByName: 'Arun', awaiting: 'Ankur', createdAt,
})
const ankur: Person = { id: 'ankur', full_name: 'Ankur Sharma', role: 'user', org_id: 'o1', is_active: true }
const world = (people: Person[] = [ankur]) => ({ pending: [{ id: 'a1', workflow_id: 'w1' }], steps: [{ workflow_id: 'w1', approver_user_id: 'ankur' }], people })

const send = vi.fn()
beforeEach(() => { send.mockReset().mockResolvedValue({}) })

describe('the daily approval reminder', () => {
  it('one e-mail per approver listing everything still waiting on them (5 sent, none decided)', async () => {
    const getPending = vi.fn().mockResolvedValue([1, 2, 3, 4, 5].map((n) => item(n, ago(n))))
    const r = await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending, send })
    expect(r).toMatchObject({ approvers: 1, sent: 1, listed: 5, skippedFresh: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    const mail = send.mock.calls[0][0]
    expect(mail.to).toBe('ankur@citykart.test')
    expect(mail.subject).toBe('Reminder: 5 approvals are waiting for you')
    for (let n = 1; n <= 5; n++) expect(mail.html).toContain(`CKSD-00000${n}`)
  })

  it('only what is still pending is listed (2 of 5 decided: the 3 left)', async () => {
    const getPending = vi.fn().mockResolvedValue([3, 4, 5].map((n) => item(n, ago(n))))
    await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending, send })
    const mail = send.mock.calls[0][0]
    expect(mail.subject).toBe('Reminder: 3 approvals are waiting for you')
    expect(mail.html).not.toContain('CKSD-000001')
  })

  it('the longest waiting comes first, with its waiting days', async () => {
    const getPending = vi.fn().mockResolvedValue([item(1, ago(1)), item(2, ago(4))])
    await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending, send })
    const html: string = send.mock.calls[0][0].html
    expect(html.indexOf('CKSD-000002')).toBeLessThan(html.indexOf('CKSD-000001'))
    expect(html).toContain('waiting 4 days')
  })

  it('a single waiting approval is a plain reminder for that ticket, with its own Approve and Reject links', async () => {
    const getPending = vi.fn().mockResolvedValue([item(1, ago(1))])
    await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending, send })
    const mail = send.mock.calls[0][0]
    expect(mail.subject).toBe('Reminder: approval waiting for you - CKSD-000001 - Ticket 1')
    expect(mail.html).toContain('a1.ankur?do=approve')
    expect(mail.html).toContain('a1.ankur?do=reject')
  })

  it('nobody is e-mailed when everything waiting for them was sent today', async () => {
    const getPending = vi.fn().mockResolvedValue([item(1, ago(0, 9))])
    const r = await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending, send })
    expect(r).toMatchObject({ approvers: 1, sent: 0, skippedFresh: 1 })
    expect(send).not.toHaveBeenCalled()
  })

  it('but a new one is listed together with an older one (a compiled list)', async () => {
    const getPending = vi.fn().mockResolvedValue([item(1, ago(0, 9)), item(2, ago(3))])
    const r = await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending, send })
    expect(r.listed).toBe(2)
  })

  it('nobody with nothing waiting (decided by someone else, cancelled, not their turn) is e-mailed', async () => {
    const getPending = vi.fn().mockResolvedValue([])
    const r = await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending, send })
    expect(r).toMatchObject({ approvers: 0, sent: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it('an inactive approver is left out', async () => {
    const getPending = vi.fn().mockResolvedValue([item(1, ago(2))])
    await sendApprovalReminders(fakeAdmin(world([{ ...ankur, is_active: false }])) as never, { now, getPending, send })
    expect(getPending).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('runs once a day: a second call the same day sends nothing, and the next day it runs again', async () => {
    const getPending = vi.fn().mockResolvedValue([item(1, ago(2))])
    const admin = fakeAdmin(world())
    await sendApprovalReminders(admin as never, { now, getPending, send })
    const again = await sendApprovalReminders(admin as never, { now, getPending, send })
    expect(again.alreadyRan).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    const tomorrow = await sendApprovalReminders(admin as never, { now: new Date('2026-10-16T10:00:00+05:30'), getPending, send })
    expect(tomorrow.sent).toBe(1)
  })

  it('a run that died half way carries on the same day with the approvers who have not had their reminder (G-21)', async () => {
    const bela: Person = { id: 'bela', full_name: 'Bela Rao', role: 'user', org_id: 'o1', is_active: true }
    const admin = fakeAdmin({ pending: [{ id: 'a1', workflow_id: 'w1' }], steps: [{ workflow_id: 'w1', approver_user_id: 'ankur' }, { workflow_id: 'w1', approver_user_id: 'bela' }], people: [ankur, bela] })
    const getPending = vi.fn().mockResolvedValue([item(1, ago(2))])
    // the first pass is cut off while sending to the second approver (a crash / restart)
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('process killed'))
    await expect(sendApprovalReminders(admin as never, { now, getPending, send })).rejects.toThrow('process killed')
    expect(admin.settings[LAST_RUN_KEY]).toBeUndefined()   // the day is NOT used up
    send.mockReset().mockResolvedValue({})
    const second = await sendApprovalReminders(admin as never, { now, getPending, send })
    expect(second).toMatchObject({ sent: 1, alreadySent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].to).toBe('bela@citykart.test')
    // and now the day is finished
    expect((await sendApprovalReminders(admin as never, { now, getPending, send })).alreadyRan).toBe(true)
  })

  it('an approver whose e-mail failed is tried again on the next call; the one who got theirs is not e-mailed twice', async () => {
    const bela: Person = { id: 'bela', full_name: 'Bela Rao', role: 'user', org_id: 'o1', is_active: true }
    const admin = fakeAdmin({ pending: [{ id: 'a1', workflow_id: 'w1' }], steps: [{ workflow_id: 'w1', approver_user_id: 'ankur' }, { workflow_id: 'w1', approver_user_id: 'bela' }], people: [ankur, bela] })
    const getPending = vi.fn().mockResolvedValue([item(1, ago(2))])
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({ error: 'smtp down' })
    const first = await sendApprovalReminders(admin as never, { now, getPending, send })
    expect(first).toMatchObject({ sent: 1, failed: 1 })
    send.mockReset().mockResolvedValue({})
    const second = await sendApprovalReminders(admin as never, { now, getPending, send })
    expect(second).toMatchObject({ sent: 1, alreadySent: 1 })
    expect(send.mock.calls[0][0].to).toBe('bela@citykart.test')
  })

  it('if nothing could be sent, the day is not used up (the next call tries again)', async () => {
    send.mockResolvedValue({ error: 'smtp down' })
    const getPending = vi.fn().mockResolvedValue([item(1, ago(2))])
    const admin = fakeAdmin(world())
    const first = await sendApprovalReminders(admin as never, { now, getPending, send })
    expect(first).toMatchObject({ sent: 0, failed: 1 })
    send.mockResolvedValue({})
    const second = await sendApprovalReminders(admin as never, { now, getPending, send })
    expect(second.sent).toBe(1)
  })
})

describe('the reminder e-mail', () => {
  it('escapes names and titles', () => {
    const mail = approvalReminderEmail({
      approverName: '<b>Ankur</b>', approvalsUrl: 'https://desk.test/approvals',
      items: [{ requestNo: 'CKSD-1', requestTitle: '<img src=x onerror=alert(1)>', requesterName: 'A & B', sentByName: 'Arun', waitingDays: 0, requestUrl: 'https://desk.test/requests/1' }],
    })
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;img')
    expect(mail.html).toContain('sent today')
  })
  it('without links a row only opens the ticket', () => {
    const mail = approvalReminderEmail({
      approverName: 'Ankur', approvalsUrl: 'u',
      items: [{ requestNo: '', requestTitle: 'T', requesterName: '', sentByName: '', waitingDays: 1, requestUrl: 'https://desk.test/requests/1' }],
    })
    expect(mail.html).not.toContain('>Approve</a>')
    expect(mail.html).toContain('Open the request')
    expect(mail.text).toContain('waiting 1 day')
  })
})

describe('the sample e-mail (a test of the reminder)', () => {
  const two = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1, ago(i + 1)))

  it('sends ONE e-mail, to the address asked for only, listing the approver with most waiting', async () => {
    const bela: Person = { id: 'bela', full_name: 'Bela Rao', role: 'user', org_id: 'o1', is_active: true }
    const admin = fakeAdmin({ pending: [{ id: 'a1', workflow_id: 'w1' }], steps: [{ workflow_id: 'w1', approver_user_id: 'ankur' }, { workflow_id: 'w1', approver_user_id: 'bela' }], people: [ankur, bela] })
    const getPending = vi.fn(async (id: string) => (id === 'ankur' ? two(3) : two(1)))
    const r = await sendApprovalReminders(admin as never, { now, getPending, send, sampleTo: 'suraj@citykart.test' })
    expect(send).toHaveBeenCalledTimes(1)
    const mail = send.mock.calls[0][0]
    expect(mail.to).toBe('suraj@citykart.test')
    expect(mail.subject).toContain('[SAMPLE of Ankur Sharma')
    expect(mail.subject).toContain('3 approvals')
    expect(r).toMatchObject({ sent: 1, listed: 3, sampleOf: 'Ankur Sharma' })
  })

  it("does not use up today's run (the real reminders still go out) and e-mails nobody else", async () => {
    const admin = fakeAdmin(world())
    const getPending = vi.fn().mockResolvedValue(two(2))
    await sendApprovalReminders(admin as never, { now, getPending, send, sampleTo: 'suraj@citykart.test' })
    expect(admin.settings[LAST_RUN_KEY]).toBeUndefined()
    send.mockClear()
    const real = await sendApprovalReminders(admin as never, { now, getPending, send })
    expect(real.sent).toBe(1)
    expect(send.mock.calls[0][0].to).toBe('ankur@citykart.test')
  })

  it('sends nothing when nobody has anything waiting', async () => {
    const r = await sendApprovalReminders(fakeAdmin(world()) as never, { now, getPending: vi.fn().mockResolvedValue([]), send, sampleTo: 'suraj@citykart.test' })
    expect(send).not.toHaveBeenCalled()
    expect(r.sent).toBe(0)
  })
})
