import { describe, it, expect } from 'vitest'
import fixture from '../fixtures/age-bucket-excel.json'
import { buildAgeSummary, UNASSIGNED, NO_CATEGORY, NO_SUB_CATEGORY } from '@/lib/reporting/analytics/age-summary'
import { resolveDateRange, parseDay, referenceDay } from '@/lib/reporting/analytics/date-ranges'
import {
  ANALYTICS_REPORTS, findAnalyticsReport, groupDisplayName, reportTitleForGroup, canViewGroupReport, canUseReportAnalytics,
  selectableGroups, pickGroup, parseStatuses, DEFAULT_REPORT_STATUSES,
} from '@/lib/reporting/analytics/catalog'

const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null)

describe('age-bucket summary reproduces the two Excel pivot reports', () => {
  // The pivots in the Excel: Responsible → Category, counted by Age Bucket, Status filter = everything but Cancelled.
  const tickets = fixture.tickets.filter((t) => t.status !== 'Cancelled')
  const toRows = (list: typeof tickets) => list.map((t) => ({ technician: t.responsible, category: t.category, ageDays: t.ageDays }))

  function check(name: 'bd' | 'admin', list: typeof tickets) {
    const summary = buildAgeSummary(toRows(list))
    const expected = fixture.expected[name]
    const cats = expected.filter((e) => e.kind === 'cat') as { tech: string; category: string; count: number; total: number }[]
    for (const e of cats) {
      const tech = summary.technicians.find((t) => t.name === e.tech)
      const cat = tech?.categories.find((c) => c.name === e.category)
      expect(cat?.total, `${e.tech} / ${e.category}`).toBe(e.total)
    }
    for (const e of expected.filter((x) => x.kind === 'techTotal') as { tech: string; total: number }[]) {
      expect(summary.technicians.find((t) => t.name === e.tech)?.total, `${e.tech} Total`).toBe(e.total)
    }
    const grand = expected.find((x) => x.kind === 'grand') as { total: number }
    expect(summary.grand.total).toBe(grand.total)
    // every category row in the Excel exists here and nothing extra
    expect(summary.technicians.flatMap((t) => t.categories).length).toBe(cats.length)
    return summary
  }

  it('BD report', () => {
    const s = check('bd', tickets.filter((t) => t.service === 'BD'))
    expect(s.technicians.map((t) => t.name)).toEqual(['Mukesh'])
    expect(s.buckets).toEqual(['0–5 days'])
  })

  it('Admin report', () => {
    const s = check('admin', tickets.filter((t) => t.service.startsWith('ADMIN')))
    expect(s.technicians.map((t) => t.name)).toContain('Arun Das')
    expect(s.technicians.find((t) => t.name === 'Arun Das')?.total).toBe(18)
  })
})

describe('age-bucket summary rules', () => {
  const rows = [
    { technician: 'Zed', category: 'B', ageDays: 3 },
    { technician: 'amy', category: 'A', ageDays: 7 },
    { technician: null, category: 'A', ageDays: 100 },
    { technician: 'amy', category: null, ageDays: 3 },
    { technician: 'amy', category: 'A', ageDays: 3 },
  ]
  const s = buildAgeSummary(rows)
  it('sorts technicians A to Z ignoring case, with Unassigned last', () => {
    expect(s.technicians.map((t) => t.name)).toEqual(['amy', 'Zed', UNASSIGNED])
  })
  it('puts "no category" after real categories', () => {
    expect(s.technicians[0].categories.map((c) => c.name)).toEqual(['A', NO_CATEGORY])
  })
  it('shows only age buckets that have tickets, in age order', () => {
    expect(s.buckets).toEqual(['0–5 days', '6–10 days', '90+ days'])
  })
  it('totals add up in every direction', () => {
    expect(s.grand.total).toBe(5)
    expect(s.technicians.reduce((a, t) => a + t.total, 0)).toBe(5)
    expect(s.technicians[0].counts).toEqual({ '6–10 days': 1, '0–5 days': 2 })
  })
  it('an empty report has no rows and no buckets', () => {
    expect(buildAgeSummary([])).toEqual({ buckets: [], technicians: [], grand: { counts: {}, total: 0, day: { created: 0, resolved: 0 } } })
  })
})

describe('sub categories', () => {
  const rows = [
    { technician: 'Suraj', category: 'IT SUPPORT', subCategory: 'PRINTER', ageDays: 1 },
    { technician: 'Suraj', category: 'IT SUPPORT', subCategory: 'PRINTER', ageDays: 2 },
    { technician: 'Suraj', category: 'IT SUPPORT', subCategory: 'LAPTOP', ageDays: 8 },
    { technician: 'Suraj', category: 'IT SUPPORT', subCategory: null, ageDays: 1 },
  ]
  const s = buildAgeSummary(rows)
  const cat = s.technicians[0].categories[0]
  it('lists each sub category under its category, A to Z, "no sub category" last', () => {
    expect(cat.subCategories.map((x) => x.name)).toEqual(['LAPTOP', 'PRINTER', NO_SUB_CATEGORY])
  })
  it('counts each sub category on its own and adds them up for the category and technician', () => {
    expect(cat.subCategories.map((x) => x.total)).toEqual([1, 2, 1])
    expect(cat.total).toBe(4)
    expect(s.technicians[0].total).toBe(4)
    expect(cat.counts).toEqual({ '0–5 days': 3, '6–10 days': 1 })
  })
})

describe('created / resolved on the reference day', () => {
  // The example from the request: Suraj has 2 tickets in the 0–5 bucket under IT SUPPORT, and 1 of them was created today.
  const rows = [
    { technician: 'Suraj', category: 'IT SUPPORT', ageDays: 0 },
    { technician: 'Suraj', category: 'IT SUPPORT', ageDays: 3 },
  ]
  it('shows the day counts next to the bucket counts and does not change them', () => {
    const s = buildAgeSummary(rows, [{ technician: 'Suraj', category: 'IT SUPPORT', created: true, resolved: false }])
    const sub = s.technicians[0].categories[0].subCategories[0]
    expect(sub.counts).toEqual({ '0–5 days': 2 })
    expect(sub.total).toBe(2)
    expect(sub.day).toEqual({ created: 1, resolved: 0 })
  })
  it('counts created and resolved separately, and one ticket can be both on the same day', () => {
    const s = buildAgeSummary([], [
      { technician: 'Amy', category: 'HR', created: true, resolved: true },
      { technician: 'Amy', category: 'HR', created: false, resolved: true },
    ])
    expect(s.technicians[0].day).toEqual({ created: 1, resolved: 2 })
    expect(s.grand.day).toEqual({ created: 1, resolved: 2 })
  })
  it('a technician who only resolved tickets that day still gets a row (with no age-bucket tickets)', () => {
    const s = buildAgeSummary([{ technician: 'Zed', category: 'X', ageDays: 2 }], [{ technician: 'Amy', category: 'HR', created: false, resolved: true }])
    expect(s.technicians.map((t) => t.name)).toEqual(['Amy', 'Zed'])
    expect(s.technicians[0].total).toBe(0)
    expect(s.technicians[0].day.resolved).toBe(1)
    expect(s.grand.total).toBe(1)
  })
  it('totals the day counts over technicians', () => {
    const s = buildAgeSummary([], [
      { technician: 'A', category: 'X', created: true, resolved: false },
      { technician: 'B', category: 'Y', created: true, resolved: false },
    ])
    expect(s.grand.day.created).toBe(2)
  })
})

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

describe('one report for all technician groups', () => {
  it('is one summary report plus one ticket detail report; the group is chosen inside each', () => {
    expect(ANALYTICS_REPORTS).toHaveLength(2)
    expect(ANALYTICS_REPORTS[1].title).toBe('Ticket Detail Report Age bucket wise')
    expect(ANALYTICS_REPORTS[1].kind).toBe('ticket-detail')
    expect(findAnalyticsReport('ticket-detail-age-bucket')).toBe(ANALYTICS_REPORTS[1])
    expect(reportTitleForGroup(ANALYTICS_REPORTS[1], 'BD Group')).toBe('BD Ticket Detail Report Age bucket wise')
    expect(ANALYTICS_REPORTS[0].title).toBe('Tickets Summary Report Age bucket wise')
    expect(findAnalyticsReport('tickets-summary-age-bucket')).toBe(ANALYTICS_REPORTS[0])
    expect(findAnalyticsReport('admin-tickets-summary-age-bucket')).toBeUndefined()
  })
  it('titles the page and the Excel file with the chosen group, in the agreed style', () => {
    const def = ANALYTICS_REPORTS[0]
    const titles = PROD_GROUPS.map((g) => reportTitleForGroup(def, g.name))
    expect(titles).toContain('Admin Tickets Summary Report Age bucket wise')
    expect(titles).toContain('BD Tickets Summary Report Age bucket wise')
    expect(titles).toContain('PO GM Tickets Summary Report Age bucket wise')
    expect(titles).toContain('L&D Tickets Summary Report Age bucket wise')
    expect(titles).toHaveLength(11)
  })
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
  it('asking for a group you may not see falls back to your first allowed group', () => {
    const tech = { role: 'agent', team_members: [{ team_id: bd }] } as never
    const groups = selectableGroups(tech, PROD_GROUPS)
    expect(pickGroup(groups, admin)?.name).toBe('BD Group')
    expect(pickGroup(groups, undefined)?.name).toBe('BD Group')
    expect(pickGroup(groups, bd)?.name).toBe('BD Group')
    expect(pickGroup([], bd)).toBeUndefined()
  })
  it('a group created later is selectable straight away, and a deleted one is gone', () => {
    const withNew = [...PROD_GROUPS, { id: 'new-1', name: 'Facilities GROUP' }]
    expect(selectableGroups({ role: 'admin', team_members: [] } as never, withNew).map((g) => g.name)).toContain('Facilities GROUP')
    const withoutHr = PROD_GROUPS.filter((g) => g.name !== 'HR GROUP')
    expect(selectableGroups({ role: 'admin', team_members: [] } as never, withoutHr).map((g) => g.name)).not.toContain('HR GROUP')
    expect(canViewGroupReport({ role: 'admin', team_members: [] }, 'any')).toBe(true)
  })
})

describe('status filter', () => {
  it('defaults to every status that is still being worked', () => {
    expect(parseStatuses(undefined)).toEqual(DEFAULT_REPORT_STATUSES)
    expect(parseStatuses([])).toEqual(DEFAULT_REPORT_STATUSES)
    expect(DEFAULT_REPORT_STATUSES).not.toContain('resolved')
    expect(DEFAULT_REPORT_STATUSES).not.toContain('closed')
    expect(DEFAULT_REPORT_STATUSES).not.toContain('cancelled')
  })
  it('accepts one or several, ignores unknown values, keeps a stable order', () => {
    expect(parseStatuses('resolved')).toEqual(['resolved'])
    expect(parseStatuses(['closed', 'open', 'bogus'])).toEqual(['open', 'closed'])
    expect(parseStatuses(['bogus'])).toEqual(DEFAULT_REPORT_STATUSES)
  })
})

describe('Excel export of a predefined report', () => {
  it('has the same layout as the on-screen table: sub category column and the two "that day" columns', async () => {
    const { buildAgeBucketWorkbook, HEADER_ROW } = await import('@/lib/reporting/analytics/age-summary-xlsx')
    const ExcelJS = (await import('exceljs')).default
    const summary = buildAgeSummary(
      [
        { technician: 'Mukesh', category: 'SEEPAGE', subCategory: 'WALL', ageDays: 1 },
        { technician: 'Mukesh', category: 'STAIR DAMAGE', subCategory: 'INTERNAL', ageDays: 2 },
        { technician: 'Mukesh', category: 'STAIR DAMAGE', subCategory: 'INTERNAL', ageDays: 9 },
        { technician: 'Arun', category: 'BASKET', subCategory: null, ageDays: 3 },
      ],
      [{ technician: 'Mukesh', category: 'STAIR DAMAGE', subCategory: 'INTERNAL', created: true, resolved: false }]
    )
    const wb = buildAgeBucketWorkbook({
      title: 'Admin Tickets Summary Report Age bucket wise', teamName: 'ADMIN GROUP', rangeLabel: 'All dates',
      statusLabels: ['Open', 'In Progress'], servicesLabel: 'All services', dayWord: 'today', ticketCount: 4, summary,
    })
    const read = new ExcelJS.Workbook()
    await read.xlsx.load(await wb.xlsx.writeBuffer() as ArrayBuffer)
    const ws = read.getWorksheet('Summary')!
    const row = (n: number) => (ws.getRow(n).values as unknown[]).slice(1).map((v) => (v === undefined || v === null ? '' : v))

    expect(row(1)[0]).toBe('Admin Tickets Summary Report Age bucket wise')
    expect(String(row(2)[0])).toContain('Services: All services')
    expect(String(row(3)[0])).toContain('Status: Open, In Progress')
    expect(String(row(3)[0])).toContain('Tickets: 4')
    expect(row(HEADER_ROW)).toEqual(['Responsible', 'Category', 'Sub Category', '0–5 days', '6–10 days', 'Grand Total', 'Created today', 'Resolved today'])
    expect(row(HEADER_ROW + 1)).toEqual(['Arun', 'BASKET', '(No sub category)', 1, '', 1, '', ''])
    expect(row(HEADER_ROW + 2)).toEqual(['Arun Total', '', '', 1, '', 1, '', ''])
    expect(row(HEADER_ROW + 3)).toEqual(['Mukesh', 'SEEPAGE', 'WALL', 1, '', 1, '', ''])
    expect(row(HEADER_ROW + 4)).toEqual(['', 'STAIR DAMAGE', 'INTERNAL', 1, 1, 2, 1, ''])
    expect(row(HEADER_ROW + 5)).toEqual(['Mukesh Total', '', '', 2, 1, 3, 1, ''])
    expect(row(HEADER_ROW + 6)).toEqual(['Grand Total', '', '', 3, 1, 4, 1, ''])
  })

  it('names the day in the headings when it is not today', async () => {
    const { buildAgeBucketWorkbook, HEADER_ROW } = await import('@/lib/reporting/analytics/age-summary-xlsx')
    const wb = buildAgeBucketWorkbook({ title: 'T', teamName: 'G', rangeLabel: 'x', statusLabels: ['Open'], servicesLabel: 'IT', dayWord: 'on 30 Sep 2026', ticketCount: 1, summary: buildAgeSummary([{ technician: 'A', category: 'B', ageDays: 1 }]) })
    const headers = (wb.getWorksheet('Summary')!.getRow(HEADER_ROW).values as unknown[]).slice(1)
    expect(headers.slice(-2)).toEqual(['Created on 30 Sep 2026', 'Resolved on 30 Sep 2026'])
  })

  it('says so when nothing matches', async () => {
    const { buildAgeBucketWorkbook, HEADER_ROW } = await import('@/lib/reporting/analytics/age-summary-xlsx')
    const wb = buildAgeBucketWorkbook({ title: 'T', teamName: 'G', rangeLabel: 'All dates', statusLabels: ['Open'], servicesLabel: 'All services', dayWord: 'today', ticketCount: 0, summary: buildAgeSummary([]) })
    expect(String(wb.getWorksheet('Summary')!.getRow(HEADER_ROW + 1).getCell(1).value)).toBe('No tickets match these filters.')
  })
})
