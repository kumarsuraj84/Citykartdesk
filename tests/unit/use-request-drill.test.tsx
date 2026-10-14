// @vitest-environment jsdom
// A click on a number of the normal Dashboards page: the Smart Dashboard pop-up opens on the right tickets, a number that cannot be shown that way
// keeps the old side list, and if the ticket data cannot be loaded the click is handed back to the side list so nothing is lost.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const load = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions/analytics-drill', () => ({ loadDrillData: load }))
vi.mock('@/lib/actions/executiveDashboard', () => ({ nudgeTicket: vi.fn(), getExecutiveTicketDetail: vi.fn(async () => ({ error: 'n/a' })) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { useRequestDrill } from '@/components/analytics/useRequestDrill'
import { emptyStoreFilter } from '@/lib/analytics/store-filter'
import type { ExecTicket } from '@/lib/reporting/executive/engine'
import type { DrawerFilter } from '@/lib/actions/analytics'

afterEach(() => { cleanup(); load.mockReset() })

const DAY = 86_400_000
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime()
let n = 0
const tk = (o: Partial<ExecTicket>): ExecTicket => ({
  id: `t${++n}`, no: `CKSD-${3000 + n}`, subject: `Problem ${n}`, group: 'IT Group', tech: 'Mohit', cat: 'AC ISSUE', sub: 'COOLING', svc: 'Repair', req: 'Store A', dept: 'Stores', loc: 'STORES',
  store: 'Store A', state: 'Delhi', oem: '(No OEM)', brand: '(No OEM)', src: 'Portal', cluster: 'UP2', region: 'North', stype: 'Regular', plist: 'ROS', acb: '(Not AC)', amb: '(Not AC)', amv: '(Not AC)',
  ac: '(Not AC)', acTotal: null, acOpen: 0, acPct: null, prio: 'medium', status: 'in_progress', created: NOW - 3 * DAY, resolved: null, closed: null, due: null, tatH: null, breached: false,
  csat: null, reo: [], frH: 1, ...o,
})
const tickets = [
  tk({ due: NOW - DAY, breached: true }), tk({ due: NOW - 2 * DAY, breached: true }), tk({}),
  tk({ created: NOW - 6 * DAY, resolved: NOW - 5 * DAY, tatH: 24, status: 'resolved' }),
]

const env = { period: '30d' as const, periodWindow: { start: NOW - 30 * DAY, end: NOW }, periodLabel: 'last 30 days', groupIds: [], groupName: () => 'IT Group', techName: () => 'Mohit', store: emptyStoreFilter() }

function Harness({ filter, fallback }: { filter: DrawerFilter; fallback: (f: DrawerFilter) => void }) {
  const drill = useRequestDrill(env, fallback)
  return (
    <div>
      <button onClick={() => { const handled = drill.open(filter); document.body.dataset.handled = String(handled) }}>click the number</button>
      {drill.modal}
    </div>
  )
}
const click = () => fireEvent.click(screen.getByText('click the number'))

describe('clicking a number of the normal Dashboards page (the Smart Dashboard pop-up)', () => {
  it('opens the pop-up on exactly the tickets behind the number, after loading them once', async () => {
    load.mockResolvedValue({ now: NOW, tickets, approvals: [], truncated: false })
    const fallback = vi.fn()
    render(<Harness filter={{ title: 'Currently Breached (Open)', description: 'Open requests past their SLA deadline', slaBreached: true }} fallback={fallback} />)
    click()
    expect(document.body.dataset.handled).toBe('true')
    expect(screen.getByRole('status').textContent).toMatch(/Opening/)                 // while the data loads
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Currently Breached (Open)')
    expect(within(dialog).getByText(/Leg 1 of 4/)).toBeTruthy()
    expect(within(dialog).getByText('3. Ticket register').parentElement?.textContent).toMatch(/2 matching tickets/)   // the two breached open tickets
    expect(fallback).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
    // no "apply to the dashboard filters" button: the normal page has no such filters
    expect(within(dialog).queryByText(/Apply this slice/)).toBeNull()
    // the pop-up walks on to the ticket register
    fireEvent.click(within(dialog).getByText('3. Ticket register'))
    expect(within(dialog).getAllByText(/CKSD-/).length).toBeGreaterThanOrEqual(2)
  })

  it('a number it cannot show that way (tasks) is not handled: the caller keeps its own list, and nothing is loaded', () => {
    const fallback = vi.fn()
    render(<Harness filter={{ title: 'Overdue tasks', _module: 'tasks', taskOverdue: true }} fallback={fallback} />)
    click()
    expect(document.body.dataset.handled).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('if the ticket data cannot be loaded, the same click goes back to the side list', async () => {
    load.mockResolvedValue({ error: 'Please sign in again.' })
    const fallback = vi.fn()
    const filter: DrawerFilter = { title: 'Open Requests', status: ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval'] }
    render(<Harness filter={filter} fallback={fallback} />)
    click()
    await waitFor(() => expect(fallback).toHaveBeenCalledWith(filter))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('can be cancelled while loading, and a second click reuses the loaded data', async () => {
    load.mockResolvedValue({ now: NOW, tickets, approvals: [], truncated: false })
    render(<Harness filter={{ title: 'Created', description: 'created', createdInPeriod: true, period: '30d' }} fallback={vi.fn()} />)
    click()
    fireEvent.click(screen.getByLabelText('Cancel'))
    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    click()                                           // data may already be there: no second load
    await screen.findByRole('dialog')
    expect(load).toHaveBeenCalledTimes(1)
  })
})
