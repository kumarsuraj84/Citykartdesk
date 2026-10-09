// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const nudgeMock = vi.hoisted(() => vi.fn(async (): Promise<{ error: string } | { sent: number; names: string[] }> => ({ sent: 1, names: ['Krishan'] })))
vi.mock('@/lib/actions/executiveDashboard', () => ({
  nudgeTicket: nudgeMock,
  getExecutiveTicketDetail: vi.fn(async (id: string) => ({
    detail: {
      id, no: 'CKSD-2001', subject: 'AC not cooling', description: '', status: 'in_progress', priority: 'high', group: 'ADMIN GROUP', technician: 'Krishan',
      requester: 'Store A', department: '', store: 'Store A', oem: 'LG OEM - ALL', brand: 'LG', service: 'Admin repair', category: 'AC', subCategory: 'COOLING',
      created: 1_000_000, responded: 1_000_000 + 3_600_000, resolved: null, resolutionDue: 1_000_000 + 86_400_000, responseDue: 1_000_000 + 4 * 3_600_000, reopenCount: 0,
      csat: null, source: 'Portal', storeState: 'Delhi', closed: null, assignedAt: 1_000_000 + 1_800_000, approval: null,
      events: [{ at: 1_000_000, label: 'Ticket raised', by: 'Store A', note: '' }], canNudge: true,
    },
  })),
  exportTicketDetailReportXlsx: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ExecutiveDashboard } from '@/components/executive/ExecutiveDashboard'
import type { ExecTicket } from '@/lib/reporting/executive/engine'

afterEach(() => cleanup())

const DAY = 86_400_000
const NOW = new Date(2026, 9, 8, 17, 0, 0).getTime()
let n = 0
const tk = (o: Partial<ExecTicket>): ExecTicket => ({
  id: `t${++n}`, no: `CKSD-${2000 + n}`, subject: 'AC not cooling', group: 'ADMIN GROUP', tech: 'Krishan', cat: 'AC ISSUE', sub: 'COOLING', svc: 'Admin repair',
  req: 'Store A', dept: 'Stores', loc: 'STORES', store: 'Store A', state: 'Delhi', oem: 'LG OEM - ALL', brand: 'LG', src: 'Portal',
  prio: 'medium', status: 'in_progress', created: NOW - 3 * DAY, resolved: null, due: null, tatH: null, breached: false, csat: null, reo: [], frH: 1, ...o,
})
const tickets = [
  tk({ breached: true }), tk({}), tk({ tech: 'Mohit', group: 'IT Group', store: 'Store B', brand: 'DAIKIN', oem: 'DAIKIN OEM - ALL', created: NOW - 5 * DAY, subject: 'Printer jam' }),
  tk({ created: NOW - 6 * DAY, resolved: NOW - 5 * DAY, tatH: 24, status: 'resolved' }),
]

const view = (level: 'admin' | 'requester' | 'technician' = 'admin') =>
  render(<ExecutiveDashboard level={level} me="Krishan" now={NOW} tickets={tickets} approvals={[]} truncated={false} />)
// the number cards are clickable <div role="button">s
const kpi = (name: RegExp) => Array.from(document.querySelectorAll<HTMLElement>('#kpi-scorecard [role="button"]')).find((e) => name.test(e.textContent ?? ''))!

describe('Smart Dashboard', () => {
  it('shows the command bar, the four highlights and the two tiers of number cards', () => {
    view()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Executive Dashboard')
    expect(screen.getByText(/Priority highlights/i)).toBeTruthy()
    expect(screen.getByText('SLA RISK')).toBeTruthy()
    expect(screen.getByText('WORKLOAD')).toBeTruthy()
    expect(screen.getByText('OEM / STORE EQUIPMENT')).toBeTruthy()
    expect(screen.getByText('APPROVALS')).toBeTruthy()
    expect(screen.getByText('OPEN BACKLOG')).toBeTruthy()
    expect(screen.getByText('SLA BREACHES')).toBeTruthy()
    expect(screen.getByText('Custom Dates')).toBeTruthy()
  })

  it('opens the drill-down pop-up when a number is clicked, instead of filtering', () => {
    view()
    fireEvent.click(kpi(/OPEN BACKLOG/))
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText(/Leg 1 of 4/)).toBeTruthy()
    expect(screen.queryByText(/Active filters:/)).toBeNull()
  })

  it('goes cohort → stores & technicians → tickets → last leg', async () => {
    view()
    fireEvent.click(kpi(/CREATED/))
    let dlg = screen.getByRole('dialog')
    fireEvent.click(within(dlg).getByText('ADMIN GROUP').closest('button')!)
    expect(within(dlg).getByText(/Leg 2 of 4/)).toBeTruthy()
    expect(within(dlg).getByText(/Impacted stores/)).toBeTruthy()
    fireEvent.click(within(dlg).getByText('Store A').closest('button')!)
    expect(within(dlg).getByText(/Leg 3 of 4/)).toBeTruthy()
    fireEvent.click(within(dlg).getAllByText(/CKSD-/)[0].closest('tr')!)
    dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText(/Leg 4 of 4/)).toBeTruthy()
    expect(await within(dlg).findByText('End-to-end ticket lifecycle audit')).toBeTruthy()
    expect(within(dlg).getByText('Store intake')).toBeTruthy()
    expect(within(dlg).getByText('First response')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the last leg lets a manager nudge the technician, with an optional message, and shows the outcome', async () => {
    nudgeMock.mockClear()
    view()
    fireEvent.click(screen.getByText('Heatmap & Tickets'))
    fireEvent.change(screen.getByLabelText('Search tickets'), { target: { value: 'printer' } })
    fireEvent.click(within(document.getElementById('explorer-section')!).getByText('Printer jam').closest('tr')!)
    const dlg = screen.getByRole('dialog')
    expect(await within(dlg).findByText(/Send/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: /Nudge/ }))
    fireEvent.change(within(dlg).getByLabelText(/short message/), { target: { value: 'Store is waiting' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Send reminder' }))
    expect(await within(dlg).findByText('Reminder sent to Krishan.')).toBeTruthy()
    expect(nudgeMock).toHaveBeenCalledWith(expect.any(String), 'Store is waiting')
  })

  it('shows the reason the server gave when a nudge is refused', async () => {
    nudgeMock.mockResolvedValueOnce({ error: 'This ticket was already nudged 5 minutes ago by Asha.' })
    view()
    fireEvent.click(screen.getByText('Heatmap & Tickets'))
    fireEvent.change(screen.getByLabelText('Search tickets'), { target: { value: 'printer' } })
    fireEvent.click(within(document.getElementById('explorer-section')!).getByText('Printer jam').closest('tr')!)
    const dlg = screen.getByRole('dialog')
    fireEvent.click(await within(dlg).findByRole('button', { name: /Nudge/ }))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Send reminder' }))
    expect((await within(dlg).findByRole('alert')).textContent).toMatch(/already nudged 5 minutes ago/)
  })

  it('with a group picked, the tables, OEM boxes and pop-ups stay inside that group', () => {
    const noOem = { brand: '(No OEM)', oem: '(No OEM)' }
    const data = [
      tk({ group: 'IT Group', tech: 'Mohit', store: 'Store B', ...noOem }),
      tk({ group: 'IT Group', tech: 'Mohit', store: 'Store C', ...noOem }),
      tk({ group: 'ADMIN GROUP', tech: 'Krishan', brand: 'LG' }),
      tk({ group: 'HR GROUP', tech: 'Asha', store: 'Store D', ...noOem }),
    ]
    render(<ExecutiveDashboard level="admin" me="Krishan" now={NOW} tickets={data} approvals={[]} truncated={false} />)
    fireEvent.click(screen.getByLabelText('Filter by group'))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Filter by group choices' })).getByLabelText(/IT Group/))
    expect(screen.getByText('Group: IT Group ×')).toBeTruthy()

    // the other departments are gone from the comparison tables
    fireEvent.click(screen.getByText('Group & OEM Matrix'))
    const matrices = document.getElementById('matrices-section')!
    expect(within(matrices).getAllByText('IT Group').length).toBeGreaterThan(0)
    expect(within(matrices).queryByText('ADMIN GROUP')).toBeNull()
    expect(within(matrices).queryByText('HR GROUP')).toBeNull()
    // and no OEM views for tickets that are not equipment requests
    expect(within(matrices).queryByText(/OEM-wise/)).toBeNull()
    expect(within(matrices).getByText('Store-wise tickets')).toBeTruthy()
    expect(screen.queryByText('OEM / STORE EQUIPMENT')).toBeNull()
    expect(screen.queryByLabelText('Filter by OEM brand')).toBeNull()

    // the pop-up only holds IT Group tickets, and only IT's technician
    fireEvent.click(kpi(/CREATED/))
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getAllByText('IT Group').length).toBeGreaterThan(0)
    expect(within(dlg).queryByText('ADMIN GROUP')).toBeNull()
    expect(within(dlg).queryByText('HR GROUP')).toBeNull()
    expect(within(dlg).queryByText('Krishan')).toBeNull()
    expect(within(dlg).queryByText('Asha')).toBeNull()
    // no OEM list for non-equipment tickets: a category list takes its place
    expect(within(dlg).queryByText('Drill down by store OEM equipment')).toBeNull()
    expect(within(dlg).getByText('Drill down by category')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    // and the leaderboard offers no OEM comparison either
    fireEvent.click(screen.getByText('Workload & Approvals'))
    const by = screen.getByLabelText('Leaderboard by') as HTMLSelectElement
    expect(Array.from(by.options).map((o) => o.textContent)).not.toContain('OEM brand')
  })

  it('an equipment group (tickets with an OEM) keeps its OEM views', () => {
    const data = [
      tk({ group: 'ADMIN GROUP', tech: 'Krishan', brand: 'LG', oem: 'LG OEM - ALL' }),
      tk({ group: 'ADMIN GROUP', tech: 'Krishan', brand: 'DAIKIN', oem: 'DAIKIN OEM - ALL' }),
      tk({ group: 'IT Group', tech: 'Mohit', brand: '(No OEM)', oem: '(No OEM)' }),
    ]
    render(<ExecutiveDashboard level="admin" me="Krishan" now={NOW} tickets={data} approvals={[]} truncated={false} />)
    fireEvent.click(screen.getByLabelText('Filter by group'))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Filter by group choices' })).getByLabelText(/ADMIN GROUP/))
    fireEvent.click(screen.getByText('Group & OEM Matrix'))
    const matrices = document.getElementById('matrices-section')!
    expect(within(matrices).getByText('OEM-wise tickets - store equipment')).toBeTruthy()
    expect(within(matrices).queryByText('IT Group')).toBeNull()
    expect(screen.getByText('OEM / STORE EQUIPMENT')).toBeTruthy()
    expect(screen.getByLabelText('Filter by OEM brand')).toBeTruthy()
  })

  it('can jump straight to the ticket register and step back with the arrow', () => {
    view()
    fireEvent.click(kpi(/CREATED/))
    const dlg = screen.getByRole('dialog')
    fireEvent.click(within(dlg).getByText(/View 4 tickets/).closest('button')!)
    expect(within(dlg).getByText(/Leg 3 of 4/)).toBeTruthy()
    fireEvent.click(within(dlg).getByLabelText('Go back one leg'))
    expect(within(dlg).getByText(/Leg 2 of 4/)).toBeTruthy()
  })

  it('copies the slice picked in the pop-up into the dashboard filters', () => {
    view()
    fireEvent.click(kpi(/CREATED/))
    const dlg = screen.getByRole('dialog')
    fireEvent.click(within(dlg).getByText('IT Group').closest('button')!)
    fireEvent.click(within(dlg).getByText('Apply this slice to the dashboard filters'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Group: IT Group ×')).toBeTruthy()
    expect(screen.getByText(/1 of 4 tickets match/)).toBeTruthy()
  })

  it('filters from the Filters pop-up and removes the pill again', () => {
    view()
    fireEvent.click(screen.getByText('Filters').closest('button')!)
    const modal = screen.getByRole('dialog', { name: 'Dashboard filters' })
    fireEvent.click(within(modal).getByText('DAIKIN').closest('button')!)
    fireEvent.click(within(modal).getByText('Apply filters'))
    expect(screen.getByText('OEM brand: DAIKIN ×')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove OEM brand: DAIKIN'))
    expect(screen.queryByText('OEM brand: DAIKIN ×')).toBeNull()
  })

  it('filters from the quick drop-downs, including SLA state', () => {
    view()
    fireEvent.change(screen.getByLabelText('Filter by SLA'), { target: { value: 'breached' } })
    expect(screen.getByText('SLA: breached only ×')).toBeTruthy()
    expect(screen.getByText(/1 of 4 tickets match/)).toBeTruthy()
  })

  it('lets several values be ticked in a filter, with their list following the other filters', () => {
    view()
    // pick the IT group: the technician list shrinks to that group's technicians
    fireEvent.click(screen.getByLabelText('Filter by group'))
    const groups = screen.getByRole('listbox', { name: 'Filter by group choices' })
    fireEvent.click(within(groups).getByLabelText(/IT Group/))
    fireEvent.click(within(groups).getByText('Done'))
    fireEvent.click(screen.getByLabelText('Filter by technician'))
    let techs = screen.getByRole('listbox', { name: 'Filter by technician choices' })
    expect(within(techs).queryByLabelText(/Krishan/)).toBeNull()
    expect(within(techs).getByLabelText(/Mohit/)).toBeTruthy()
    fireEvent.click(within(techs).getByText('Done'))
    // add the ADMIN GROUP as well: both groups' technicians are offered
    fireEvent.click(screen.getByLabelText('Filter by group'))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Filter by group choices' })).getByLabelText(/ADMIN GROUP/))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Filter by group choices' })).getByText('Done'))
    expect(screen.getByText('Group: IT Group ×')).toBeTruthy()
    expect(screen.getByText('Group: ADMIN GROUP ×')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Filter by technician'))
    techs = screen.getByRole('listbox', { name: 'Filter by technician choices' })
    expect(within(techs).getByLabelText(/Krishan/)).toBeTruthy()
    expect(within(techs).getByLabelText(/Mohit/)).toBeTruthy()
  })

  it('narrows the group list to the chosen technician', () => {
    view()
    fireEvent.click(screen.getByLabelText('Filter by technician'))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Filter by technician choices' })).getByLabelText(/Mohit/))
    fireEvent.click(screen.getByLabelText('Filter by group'))
    const groups = screen.getByRole('listbox', { name: 'Filter by group choices' })
    expect(within(groups).getByLabelText(/IT Group/)).toBeTruthy()
    expect(within(groups).queryByLabelText(/ADMIN GROUP/)).toBeNull()
  })

  it('opens the approvals waiting for a decision even when a status filter hides their tickets (they sit in "Pending approval")', () => {
    const gated = [tk({ status: 'pending_approval', subject: 'Gated one' }), tk({ status: 'pending_approval', subject: 'Gated two' })]
    const approvals = gated.map((t, i) => ({ id: `a${i}`, reqId: t.id, status: 'pending' as const, requested: NOW - 2 * DAY, decided: null, by: '' }))
    render(<ExecutiveDashboard level="admin" me="Krishan" now={NOW} tickets={[...tickets, ...gated]} approvals={approvals} truncated={false} />)
    fireEvent.click(screen.getByLabelText('Filter by status'))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Filter by status choices' })).getByText('In Progress'))
    expect(screen.getByText('Status: In Progress ×')).toBeTruthy()
    fireEvent.click(kpi(/APPROVALS WAITING/))
    const dlg = screen.getByRole('dialog')
    fireEvent.click(within(dlg).getByText(/View 2 tickets/).closest('button')!)
    expect(within(dlg).getByText(/Leg 3 of 4/)).toBeTruthy()
    expect(within(dlg).getByText('Gated one')).toBeTruthy()
    expect(within(dlg).getByText('Gated two')).toBeTruthy()
    expect(within(dlg).queryByText('No tickets match this slice.')).toBeNull()
  })

  it('picks every "on hold" status with one click', () => {
    const held = [tk({ status: 'hold_purchase_ho' }), tk({ status: 'waiting_user' })]
    render(<ExecutiveDashboard level="admin" me="Krishan" now={NOW} tickets={[...tickets, ...held]} approvals={[]} truncated={false} />)
    fireEvent.click(screen.getByLabelText('Filter by status'))
    const box = screen.getByRole('listbox', { name: 'Filter by status choices' })
    fireEvent.click(within(box).getByText('On hold'))
    expect(screen.getByText('Status: Waiting on User ×')).toBeTruthy()
    expect(screen.getByText('Status: Hold - Purchase from HO ×')).toBeTruthy()
    expect(screen.getByText(/2 of 6 tickets match/)).toBeTruthy()
  })

  it('searches tickets from the filter bar and shows it as a filter', () => {
    view()
    fireEvent.change(screen.getByLabelText('Search tickets'), { target: { value: 'printer' } })
    expect(screen.getByText('Search: “printer” ×')).toBeTruthy()
    expect(screen.getByText(/1 of 4 tickets match/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove Search: “printer”'))
    expect(screen.queryByText('Search: “printer” ×')).toBeNull()
  })

  it('applies a custom date range from the pop-over', () => {
    view()
    fireEvent.click(screen.getByText('Custom Dates').closest('button')!)
    const pop = screen.getByRole('dialog', { name: 'Select a custom date range' })
    fireEvent.click(within(pop).getByText(/Last 14 days/).closest('button')!)
    fireEvent.click(within(pop).getByText('Apply custom dates'))
    expect(screen.getByText(/Custom dates: 2026-09-25 to 2026-10-08/)).toBeTruthy()
  })

  it('shows only the chosen lens when a view tab is picked', () => {
    view()
    expect(document.getElementById('velocity-section')).toBeTruthy()
    fireEvent.click(screen.getByText('Heatmap & Tickets'))
    expect(document.getElementById('velocity-section')).toBeNull()
    expect(document.getElementById('explorer-section')).toBeTruthy()
    expect(document.getElementById('kpi-scorecard')).toBeTruthy()
    fireEvent.click(screen.getByText('Full Executive Flow'))
    expect(document.getElementById('velocity-section')).toBeTruthy()
  })

  it('searches the ticket list and opens a ticket straight at the last leg', async () => {
    view()
    fireEvent.click(screen.getByText('Heatmap & Tickets'))
    fireEvent.change(screen.getByLabelText('Search tickets'), { target: { value: 'printer' } })
    const list = document.getElementById('explorer-section')!
    fireEvent.click(within(list).getByText('Printer jam').closest('tr')!)
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByText(/Leg 4 of 4/)).toBeTruthy()
    expect(await within(dlg).findByText('Store intake')).toBeTruthy()
  })

  it('titles the page for each level and hides people views from requesters', () => {
    const { unmount } = view('requester')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My Requests Dashboard')
    expect(screen.queryByText('WORKLOAD')).toBeNull()
    expect(screen.queryByLabelText('Filter by technician')).toBeNull()
    unmount()
    view('technician')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Technician Dashboard')
    expect(screen.getByLabelText('Filter by technician')).toBeTruthy()
  })

  it('switches the chart to the number that was clicked', () => {
    view()
    fireEvent.click(kpi(/OPEN BACKLOG/))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByText(/Open backlog - by day/)).toBeTruthy()
  })
})
