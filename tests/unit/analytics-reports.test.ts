import { describe, it, expect } from 'vitest'
import { resolveDateRange, parseDay, referenceDay } from '@/lib/reporting/analytics/date-ranges'
import { groupDisplayName, canViewGroupReport, canUseReportAnalytics, selectableGroups } from '@/lib/reporting/analytics/catalog'

const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null)

describe('date range presets', () => {
  const now = new Date(2026, 9, 8, 15, 30) // 8 Oct 2026
  const r = (p: string, f?: string, t?: string, n = now) => { const x = resolveDateRange(p, f, t, n); return [ymd(x.from), ymd(x.to)] }

  it('this month / last month', () => {
    expect(r('this_month')).toEqual(['2026-10-01', '2026-10-08'])
    expect(r('last_month')).toEqual(['2026-09-01', '2026-09-30'])
  })
  it('last month in January is December of the year before', () => {
    expect(r('last_month', undefined, undefined, new Date(2027, 0, 15))).toEqual(['2026-12-01', '2026-12-31'])
  })
  it('this year runs from 1 January to today; last year is the whole previous year', () => {
    expect(r('this_year')).toEqual(['2026-01-01', '2026-10-08'])
    expect(r('last_year')).toEqual(['2025-01-01', '2025-12-31'])
  })
  it('this financial year runs from 1 April to today', () => {
    expect(r('this_fy')).toEqual(['2026-04-01', '2026-10-08'])
    expect(r('last_fy')).toEqual(['2025-04-01', '2026-03-31'])
  })
  it('between January and March the financial year started the previous April', () => {
    const feb = new Date(2027, 1, 10)
    expect(r('this_fy', undefined, undefined, feb)).toEqual(['2026-04-01', '2027-02-10'])
    expect(r('last_fy', undefined, undefined, feb)).toEqual(['2025-04-01', '2026-03-31'])
  })
  it('the first day of the financial year belongs to the new one', () => {
    expect(r('this_fy', undefined, undefined, new Date(2026, 3, 1))).toEqual(['2026-04-01', '2026-04-01'])
    expect(r('this_fy', undefined, undefined, new Date(2026, 2, 31))).toEqual(['2025-04-01', '2026-03-31'])
  })
  it('rolling windows include today', () => {
    expect(r('today')).toEqual(['2026-10-08', '2026-10-08'])
    expect(r('last_7')).toEqual(['2026-10-02', '2026-10-08'])
    expect(r('last_30')).toEqual(['2026-09-09', '2026-10-08'])
  })
  it('the end of a range is the end of that day, so tickets created that evening are included', () => {
    const x = resolveDateRange('this_month', undefined, undefined, now)
    expect(x.to?.getHours()).toBe(23)
    expect(x.to?.getMinutes()).toBe(59)
  })
  it('custom range, reversed dates are swapped, and bad input falls back to all time', () => {
    expect(r('custom', '2026-08-01', '2026-08-31')).toEqual(['2026-08-01', '2026-08-31'])
    expect(r('custom', '2026-08-31', '2026-08-01')).toEqual(['2026-08-01', '2026-08-31'])
    expect(r('custom', '2026-08-01', undefined)).toEqual(['2026-08-01', null])
    expect(resolveDateRange('custom', 'nope', '').preset).toBe('all')
    expect(resolveDateRange('whatever').preset).toBe('all')
    expect(parseDay('2026-02-30')).toBeNull()
  })
  it('all time has no bounds', () => {
    expect(r('all')).toEqual([null, null])
    expect(resolveDateRange('all').label).toBe('All dates')
  })
})

describe('the "that day" is the end of the chosen dates', () => {
  const now = new Date(2026, 9, 8, 15, 30) // 8 Oct 2026
  const ref = (preset: string, f?: string, t?: string) => { const r = referenceDay(resolveDateRange(preset, f, t, now), now); return [r.label, r.word, r.isToday] }

  it('is today when the range runs to today or has no end', () => {
    expect(ref('all')).toEqual(['8 Oct 2026', 'today', true])
    expect(ref('this_month')).toEqual(['8 Oct 2026', 'today', true])
    expect(ref('this_fy')).toEqual(['8 Oct 2026', 'today', true])
    expect(ref('custom', '2026-09-01', undefined)).toEqual(['8 Oct 2026', 'today', true])
  })
  it('is the To date when the range ends in the past', () => {
    expect(ref('last_month')).toEqual(['30 Sep 2026', 'on 30 Sep 2026', false])
    expect(ref('last_year')).toEqual(['31 Dec 2025', 'on 31 Dec 2025', false])
    expect(ref('last_fy')).toEqual(['31 Mar 2026', 'on 31 Mar 2026', false])
    expect(ref('custom', '2026-10-01', '2026-10-07')).toEqual(['7 Oct 2026', 'on 7 Oct 2026', false]) // "yesterday"
  })
  it('covers exactly that one day', () => {
    const r = referenceDay(resolveDateRange('custom', '2026-10-01', '2026-10-07', now), now)
    expect(r.start.getDate()).toBe(7)
    expect(r.start.getHours()).toBe(0)
    expect(r.end.getDate()).toBe(7)
    expect(r.end.getHours()).toBe(23)
  })
  it('never looks into the future', () => {
    expect(ref('custom', '2026-10-01', '2026-12-31')).toEqual(['8 Oct 2026', 'today', true])
  })
})

// The 11 technician groups that exist in production (read from the live database on 2026-10-08).
const PROD_GROUPS = ['ADMIN GROUP', 'BD Group', 'FINANCE GROUP', 'HR GROUP', 'IT Group', 'L&D GROUP', 'LEGAL GROUP', 'LP GROUP', 'PO  GM GROUP', 'PO APPS GROUP', 'VM GROUP']
  .map((name, i) => ({ id: `team-${i}`, name }))
const byName = (n: string) => PROD_GROUPS.find((g) => g.name === n)!

describe('group names', () => {
  it('shortens group names sensibly', () => {
    expect(groupDisplayName('ADMIN GROUP')).toBe('Admin')
    expect(groupDisplayName('PO  GM GROUP')).toBe('PO GM')
    expect(groupDisplayName('PO APPS GROUP')).toBe('PO Apps')
    expect(groupDisplayName('L&D GROUP')).toBe('L&D')
    expect(groupDisplayName('IT Group')).toBe('IT')
    expect(groupDisplayName('Facilities Management')).toBe('Facilities Management')
  })
})

describe('which groups a viewer can choose from', () => {
  const admin = byName('ADMIN GROUP').id
  const bd = byName('BD Group').id

  it('admins and owners can choose any group, A to Z', () => {
    for (const role of ['admin', 'platform_owner']) {
      const g = selectableGroups({ role, team_members: [] } as never, PROD_GROUPS)
      expect(g).toHaveLength(11)
      expect(g.map((x) => x.name)[0]).toBe('ADMIN GROUP')
    }
  })
  it('a technician or manager in one group sees only that group', () => {
    expect(selectableGroups({ role: 'agent', team_members: [{ team_id: admin }] } as never, PROD_GROUPS).map((g) => g.name)).toEqual(['ADMIN GROUP'])
    expect(selectableGroups({ role: 'manager', team_members: [{ team_id: bd }] } as never, PROD_GROUPS).map((g) => g.name)).toEqual(['BD Group'])
  })
  it('a technician or manager in several groups can choose among theirs', () => {
    const both = { role: 'agent', team_members: [{ team_id: bd }, { team_id: admin }] } as never
    expect(selectableGroups(both, PROD_GROUPS).map((g) => g.name)).toEqual(['ADMIN GROUP', 'BD Group'])
  })
  it('requesters and people in no group get nothing', () => {
    expect(canUseReportAnalytics('user')).toBe(false)
    expect(selectableGroups({ role: 'user', team_members: [{ team_id: admin }] } as never, PROD_GROUPS)).toEqual([])
    expect(selectableGroups({ role: 'agent', team_members: [] } as never, PROD_GROUPS)).toEqual([])
    for (const role of ['agent', 'manager', 'admin', 'platform_owner']) expect(canUseReportAnalytics(role)).toBe(true)
  })
  it('a group created later is selectable straight away, and a deleted one is gone', () => {
    const withNew = [...PROD_GROUPS, { id: 'new-1', name: 'Facilities GROUP' }]
    expect(selectableGroups({ role: 'admin', team_members: [] } as never, withNew).map((g) => g.name)).toContain('Facilities GROUP')
    const withoutHr = PROD_GROUPS.filter((g) => g.name !== 'HR GROUP')
    expect(selectableGroups({ role: 'admin', team_members: [] } as never, withoutHr).map((g) => g.name)).not.toContain('HR GROUP')
    expect(canViewGroupReport({ role: 'admin', team_members: [] }, 'any')).toBe(true)
  })
})

