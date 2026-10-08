// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/lib/actions/executiveDashboard', () => ({
  getExecutiveTicketDetail: vi.fn(async (id: string) => ({
    detail: {
      id, no: 'CKSD-1001', subject: 'AC not cooling', description: '', status: 'in_progress', priority: 'high', group: 'ADMIN GROUP', technician: 'Krishan',
      requester: 'Store A', department: '', store: 'Store A', oem: 'LG OEM - ALL', brand: 'LG', service: 'Admin repair', category: 'AC', subCategory: 'COOLING',
      created: 1, responded: null, resolved: null, resolutionDue: null, responseDue: null, reopenCount: 0, csat: null,
      events: [{ at: 1, label: 'Ticket raised', by: 'Store A', note: '' }],
    },
  })),
  exportTicketDetailReportXlsx: vi.fn(),
}))
vi.mock('@/lib/actions/analyticsReportExport', () => ({ exportAgeBucketReportXlsx: vi.fn(), exportTicketDetailReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ExecutiveDashboard } from '@/components/executive/ExecutiveDashboard'
import type { ExecTicket } from '@/lib/reporting/executive/engine'

afterEach(() => cleanup())

const DAY = 86_400_000
const NOW = new Date(2026, 9, 8, 17, 0, 0).getTime()
let n = 0
const tk = (o: Partial<ExecTicket>): ExecTicket => ({
  id: `t${++n}`, no: `CKSD-${1000 + n}`, subject: 'AC not cooling', group: 'ADMIN GROUP', tech: 'Krishan', cat: 'AC ISSUE', sub: 'COOLING', svc: 'Admin repair',
  req: 'Store A', dept: 'Stores', loc: 'STORES', store: 'Store A', state: 'Delhi', oem: 'LG OEM - ALL', brand: 'LG', src: 'Portal',
  prio: 'medium', status: 'in_progress', created: NOW - 3 * DAY, resolved: null, tatH: null, breached: false, csat: null, reo: [], frH: 1, ...o,
})
const tickets = [
  tk({}), tk({}), tk({ tech: 'Mohit', brand: 'DAIKIN', oem: 'DAIKIN OEM - ALL', created: NOW - 5 * DAY }),
  tk({ created: NOW - 6 * DAY, resolved: NOW - 5 * DAY, tatH: 24, status: 'resolved' }),
]

const view = (level: 'admin' | 'requester' | 'technician' = 'admin') =>
  render(<ExecutiveDashboard level={level} me="Krishan" now={NOW} tickets={tickets} approvals={[]} truncated={false} />)

describe('Executive Dashboard', () => {
  it('shows the numbers and the OEM-wise table', () => {
    view()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Executive Dashboard')
    expect(screen.getByText('OEM-wise tickets')).toBeTruthy()
    expect(screen.getAllByText('LG').length).toBeGreaterThan(0)
    expect(screen.getAllByText('DAIKIN').length).toBeGreaterThan(0)
  })

  it('narrows every number when a name is clicked, and shows a chip that undoes it', () => {
    view()
    const oem = screen.getByText('OEM-wise tickets').closest('section') as HTMLElement
    fireEvent.click(within(oem).getByText('DAIKIN'))
    expect(screen.getByText('OEM brand: DAIKIN')).toBeTruthy()
    expect(screen.getByText(/1 tickets created in this period match your selection/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove OEM brand: DAIKIN'))
    expect(screen.queryByText('OEM brand: DAIKIN')).toBeNull()
    expect(screen.getByText(/4 tickets created in this period match your selection/)).toBeTruthy()
  })

  it('opens the drill-down, goes a level deeper, and reaches one ticket', async () => {
    view()
    fireEvent.click(screen.getAllByText('Breakdown ▸')[0])
    const dlg = screen.getByRole('dialog')
    expect(within(dlg).getByRole('button', { name: 'Group' })).toBeTruthy()
    fireEvent.click(within(dlg).getByText('ADMIN GROUP'))
    expect(within(dlg).getByText(/Group: ADMIN GROUP/)).toBeTruthy()
    fireEvent.click(within(dlg).getByText('Individual tickets'))
    fireEvent.click(within(dlg).getAllByText(/CKSD-/)[0])
    expect(await within(dlg).findByText('Ticket raised', { exact: false })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('applies a drill-down selection to the whole dashboard', () => {
    view()
    fireEvent.click(screen.getAllByText('Breakdown ▸')[0])
    const dlg = screen.getByRole('dialog')
    fireEvent.click(within(dlg).getByText('ADMIN GROUP'))
    fireEvent.click(within(dlg).getByText('Apply this selection to the dashboard'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Group: ADMIN GROUP')).toBeTruthy()
  })

  it('gives a requester their own titled view without the people insights', () => {
    view('requester')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My Requests Dashboard')
    expect(screen.queryByText('Workload')).toBeNull()
    expect(screen.queryByText('Only my tickets')).toBeNull()
  })

  it('gives a technician an "only my tickets" shortcut', () => {
    view('technician')
    fireEvent.click(screen.getByText('Only my tickets'))
    expect(screen.getByText('Technician: Krishan')).toBeTruthy()
  })

  it('switches what the trend, rankings and list show when another number is clicked', () => {
    view()
    fireEvent.click(screen.getByText('Open backlog'))
    expect(screen.getByText(/Open backlog - by day/)).toBeTruthy()
  })
})
