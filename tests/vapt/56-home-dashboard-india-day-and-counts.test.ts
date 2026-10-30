// Migration 193: the Home dashboard function counts by the INDIA day and returns the real totals (audit F-04/D-03, D-02/F-02, F-05, D-16, F-34).
//  - "today" / "overdue" / "upcoming" tasks follow the India day, not the database session's own day (checked with the session set to Phoenix, UTC-7);
//  - sla_breached does not count a ticket whose clock is stopped (waiting_user / hold_purchase_ho / pending_approval);
//  - my_queue_count is the whole open queue while my_queue is only a preview of the newest 10; the four task bucket totals are the real size of the lists (which show at most 6);
//  - the "due today" list shows the highest priority first.
// Runs on the isolated audit stack only (see vitest.remediation.config.ts); it makes its own rows and removes them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdmin() as any
const tag = `t56${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const madeTasks: string[] = []
const madeRequests: string[] = []

/** The India calendar day, n days from today, as a date text. */
const istDay = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function home(): Promise<any> {
  const { data, error } = await clientForToken(fx.agentA.accessToken).rpc('get_home_dashboard', { p_is_manager: false, p_is_agent: true, p_team_id: fx.teamA.id, p_has_tasks: true })
  expect(error).toBeNull()
  return data
}

async function task(title: string, due: string | null, priority: 'low' | 'medium' | 'high' = 'low') {
  const { data, error } = await db().from('tasks').insert({ title: `${tag} ${title}`, org_id: fx.orgId, created_by: fx.agentA.id, assignee_id: fx.agentA.id, team_id: fx.teamA.id, due_date: due, status: 'open', priority }).select('id').single()
  expect(error).toBeNull()
  madeTasks.push(data.id)
}

async function ticket(status: string, dueMinutesAgo: number) {
  const { data, error } = await db().from('requests').insert({
    request_no: '', title: `${tag} ticket`, requester_id: fx.requesterA.id, service_id: fx.teamA.serviceId, team_id: fx.teamA.id, assigned_to: fx.agentA.id, status,
    resolution_due_at: new Date(Date.now() - dueMinutesAgo * 60_000).toISOString(),
  }).select('id').single()
  expect(error).toBeNull()
  madeRequests.push(data.id)
}

beforeAll(async () => { fx = await setupD03Fixtures() })
afterAll(async () => {
  if (madeTasks.length) await db().from('tasks').delete().in('id', madeTasks)
  if (madeRequests.length) await db().from('requests').delete().in('id', madeRequests)
  await fx?.cleanup()
})

describe('Home dashboard: India day, paused tickets, real counts', () => {
  it('counts tasks by the India day and lists the highest priority first', async () => {
    // the person may already have tasks left in the test database from other runs: what is checked is what these five add
    const before = (await home()).counts
    await task('today-low', istDay(0), 'low')
    await task('today-high', istDay(0), 'high')
    await task('yesterday', istDay(-1))
    await task('tomorrow', istDay(1))
    await task('no-date', null)
    const h = await home()
    expect(h.counts.tasks_today_total - before.tasks_today_total).toBe(2)
    expect(h.counts.tasks_overdue_total - before.tasks_overdue_total).toBe(1)
    expect(h.counts.tasks_upcoming_total - before.tasks_upcoming_total).toBe(1)
    expect(h.counts.tasks_no_due_total - before.tasks_no_due_total).toBe(1)
    const todayTitles = (h.tasks_today as { title: string; priority: string }[]).map((t) => t.priority)
    expect(todayTitles.indexOf('high')).toBeLessThan(todayTitles.indexOf('low'))
  })

  it('the bucket totals are the real size when the lists are capped at 6', async () => {
    for (let i = 0; i < 8; i++) await task(`overdue-${i}`, istDay(-2))
    const h = await home()
    expect(h.tasks_overdue.length).toBe(6)
    expect(h.counts.tasks_overdue_total).toBeGreaterThanOrEqual(9)
  })

  it('sla_breached leaves out a ticket whose clock is stopped; my_queue_count is the whole queue', async () => {
    const before = await home()
    await ticket('in_progress', 60)
    await ticket('waiting_user', 60)
    await ticket('pending_approval', 60)
    const after = await home()
    expect(after.counts.sla_breached - before.counts.sla_breached).toBe(1)
    expect(after.counts.my_queue_count - before.counts.my_queue_count).toBe(3)
    for (let i = 0; i < 10; i++) await ticket('open', 1)
    const full = await home()
    expect(full.my_queue.length).toBe(10)
    expect(full.counts.my_queue_count).toBeGreaterThan(10)
  })
})
