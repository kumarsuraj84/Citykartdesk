// @vitest-environment jsdom
// A normal user has no Smart Dashboard. A normal user who has people reporting to them (the Manager box on those people's accounts) gets the normal Dashboard,
// which is about the tickets those people raised or work on.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/home', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { Sidebar } from '@/components/layout/Sidebar'
import { reportsScopeOrFilter, type ReportViewerScope } from '@/lib/reporting/access'
import { applyScope } from '@/lib/queries/executive-dashboard'

afterEach(() => cleanup())

const counts = { requests: 0, tasks: 0, approvals: 0, notifications: 0, projects: 0 }
const render_ = (role: string, nav: Record<string, unknown>) =>
  render(<Sidebar profile={{ id: 'u1', role, full_name: 'Ajay Goel', team_members: [] } as never}
    navVisibility={{ isAgent: false, isTeamLead: false, isManager: false, isAdmin: false, hasPendingApprovals: false, enabledModules: ['requests', 'tasks'], ...nav } as never} navCounts={counts} forceExpanded />)
const links = () => screen.queryAllByRole('link').map((a) => a.textContent?.trim())

describe('the menu of a normal user', () => {
  it('has no Smart Dashboard and no Dashboards when nobody reports to them', () => {
    render_('user', {})
    expect(links()).not.toContain('Smart Dashboard')
    expect(links()).not.toContain('Dashboards')
  })
  it('has the Dashboards (for their team) but still no Smart Dashboard when people report to them', () => {
    render_('user', { hasTeam: true })
    expect(links()).toContain('Dashboards')
    expect(links()).not.toContain('Smart Dashboard')
    expect(screen.getByText('Dashboards').closest('a')?.getAttribute('href')).toBe('/dashboards')
  })
  it('a technician keeps both', () => {
    render_('agent', { isAgent: true })
    expect(links()).toContain('Dashboards')
    expect(links()).toContain('Smart Dashboard')
  })
})

describe("the tickets of a person's team", () => {
  const scope: ReportViewerScope = { kind: 'reports', userId: 'u1', reportIds: ['a', 'b'] }
  it('are the ones raised by, or assigned to, the people who report to them', () => {
    expect(reportsScopeOrFilter(scope as never)).toBe('requester_id.in.(a,b),assigned_to.in.(a,b)')
  })
  it('a person with nobody under them matches nothing', () => {
    expect(reportsScopeOrFilter({ kind: 'reports', userId: 'u1', reportIds: [] })).toBe('requester_id.in.(00000000-0000-0000-0000-000000000000),assigned_to.in.(00000000-0000-0000-0000-000000000000)')
  })
  it('is applied to a tickets query, and to the ticket inside an approval or an activity row', () => {
    const calls: unknown[][] = []
    const q = { or: (...a: unknown[]) => { calls.push(a); return q } }
    applyScope(q, scope, '')
    applyScope(q, scope, 'request.')
    expect(calls).toEqual([['requester_id.in.(a,b),assigned_to.in.(a,b)'], ['requester_id.in.(a,b),assigned_to.in.(a,b)', { referencedTable: 'request' }]])
  })
})
