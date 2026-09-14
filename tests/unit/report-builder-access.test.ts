/**
 * Consolidated remediation — item 8 / DESK-QA-001: Report Builder
 * reachability (Product Decision A).
 *
 * Root cause: app/(app)/admin/reports/pivot/page.tsx was nested under
 * app/(app)/admin/layout.tsx, whose gate blocks every role except
 * admin/manager/platform_owner — even though the data layer underneath it
 * (lib/reporting/access.ts) already scoped the `requests` entity per-role
 * (own/agent/team/all) and was clearly intended to let every role with the
 * Requests module enabled use it (see the pre-existing comment on the
 * sidebar's Report Builder entry). The route was blocking a page whose own
 * data layer had already solved authorization correctly.
 *
 * Fix: the page moved to app/(app)/reports/pivot (outside /admin), with its
 * own narrower gate (authenticated + org-scoped + Requests module enabled).
 * The rest of /admin/* (including the Dashboards/DeskTime/Audit Logs
 * analytics pages) is untouched — still admin/manager/platform_owner-only
 * via app/(app)/admin/layout.tsx.
 *
 * resolveReportAccess() is the actual per-request-row authorization
 * boundary (called by every reporting Server Action regardless of which
 * page reaches it), so it gets the most thorough per-role coverage here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveReportAccess } from '@/lib/reporting/access'
import type { ProfileWithTeams } from '@/types'

function profileWith(role: ProfileWithTeams['role'], overrides: Partial<ProfileWithTeams> = {}): ProfileWithTeams {
  return {
    id: 'user-1',
    org_id: 'org-1',
    role,
    team_members: [{ team_id: 'team-1' } as never],
    ...overrides,
  } as ProfileWithTeams
}

describe('resolveReportAccess() — requests entity is scoped per role, not admin-only', () => {
  it('user (requester) sees only their own requests', () => {
    const result = resolveReportAccess(profileWith('user'), 'requests')
    expect(result).toEqual({ scope: { kind: 'own', userId: 'user-1' } })
  })

  it('agent sees their own + assigned scope', () => {
    const result = resolveReportAccess(profileWith('agent'), 'requests')
    expect(result).toEqual({ scope: { kind: 'agent', userId: 'user-1' } })
  })

  it('manager sees their team scope', () => {
    const result = resolveReportAccess(profileWith('manager'), 'requests')
    expect(result).toEqual({ scope: { kind: 'team', teamIds: ['team-1'] } })
  })

  it('admin sees the whole org', () => {
    const result = resolveReportAccess(profileWith('admin'), 'requests')
    expect(result).toEqual({ scope: { kind: 'all' } })
  })

  it('platform_owner sees the whole org', () => {
    const result = resolveReportAccess(profileWith('platform_owner'), 'requests')
    expect(result).toEqual({ scope: { kind: 'all' } })
  })
})

describe('resolveReportAccess() — every other entity stays admin/manager/platform_owner-only, unaffected by the requests fix', () => {
  it.each(['tasks', 'projects', 'milestones', 'approvals'] as const)('%s: a requester is denied', (entity) => {
    const result = resolveReportAccess(profileWith('user'), entity)
    expect(result).toEqual({ error: "You don't have access to this report." })
  })

  it.each(['tasks', 'projects', 'milestones', 'approvals'] as const)('%s: an agent is denied', (entity) => {
    const result = resolveReportAccess(profileWith('agent'), entity)
    expect(result).toEqual({ error: "You don't have access to this report." })
  })

  it.each(['tasks', 'projects', 'milestones', 'approvals'] as const)('%s: a manager is allowed (all scope)', (entity) => {
    const result = resolveReportAccess(profileWith('manager'), entity)
    expect(result).toEqual({ scope: { kind: 'all' } })
  })

  it.each(['tasks', 'projects', 'milestones', 'approvals'] as const)('%s: an admin is allowed (all scope)', (entity) => {
    const result = resolveReportAccess(profileWith('admin'), entity)
    expect(result).toEqual({ scope: { kind: 'all' } })
  })
})

// ── Page-level gate: app/(app)/reports/pivot/page.tsx ───────────────────────

const { getCurrentProfileMock, getEnabledModulesMock } = vi.hoisted(() => ({
  getCurrentProfileMock: vi.fn(),
  getEnabledModulesMock: vi.fn(),
}))
vi.mock('@/lib/queries/profiles', () => ({
  getCurrentProfile: getCurrentProfileMock,
  getEnabledModules: getEnabledModulesMock,
}))
vi.mock('@/components/reports/PivotBuilder', () => ({ PivotBuilder: () => null }))

class RedirectSignal extends Error {
  constructor(public target: string) { super(`NEXT_REDIRECT:${target}`) }
}
vi.mock('next/navigation', () => ({
  redirect: (target: string) => { throw new RedirectSignal(target) },
}))

async function callPage() {
  const { default: ReportBuilderPage } = await import('@/app/(app)/reports/pivot/page')
  try {
    await ReportBuilderPage()
    return { redirected: false as const }
  } catch (e) {
    if (e instanceof RedirectSignal) return { redirected: true as const, target: e.target }
    throw e
  }
}

describe('app/(app)/reports/pivot page — reachability per role', () => {
  beforeEach(() => {
    getCurrentProfileMock.mockReset()
    getEnabledModulesMock.mockReset().mockResolvedValue(['requests'])
  })

  it('an unauthenticated visitor is redirected to /login', async () => {
    getCurrentProfileMock.mockResolvedValue(null)
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/login' })
  })

  it('a profile with no org_id is redirected to /home', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('admin', { org_id: null }))
    const result = await callPage()
    expect(result).toEqual({ redirected: true, target: '/home' })
  })

  it('the Requests module disabled for the org redirects to /home, for every role — including admin', async () => {
    getEnabledModulesMock.mockResolvedValue(['tasks', 'projects']) // no 'requests'
    for (const role of ['user', 'agent', 'manager', 'admin', 'platform_owner'] as const) {
      getCurrentProfileMock.mockResolvedValue(profileWith(role))
      const result = await callPage()
      expect(result).toEqual({ redirected: true, target: '/home' })
    }
  })

  it.each(['user', 'agent', 'manager', 'admin', 'platform_owner'] as const)(
    'role "%s" with Requests enabled reaches the page (no redirect) — this is the DESK-QA-001 fix',
    async (role) => {
      getCurrentProfileMock.mockResolvedValue(profileWith(role))
      const result = await callPage()
      expect(result).toEqual({ redirected: false })
    }
  )
})
