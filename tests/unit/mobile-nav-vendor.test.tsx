// @vitest-environment jsdom
/**
 * QA-D009: an OEM engineer (vendor login) on a phone saw the staff bottom bar (Home / New Request / Requests / Approvals). Every one of those pages sends a vendor back to
 * /vendor, and "My tickets" was hidden behind "More". The desktop sidebar already has the small vendor menu; the phone bar must offer the same.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MobileNav } from '@/components/layout/MobileNav'
import type { NavVisibility, ProfileWithTeams } from '@/types'
import type { NavCounts } from '@/lib/queries/profiles'

vi.mock('next/navigation', () => ({ usePathname: () => '/vendor', useSearchParams: () => new URLSearchParams() }))
afterEach(() => cleanup())

const navCounts: NavCounts = { requests: 0, tasks: 0, approvals: 0, notifications: 0, projects: 0 }
const nav: NavVisibility = { isAgent: false, isTeamLead: false, isManager: false, isAdmin: false, hasPendingApprovals: false, enabledModules: ['requests', 'services', 'approvals', 'tasks'] as never }
const vendor = { id: 'v1', full_name: 'Vendor Tech', role: 'user', org_id: 'org-1', vendor_company_id: 'co-1', team_members: [] } as unknown as ProfileWithTeams
const staff = { id: 's1', full_name: 'Store User', role: 'user', org_id: 'org-1', vendor_company_id: null, team_members: [] } as unknown as ProfileWithTeams

describe('MobileNav for a vendor login', () => {
  it('shows My tickets and My POs and nothing of the staff menu', () => {
    render(<MobileNav profile={vendor} navVisibility={nav} navCounts={navCounts} />)
    const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim())
    expect(labels).toContain('My tickets')
    expect(labels).toContain('My POs')
    for (const staffOnly of ['New Request', 'Requests', 'Approvals', 'Home']) expect(labels).not.toContain(staffOnly)
  })
  it('a normal user keeps the staff bar', () => {
    render(<MobileNav profile={staff} navVisibility={nav} navCounts={navCounts} />)
    const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim())
    expect(labels).toContain('New Request')
    expect(labels).not.toContain('My tickets')
  })
})
