// The daily approval reminder against the audit database, through the real queries (no e-mail is sent: the sender is a stand-in that records the message).
// Synthetic approvals are made for two synthetic approvers (Ankur and Bela) on the audit database's own tickets, and removed afterwards. Checks the cases that
// matter: nobody decided (everything is listed), one approver of two decided (the other's list drops it), a ticket sent to one person only, a decided approval
// (never listed), a second call the same day (sends nothing) and a day on which nothing could be sent (not used up).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { svc, createUser, deleteUser, ORG_A, type Session } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendApprovalReminders, LAST_RUN_KEY } from '@/lib/approvals/reminders'

vi.setConfig({ testTimeout: 180_000 })

let ankur: Session
let bela: Session
let tickets: { id: string; request_no: string }[] = []
const approvalIds: string[] = []
const workflowIds: string[] = []

/** one approval for these approvers on a ticket (several approvers = asked at once: whoever answers first decides) */
async function makeApproval(ticket: { id: string }, approvers: Session[], status: 'pending' | 'approved' = 'pending') {
  const wf = await svc<{ id: string }[]>('POST', '/approval_workflows', { name: 'Reminder test', org_id: ORG_A }, { Prefer: 'return=representation' })
  const workflowId = wf.json[0].id
  workflowIds.push(workflowId)
  await svc('POST', '/approval_workflow_steps', approvers.map((a, i) => ({ workflow_id: workflowId, step_order: i + 1, approver_type: 'specific_user', approver_user_id: a.id })))
  const ap = await svc<{ id: string }[]>('POST', '/approvals', { request_id: ticket.id, workflow_id: workflowId, status, current_step: 0 }, { Prefer: 'return=representation' })
  expect(ap.status, ap.text).toBeLessThan(300)
  approvalIds.push(ap.json[0].id)
  return ap.json[0].id
}

const now = () => new Date(Date.now() + 5 * 86_400_000)             // well after the synthetic approvals, so each counts as an old one
const clearDay = () => svc('DELETE', `/app_settings?key=eq.${LAST_RUN_KEY}`)

async function run(deliver: { to: string; subject: string; html: string }[]) {
  return sendApprovalReminders(createAdminClient() as never, { now: now(), send: async (m) => { deliver.push(m); return {} } })
}
const mailFor = (sent: { to: string; subject: string; html: string }[], s: Session) => sent.find((m) => m.to === s.email)

beforeAll(async () => {
  const stamp = Date.now()
  ankur = await createUser(`rem-ankur-${stamp}@audit.test`, 'Ankur Reminder')
  bela = await createUser(`rem-bela-${stamp}@audit.test`, 'Bela Reminder')
  for (const u of [ankur, bela]) await svc('PATCH', `/profiles?id=eq.${u.id}`, { org_id: ORG_A })
  const t = await svc<{ id: string; request_no: string }[]>('GET', `/requests?select=id,request_no&org_id=eq.${ORG_A}&status=in.(open,in_progress)&order=request_no.asc&limit=6`)
  tickets = t.json
  expect(tickets.length).toBe(6)
}, 240_000)

afterAll(async () => {
  for (const id of approvalIds) await svc('DELETE', `/approvals?id=eq.${id}`)
  for (const id of workflowIds) await svc('DELETE', `/approval_workflows?id=eq.${id}`)
  await clearDay()
  for (const u of [ankur, bela]) if (u) await deleteUser(u.id)
}, 120_000)

describe('the approval reminder on the audit database', () => {
  it('each approver gets one e-mail listing what is waiting for them; a decided approval and one decided by the other approver drop out', async () => {
    await clearDay()
    // tickets 0, 1, 2: sent to Ankur and Bela together; ticket 3: to Ankur only; ticket 4: already approved (Ankur was asked)
    for (const i of [0, 1, 2]) await makeApproval(tickets[i], [ankur, bela])
    await makeApproval(tickets[3], [ankur])
    await makeApproval(tickets[4], [ankur], 'approved')

    const sent: { to: string; subject: string; html: string }[] = []
    const first = await run(sent)
    expect(first.failed).toBe(0)

    const toAnkur = mailFor(sent, ankur)!
    const toBela = mailFor(sent, bela)!
    expect(toAnkur.subject).toBe('Reminder: 4 approvals are waiting for you')
    for (const i of [0, 1, 2, 3]) expect(toAnkur.html).toContain(tickets[i].request_no)
    expect(toAnkur.html).not.toContain(tickets[4].request_no)                // already decided
    expect(toBela.subject).toBe('Reminder: 3 approvals are waiting for you')
    expect(toBela.html).not.toContain(tickets[3].request_no)                 // never sent to Bela
    expect(sent.filter((m) => m.to === ankur.email)).toHaveLength(1)         // one e-mail, not one per ticket
  })

  it('once one of two approvers decides a ticket, neither is reminded about it', async () => {
    await clearDay()
    await svc('PATCH', `/approvals?id=eq.${approvalIds[0]}`, { status: 'approved' })      // Bela approved the first ticket
    const sent: { to: string; subject: string; html: string }[] = []
    await run(sent)
    for (const who of [ankur, bela]) expect(mailFor(sent, who)!.html).not.toContain(tickets[0].request_no)
    expect(mailFor(sent, bela)!.subject).toBe('Reminder: 2 approvals are waiting for you')
    expect(mailFor(sent, ankur)!.subject).toBe('Reminder: 3 approvals are waiting for you')
  })

  it('when everything waiting for someone is decided they get nothing', async () => {
    await clearDay()
    for (const id of approvalIds) await svc('PATCH', `/approvals?id=eq.${id}`, { status: 'approved' })
    const sent: { to: string; subject: string; html: string }[] = []
    await run(sent)
    expect(mailFor(sent, ankur)).toBeUndefined()
    expect(mailFor(sent, bela)).toBeUndefined()
  })

  it('a second call the same day sends nothing; a day on which nothing could be sent is not used up', async () => {
    await clearDay()
    await svc('PATCH', `/approvals?id=eq.${approvalIds[1]}`, { status: 'pending' })
    const sent: { to: string; subject: string; html: string }[] = []
    expect((await run(sent)).sent).toBeGreaterThan(0)
    const before = sent.length
    expect((await run(sent)).alreadyRan).toBe(true)
    expect(sent.length).toBe(before)

    await clearDay()
    const down = await sendApprovalReminders(createAdminClient() as never, { now: now(), send: async () => ({ error: 'mail server down' }) })
    expect(down.sent).toBe(0)
    expect(down.failed).toBeGreaterThan(0)
    expect((await run(sent)).alreadyRan).toBeUndefined()                      // the day was not used up
  })
})
