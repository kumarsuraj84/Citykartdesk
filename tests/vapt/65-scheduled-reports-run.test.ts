// The automatic sender of the scheduled reports (lib/reports/run-due.ts), on the isolated audit stack (mail goes to a recorder):
//  - a report that is due is sent once, as a CSV, to its recipients; one that is not due, switched off, made after the slot, or without recipients is not;
//  - two runs at the same moment (two cron ticks) send a report ONCE (the report is claimed before it is sent);
//  - a report nobody could be reached for is tried again at the next run, inside 6 hours of its slot; after that it waits for the next slot;
//  - a report that reached some people and failed for another is NOT sent again (the first ones would get it twice);
//  - a report that was never sent and is long overdue (the server was off) is sent once.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { setupD03Fixtures, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
type Sent = { to: string; subject: string; attachments?: { filename: string; content: string }[] }
const sent: Sent[] = []
const failFor = new Set<string>()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (p: Sent) => {
    if (failFor.has(p.to)) return { error: 'the mail server refused this address' }
    sent.push(p)
    return {}
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { runDueScheduledReports } from '@/lib/reports/run-due'
import { latestSlot } from '@/lib/reports/schedule'

vi.setConfig({ testTimeout: 180_000 })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t65${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const made: string[] = []
// Friday 30 Oct 2026, 09:00 India time: today's daily slot (07:00) has passed
const NOW = new Date('2026-10-30T09:00:00+05:30')
const SLOT = latestSlot('daily', NOW)

async function report(name: string, over: Record<string, unknown> = {}) {
  const row = (await db().from('scheduled_reports').insert({
    org_id: fx.orgId, name: `${tag} ${name}`, report_type: 'tasks', frequency: 'daily', recipients: [fx.agentA.email], filters: {}, is_active: true,
    created_at: '2026-01-01T00:00:00Z', last_sent_at: null, ...over,
  }).select('id').single()).data
  made.push(row.id)
  return row.id as string
}
const lastSent = async (id: string) => (await db().from('scheduled_reports').select('last_sent_at').eq('id', id).single()).data.last_sent_at as string | null
const mailsFor = (name: string) => sent.filter((m) => m.subject.includes(`${tag} ${name}`))

beforeAll(async () => { fx = await setupD03Fixtures() }, 240_000)
afterAll(async () => {
  if (made.length) await db().from('scheduled_reports').delete().in('id', made)
  await fx?.cleanup()
}, 120_000)
beforeEach(() => { sent.length = 0; failFor.clear() })

describe('which reports are sent', () => {
  it('a due report goes to its recipients once, as a CSV; not-due, switched-off, new and recipient-less ones do not', async () => {
    const due = await report('due', { recipients: [fx.agentA.email, fx.manager.email] })
    const doneToday = await report('done today', { last_sent_at: new Date(SLOT.getTime() + 300_000).toISOString() })
    const off = await report('off', { is_active: false })
    const brandNew = await report('brand new', { created_at: new Date(SLOT.getTime() + 3_600_000).toISOString() })   // made after today's 07:00
    const nobody = await report('nobody', { recipients: [] })
    const weeklyDone = await report('weekly done', { frequency: 'weekly', last_sent_at: '2026-10-27T10:00:00Z' })    // sent on Tuesday: this week's Monday slot is behind it
    const weeklyDue = await report('weekly due', { frequency: 'weekly', last_sent_at: '2026-10-19T10:00:00Z' })

    const r = await runDueScheduledReports(db(), NOW)
    expect(r.failed.filter((f) => f.name.startsWith(tag))).toEqual([])
    const m = mailsFor('due').filter((x) => x.subject.endsWith(`${tag} due`))
    expect(m.map((x) => x.to).sort()).toEqual([fx.agentA.email, fx.manager.email].sort())
    expect(m[0].attachments?.[0].filename).toMatch(/^tasks-report-.*\.csv$/)
    expect(Buffer.from(m[0].attachments![0].content, 'base64').toString().length).toBeGreaterThan(0)
    expect(new Date((await lastSent(due))!).getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 1000)   // claimed at this run
    expect(mailsFor('weekly due')).toHaveLength(1)
    for (const name of ['done today', 'off', 'brand new', 'nobody', 'weekly done']) expect(mailsFor(name), name).toHaveLength(0)
    expect(await lastSent(off)).toBeNull(); expect(await lastSent(brandNew)).toBeNull(); expect(await lastSent(nobody)).toBeNull()
    const at = async (id: string) => new Date((await lastSent(id))!).getTime()
    expect(await at(doneToday)).toBe(SLOT.getTime() + 300_000)                    // not touched
    expect(await at(weeklyDone)).toBe(Date.parse('2026-10-27T10:00:00Z'))
    expect(await at(weeklyDue)).toBeGreaterThan(Date.parse('2026-10-19T10:00:00Z'))
  })

  it('a second run, and two runs at the same moment, send a report ONCE', async () => {
    await report('twice')
    await Promise.all([runDueScheduledReports(db(), NOW), runDueScheduledReports(db(), NOW)])
    expect(mailsFor('twice')).toHaveLength(1)
    await runDueScheduledReports(db(), new Date(NOW.getTime() + 1_800_000))   // 30 minutes later
    expect(mailsFor('twice')).toHaveLength(1)
  })

  it('the next day it is due again; a report long overdue (never sent) is sent once', async () => {
    const id = await report('next day')
    await runDueScheduledReports(db(), NOW)
    expect(mailsFor('next day')).toHaveLength(1)
    await runDueScheduledReports(db(), new Date('2026-10-31T09:00:00+05:30'))
    expect(mailsFor('next day')).toHaveLength(2)
    expect(id).toBeTruthy()
    await report('long overdue')
    await runDueScheduledReports(db(), new Date('2026-12-15T09:00:00+05:30'))   // the server was off for weeks
    expect(mailsFor('long overdue')).toHaveLength(1)
  })
})

describe('a report that could not be sent', () => {
  it('nobody reached: tried again at the next run (inside 6 hours of the slot), then sent', async () => {
    const id = await report('refused')
    failFor.add(fx.agentA.email)
    const first = await runDueScheduledReports(db(), NOW)
    expect(first.failed.some((f) => f.name === `${tag} refused`)).toBe(true)
    expect(await lastSent(id)).toBeNull()                                          // the claim was given back
    failFor.clear()
    await runDueScheduledReports(db(), new Date(NOW.getTime() + 1_800_000))
    expect(mailsFor('refused')).toHaveLength(1)
    expect(await lastSent(id)).not.toBeNull()
  })

  it('past 6 hours after the slot a total failure is not retried until the next slot', async () => {
    const late = new Date(SLOT.getTime() + 7 * 3_600_000)
    const id = await report('too late')
    failFor.add(fx.agentA.email)
    await runDueScheduledReports(db(), late)
    expect(await lastSent(id)).not.toBeNull()                                      // not given back: it waits
    failFor.clear()
    await runDueScheduledReports(db(), new Date(late.getTime() + 1_800_000))
    expect(mailsFor('too late')).toHaveLength(0)
    await runDueScheduledReports(db(), new Date('2026-10-31T09:00:00+05:30'))        // the next slot
    expect(mailsFor('too late')).toHaveLength(1)
  })

  it('some people reached, one refused: the report is NOT sent again (the first would get it twice)', async () => {
    const id = await report('partial', { recipients: [fx.agentA.email, fx.manager.email] })
    failFor.add(fx.manager.email)
    const r = await runDueScheduledReports(db(), NOW)
    expect(r.failed.some((f) => f.name === `${tag} partial`)).toBe(true)
    expect(mailsFor('partial').map((m) => m.to)).toEqual([fx.agentA.email])
    expect(await lastSent(id)).not.toBeNull()
    failFor.clear()
    await runDueScheduledReports(db(), new Date(NOW.getTime() + 1_800_000))
    expect(mailsFor('partial')).toHaveLength(1)
  })
})
