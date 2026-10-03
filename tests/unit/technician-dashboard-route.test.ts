/**
 * Technicians reached "Dashboards" via /admin/reports, but app/(app)/admin/layout.tsx
 * redirects every role except admin/manager/platform_owner to /home — so the sidebar
 * link bounced them. The technician view now lives at /dashboards, outside /admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getCurrentProfileMock, getAnalyticsMock, workloadMock } = vi.hoisted(() => ({
  getCurrentProfileMock: vi.fn(),
  getAnalyticsMock: vi.fn(),
  workloadMock: vi.fn(),
}))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: getCurrentProfileMock }))
vi.mock('@/lib/queries/analytics', () => ({ getAnalytics: getAnalyticsMock }))
vi.mock('@/lib/queries/requests', () => ({ getTechnicianWorkloadBoard: workloadMock }))
vi.mock('@/components/analytics/TechnicianDashboard', () => ({ TechnicianDashboard: () => null }))

class RedirectSignal extends Error {
  constructor(public target: string) { super(`NEXT_REDIRECT:${target}`) }
}
vi.mock('next/navigation', () => ({
  redirect: (target: string) => { throw new RedirectSignal(target) },
}))

function profileWith(role: string, overrides: Record<string, unknown> = {}) {
  return { id: 'u1', org_id: 'org-1', role, team_members: [{ team_id: 'bd' }, { team_id: 'admin-group' }], ...overrides }
}

async function callPage() {
  const { default: Page } = await import('@/app/(app)/dashboards/page')
  try {
    await Page()
    return { redirected: false as const }
  } catch (e) {
    if (e instanceof RedirectSignal) return { redirected: true as const, target: e.target }
    throw e
  }
}

describe('/dashboards — the technician dashboard route', () => {
  beforeEach(() => {
    getCurrentProfileMock.mockReset()
    getAnalyticsMock.mockReset().mockResolvedValue({ dailyActivity: {}, backlogAging: {} })
    workloadMock.mockReset().mockResolvedValue([])
  })

  it('a technician reaches it, and the workload board is scoped to their own work plus their groups', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('agent'))
    expect(await callPage()).toEqual({ redirected: false })
    expect(workloadMock).toHaveBeenCalledWith('org-1', { kind: 'agent', userId: 'u1', teamIds: ['bd', 'admin-group'] })
  })

  it.each(['admin', 'manager', 'platform_owner'])('%s is sent to the full dashboard', async (role) => {
    getCurrentProfileMock.mockResolvedValue(profileWith(role))
    expect(await callPage()).toEqual({ redirected: true, target: '/admin/reports' })
  })

  it('a requester is sent home', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('user'))
    expect(await callPage()).toEqual({ redirected: true, target: '/home' })
  })

  it('a signed-out visitor is sent to login', async () => {
    getCurrentProfileMock.mockResolvedValue(null)
    expect(await callPage()).toEqual({ redirected: true, target: '/login' })
  })
})
