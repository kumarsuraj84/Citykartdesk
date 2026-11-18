// @vitest-environment jsdom
/**
 * Health & Performance is for PLATFORM OWNERS ONLY (owner's decision, 2026-11-18): the menu entry and the alert bar must not be drawn for an administrator, a manager,
 * a technician or a requester. (The page itself is guarded by app/(app)/health/layout.tsx with the same canSeeHealth rule.)
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Sidebar } from '@/components/layout/Sidebar'
import type { NavVisibility, ProfileWithTeams } from '@/types'
import type { NavCounts } from '@/lib/queries/profiles'

vi.mock('next/navigation', () => ({ usePathname: () => '/home', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/health/queries', () => ({ getOpenIncidents: async () => [{ checkKey: 'database', startedAt: '2026-11-18T05:00:00Z' }] }))
afterEach(() => cleanup())

const counts: NavCounts = { requests: 0, tasks: 0, approvals: 0, notifications: 0, projects: 0 }
const profileOf = (role: string) => ({ id: 'u1', full_name: 'Some One', role, org_id: 'org-1', vendor_company_id: null, store_id: null, team_members: [] }) as unknown as ProfileWithTeams
const navFor = (admin: boolean): NavVisibility => ({ isAgent: admin, isTeamLead: false, isManager: admin, isAdmin: admin, hasPendingApprovals: false, enabledModules: ['requests', 'services', 'approvals', 'tasks'] as never })

describe('who sees the Health & Performance menu entry', () => {
  it('a platform owner does', () => {
    render(<Sidebar profile={profileOf('platform_owner')} navVisibility={navFor(true)} navCounts={counts} />)
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toContain('/health')
  })
  it.each(['admin', 'manager', 'agent', 'user'])('%s does not', (role) => {
    render(<Sidebar profile={profileOf(role)} navVisibility={navFor(role !== 'user')} navCounts={counts} />)
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).not.toContain('/health')
  })
})

describe('who sees the alert bar', () => {
  it('a platform owner sees it while an outage is open; nobody else sees anything', async () => {
    const { HealthBanner } = await import('@/components/layout/HealthBanner')
    const owner = await HealthBanner({ role: 'platform_owner' })
    expect(owner).not.toBeNull()
    for (const role of ['admin', 'manager', 'agent', 'user', null, undefined]) expect(await HealthBanner({ role }), String(role)).toBeNull()
  })
})
