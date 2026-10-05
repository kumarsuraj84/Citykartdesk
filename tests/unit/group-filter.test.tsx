// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { parseGroupsParam, narrowScopeToGroups, teamIdsForScope } from '@/lib/analytics/group-filter'
import { GroupFilter } from '@/components/analytics/GroupFilter'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const OUTSIDER = '99999999-9999-4999-8999-999999999999'

describe('parseGroupsParam', () => {
  it('reads a comma list, drops junk and duplicates', () => {
    expect(parseGroupsParam(`${A},${B},${A}, not-an-id ,`)).toEqual([A, B])
    expect(parseGroupsParam(undefined)).toEqual([])
    expect(parseGroupsParam('')).toEqual([])
  })
})

describe('narrowScopeToGroups', () => {
  const allowed = [A, B, C]

  it('a manager (or admin) who picks some groups is limited to exactly those', () => {
    expect(narrowScopeToGroups({ kind: 'team', teamIds: allowed }, [A, B], allowed)).toEqual({ scope: { kind: 'team', teamIds: [A, B] }, selected: [A, B] })
    expect(narrowScopeToGroups({ kind: 'all' }, [C], allowed)).toEqual({ scope: { kind: 'team', teamIds: [C] }, selected: [C] })
  })

  it('a technician keeps their own work and is limited to the picked groups', () => {
    const scope = { kind: 'agent' as const, userId: 'u1', teamIds: allowed }
    expect(narrowScopeToGroups(scope, [B], allowed)).toEqual({ scope: { ...scope, teamIds: [B] }, selected: [B] })
  })

  it('picking one group shows one group; picking every group is the same as picking none', () => {
    const scope = { kind: 'team' as const, teamIds: allowed }
    expect(narrowScopeToGroups(scope, [A], allowed).selected).toEqual([A])
    expect(narrowScopeToGroups(scope, [A, B, C], allowed)).toEqual({ scope, selected: [] })
    expect(narrowScopeToGroups(scope, [], allowed)).toEqual({ scope, selected: [] })
  })

  it('can never widen: a group the viewer may not pick is ignored', () => {
    const scope = { kind: 'team' as const, teamIds: allowed }
    expect(narrowScopeToGroups(scope, [OUTSIDER], allowed)).toEqual({ scope, selected: [] })
    expect(narrowScopeToGroups(scope, [A, OUTSIDER], allowed).scope).toEqual({ kind: 'team', teamIds: [A] })
  })
})

describe('teamIdsForScope', () => {
  it('org-wide has no limit; team/agent are limited to their groups', () => {
    expect(teamIdsForScope({ kind: 'all' })).toBeNull()
    expect(teamIdsForScope({ kind: 'team', teamIds: [A] })).toEqual([A])
    expect(teamIdsForScope({ kind: 'agent', userId: 'u', teamIds: [B] })).toEqual([B])
    expect(teamIdsForScope({ kind: 'own', userId: 'u' })).toEqual([])
  })
})

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboards',
  useSearchParams: () => new URLSearchParams('period=30d'),
}))

const groups = [{ id: A, name: 'BD Group' }, { id: B, name: 'IT Group' }, { id: C, name: 'HR Group' }]

describe('GroupFilter', () => {
  beforeEach(() => push.mockClear())
  afterEach(() => cleanup())

  it('is hidden for someone with a single group', () => {
    const { container } = render(<GroupFilter groups={[groups[0]]} selected={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows "All groups" by default and lists every group with all ticked', () => {
    render(<GroupFilter groups={groups} selected={[]} />)
    expect(screen.getByText('All groups (3)')).toBeTruthy()
    fireEvent.click(screen.getByText('All groups (3)'))
    for (const g of groups) expect((screen.getByLabelText(g.name) as HTMLInputElement).checked).toBe(true)
  })

  it('picking two of three groups puts them in the address and keeps the other settings', () => {
    render(<GroupFilter groups={groups} selected={[]} />)
    fireEvent.click(screen.getByText('All groups (3)'))
    fireEvent.click(screen.getByLabelText('HR Group'))
    fireEvent.click(screen.getByText('Apply'))
    expect(push).toHaveBeenCalledWith(`/dashboards?period=30d&groups=${A}%2C${B}`)
  })

  it('picking just one group works', () => {
    render(<GroupFilter groups={groups} selected={[]} />)
    fireEvent.click(screen.getByText('All groups (3)'))
    fireEvent.click(screen.getByText('Clear all'))
    fireEvent.click(screen.getByLabelText('IT Group'))
    fireEvent.click(screen.getByText('Apply'))
    expect(push).toHaveBeenCalledWith(`/dashboards?period=30d&groups=${B}`)
  })

  it('ticking every group again removes the filter', () => {
    render(<GroupFilter groups={groups} selected={[A, B]} />)
    expect(screen.getByText('2 of 3 groups')).toBeTruthy()
    fireEvent.click(screen.getByText('2 of 3 groups'))
    fireEvent.click(screen.getByLabelText('HR Group'))
    fireEvent.click(screen.getByText('Apply'))
    expect(push).toHaveBeenCalledWith('/dashboards?period=30d')
  })

  it('cannot apply with nothing ticked', () => {
    render(<GroupFilter groups={groups} selected={[]} />)
    fireEvent.click(screen.getByText('All groups (3)'))
    fireEvent.click(screen.getByText('Clear all'))
    expect((screen.getByText('Apply') as HTMLButtonElement).disabled).toBe(true)
  })
})
