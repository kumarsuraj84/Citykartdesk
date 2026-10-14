/**
 * Technicians reached "Dashboards" via /admin/reports, but app/(app)/admin/layout.tsx
 * redirects every role except admin/manager/platform_owner to /home — so the sidebar
 * link bounced them. The technician view now lives at /dashboards, outside /admin,
 * and shows the analytics widgets limited to the technician's own groups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getCurrentProfileMock, getEnabledModulesMock, getAnalyticsMock, workloadMock, workloadReportMock, reportIdsMock } = vi.hoisted(() => ({
  workloadReportMock: vi.fn(),
  reportIdsMock: vi.fn(),
  getCurrentProfileMock: vi.fn(),
  getEnabledModulesMock: vi.fn(),
  getAnalyticsMock: vi.fn(),
  workloadMock: vi.fn(),
}))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: getCurrentProfileMock, getEnabledModules: getEnabledModulesMock, getDirectReports: reportIdsMock }))
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

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const R1 = '33333333-3333-4333-8333-333333333333'
const R2 = '44444444-4444-4444-8444-444444444444'
const OUTSIDER = '55555555-5555-4555-8555-555555555555'
const TEAM = [
  { id: T1, full_name: 'Arvind', role: 'agent' }, { id: T2, full_name: 'Kapil', role: 'agent' },
  { id: R1, full_name: 'Store A', role: 'user' }, { id: R2, full_name: 'Store B', role: 'user' },
]

const NO_STORE_CHOICE = { region: [], state: [], cluster: [], stype: [], plist: [], ac: [] }

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
    getAnalyticsMock.mockReset().mockResolvedValue({ stores: { combos: [] } })
    workloadMock.mockReset().mockResolvedValue([])
    workloadReportMock.mockReset().mockResolvedValue([])
    reportIdsMock.mockReset().mockResolvedValue([])
  })

  it('a normal user who has people reporting to them reaches it: analytics are scoped to those people, with no technician workload', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('user'))
    reportIdsMock.mockResolvedValue(TEAM)
    expect(await callPage()).toEqual({ redirected: false })
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', { kind: 'reports', userId: 'u1', reportIds: [T1, T2, R1, R2], techIds: [], requesterIds: [] }, NO_STORE_CHOICE)
    expect(workloadMock).not.toHaveBeenCalled()
    expect(workloadReportMock).not.toHaveBeenCalled()
  })

  it('a team Dashboard can be narrowed to some technicians and / or requesters, and only to people who report to the viewer', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('user'))
    reportIdsMock.mockResolvedValue(TEAM)
    await callPage({ tech: `${T2},${OUTSIDER}`, requester: `${R1},${T1}` })        // the outsider is not on the team, and a technician is not a requester
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', { kind: 'reports', userId: 'u1', reportIds: [T1, T2, R1, R2], techIds: [T2], requesterIds: [R1] }, NO_STORE_CHOICE)
  })

  it('the page offers both a technician and a requester filter to a team Dashboard', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('user'))
    reportIdsMock.mockResolvedValue(TEAM)
    const tree = await renderTree()
    const params: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (n: any) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n.type === 'function' && n.type.name === 'PeopleFilter') params.push(n.props.param); walk(n.props?.children) }
    walk(tree)
    expect(params).toEqual(['tech', 'requester'])
  })

  it('a normal user with nobody reporting to them is sent home', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('user'))
    expect(await callPage()).toEqual({ redirected: true, target: '/home' })
    expect(getAnalyticsMock).not.toHaveBeenCalled()
  })

  it('a technician reaches it, and analytics + workload are scoped to their own work plus their groups', async () => {
    getCurrentProfileMock.mockResolvedValue(profileWith('agent'))
    expect(await callPage()).toEqual({ redirected: false })
    const scope = { kind: 'agent', userId: 'u1', teamIds: ['bd', 'admin-group'] }
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', scope, NO_STORE_CHOICE)
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
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', scope, NO_STORE_CHOICE)
    expect(workloadMock).toHaveBeenCalledWith('org-1', scope)
  })

  it('a group the technician is not in is ignored, never widening what they see', async () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const team_members = [A, B].map((id, i) => ({ team_id: id, team: { id, name: 'Group ' + i } }))
    getCurrentProfileMock.mockResolvedValue(profileWith('agent', { team_members }))
    await callPage({ groups: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
    expect(getAnalyticsMock).toHaveBeenCalledWith('org-1', '30d', { kind: 'agent', userId: 'u1', teamIds: [A, B] }, NO_STORE_CHOICE)
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
