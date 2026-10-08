/**
 * Technicians reached "Dashboards" via /admin/reports, but app/(app)/admin/layout.tsx
 * redirects every role except admin/manager/platform_owner to /home — so the sidebar
 * link bounced them. The technician view now lives at /dashboards, outside /admin,
 * and shows the analytics widgets limited to the technician's own groups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getCurrentProfileMock, getEnabledModulesMock, getAnalyticsMock, workloadMock, workloadReportMock } = vi.hoisted(() => ({
  workloadReportMock: vi.fn(),
  getCurrentProfileMock: vi.fn(),
  getEnabledModulesMock: vi.fn(),
  getAnalyticsMock: vi.fn(),
  workloadMock: vi.fn(),
}))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: getCurrentProfileMock, getEnabledModules: getEnabledModulesMock }))
vi.mock('@/lib/queries/analytics', async () => { const real = await vi.importActual<typeof import('@/lib/queries/analytics')>('@/lib/queries/analytics'); return { getAnalytics: getAnalyticsMock, isPeriod: real.isPeriod, PERIOD_OPTIONS: real.PERIOD_OPTIONS } })
vi.mock('@/lib/queries/requests', () => ({ getTechnicianWorkloadBoard: workloadMock }))
vi.mock('@/lib/queries/workload', () => ({ getWorkloadReport: workloadReportMock }))
vi.mock('@/app/(app)/admin/reports/AnalyticsDashboard', () => ({ AnalyticsDashboard: () => null }))

class RedirectSignal extends Error {
  constructor(public target: string) { super(`NEXT_REDIRECT:${target}`) }
}
vi.mock('next/navigation', () => ({
  redirect: (target: string) => { throw new RedirectSignal(target) },
}))

function profileWith(role: string, overrides: Record<string, unknown> = {}) {
  return { id: 'u1', org_id: 'org-1', role, team_members: [{ team_id: 'bd' }, { team_id: 'admin-group' }], ...overrides }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasComponent(node: any, name: string): boolean {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some((n) => hasComponent(n, name))
  if (typeof node.type === 'function' && node.type.name === name) return true
  return hasComponent(node.props?.children, name)
}

async function renderTree(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(app)/dashboards/page')
  return Page({ searchParams: Promise.resolve(searchParams) })
}

async function callPage(searchParams: Record<string, string> = {}) {
  const { default: Page } = await import('@/app/(app)/dashboards/page')
  try {
    await Page({ searchParams: Promise.resolve(searchParams) })
    return { redirected: false as const }
  } catch (e) {
    if (e instanceof RedirectSignal) return { redirected: true as const, target: e.target }
    throw e
  }
}

describe('/dashboards — the technician dashboard route', () => {
  beforeEach(() => {
    getCurrentProfileMock.mockReset()
    getEnabledModulesMock.mockReset().mockResolvedValue(['requests'])
    getAnalyticsMock.mockReset().mockResolvedValue({})
    workloadMock.mockReset().mockResolvedValue([])
    workloadReportMock.mockReset().mockResolvedValue([])
  })

  it('a technician reaches it, and analytics + workload are scoped to their own work plus their groups', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('agent'))
    expect(await callPage()).toEqual({ redirected: false })
    const scope = { kind: 'agent', userId: 'u1', teamIds: ['bd', 'admin-group'] }
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', scope)
    expect(workloadMock).toHaveBeenCalledWith('org-1', scope)
  })

  it('a technician in several groups can pick some: analytics and workload are limited to the picked groups', async () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const team_members = [A, B, C].map((id, i) => ({ team_id: id, team: { id, name: 'Group ' + i } }))
    getCurrentProfileMock.mockResolvedValue(profileWith('agent', { team_members }))
    await callPage({ groups: A + ',' + B })
    const scope = { kind: 'agent', userId: 'u1', teamIds: [A, B] }
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', scope)
    expect(workloadMock).toHaveBeenCalledWith('org-1', scope)
  })

  it('a group the technician is not in is ignored, never widening what they see', async () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const team_members = [A, B].map((id, i) => ({ team_id: id, team: { id, name: 'Group ' + i } }))
    getCurrentProfileMock.mockResolvedValue(profileWith('agent', { team_members }))
    await callPage({ groups: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', { kind: 'agent', userId: 'u1', teamIds: [A, B] })
  })

  it('a technician with a SINGLE group still sees the backlog banner (and no picker is needed)', async () => {
    const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    getCurrentProfileMock.mockResolvedValue(profileWith('agent', { team_members: [{ team_id: G, team: { id: G, name: 'IT Group' } }] }))
    workloadReportMock.mockResolvedValue([{ agentId: 'a1', agentName: 'Aakankasha Gupta', totalOpen: 6 }, { agentId: 'a2', agentName: 'Kapil Dev', totalOpen: 6 }])
    const tree = await renderTree()
    expect(workloadReportMock).toHaveBeenCalledWith('org-1', [G])
    expect(hasComponent(tree, 'CapacityBanner')).toBe(true)
  })

  it('shows no banner when nobody in the technician groups has an open ticket', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('agent'))
    workloadReportMock.mockResolvedValue([])
    expect(hasComponent(await renderTree(), 'CapacityBanner')).toBe(false)
  })

  it('honours the period selector', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('agent'))
    await callPage({ period: '60d' })
    expect(getAnalyticsMock.mock.calls[0][1]).toBe('60d')
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

  it('is sent home when the Requests module is off', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('agent'))
    getEnabledModulesMock.mockResolvedValue(['tasks'])
    expect(await callPage()).toEqual({ redirected: true, target: '/home' })
  })
})
