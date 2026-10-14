import { describe, it, expect } from 'vitest'
import { buildFixedReport, findFixedReport, type FixedReportDef } from '@/lib/reporting/analytics/fixed-reports'
import { weeksOfMonth, resolveMonth, resolveMonths, monthHeading } from '@/lib/reporting/analytics/weekly'
import { parseReportFilter } from '@/lib/reporting/analytics/report-filter'
import { cellText, type ReportTable } from '@/lib/reporting/analytics/report-table'
import { fact } from './helpers/fact'

const def = (slug: string) => findFixedReport(slug) as FixedReportDef
const now = new Date('2026-10-14T10:00:00')
const at = (iso: string) => new Date(iso).toISOString()
const cell = (t: ReportTable, rowKey: string, colKey: string) => t.rows.find((r) => r.key === rowKey)!.cells[t.columns.findIndex((c) => c.key === colKey)]

describe('the weeks of a month (Monday to Sunday, cut at the month)', () => {
  it('Week-1 is Friday to Sunday when the 1st is a Friday, then full weeks', () => {
    // 1 May 2026 is a Friday
    const w = weeksOfMonth(2026, 5)
    expect(w.map((x) => [x.week, x.from.getDate(), x.to.getDate()])).toEqual([[1, 1, 3], [2, 4, 10], [3, 11, 17], [4, 18, 24], [5, 25, 31]])
  })
  it('a month starting on a Monday has 5 weeks and ends on the 30th', () => {
    // 1 June 2026 is a Monday
    const w = weeksOfMonth(2026, 6)
    expect(w.map((x) => [x.from.getDate(), x.to.getDate()])).toEqual([[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]])
  })
  it('a month can have six weeks', () => {
    // 1 Aug 2026 is a Saturday: 1-2, 3-9, 10-16, 17-23, 24-30, 31
    expect(weeksOfMonth(2026, 8)).toHaveLength(6)
  })
})

describe('months of the monthly reports', () => {
  it('lists chosen months oldest first, without repeats or junk', () => {
    expect(resolveMonths('2026-05,2026-04,2026-05,junk,2026-13', now).map((m) => m.value)).toEqual(['2026-04', '2026-05'])
  })
  it('is this month and the two before it when none is chosen', () => {
    expect(resolveMonths('', now).map((m) => m.value)).toEqual(['2026-08', '2026-09', '2026-10'])
  })
  it('headings read like the Excel sheet: 01-Apr-26', () => {
    expect(monthHeading(resolveMonth('2026-04', now))).toBe('01-Apr-26')
  })
  it('the month filter keeps one or many months and drops anything else', () => {
    expect(parseReportFilter({ month: '2026-04,2026-05' }).month).toBe('2026-04,2026-05')
    expect(parseReportFilter({ month: '2026-5' }).month).toBe('')
    expect(parseReportFilter({}).month).toBe('')
  })
})

describe('Monthly Admin Report and Priority Wise Report', () => {
  const months = resolveMonths('2026-04,2026-05', now)
  const stores = [{ brand: 'HITACHI', stores: 46, acs: 388 }, { brand: 'BLUE STAR', stores: 95, acs: 976 }]
  const hit1 = fact({ ticketNo: 'CKSD-1', acAmcBrand: 'HITACHI', priorityList: 'ROS', openMonth: 'Apr-26', openWeek: 'Week-2', createdAt: at('2026-04-08T10:00:00'), status: 'resolved', doneAt: at('2026-05-03T10:00:00'), resolvedAt: at('2026-05-03T10:00:00') })
  const hit2 = fact({ ticketNo: 'CKSD-2', acAmcBrand: 'HITACHI', priorityList: 'TOP 40', openMonth: 'May-26', openWeek: 'Week-1', createdAt: at('2026-05-02T10:00:00') })
  const blu1 = fact({ ticketNo: 'CKSD-3', acAmcBrand: 'BLUE STAR', priorityList: 'ROS', openMonth: 'Apr-26', openWeek: 'Week-1', createdAt: at('2026-04-02T10:00:00'), status: 'closed', doneAt: at('2026-04-20T10:00:00') })

  it('one row per AMC brand, an Open / Resolved pair per chosen month, totals and a Grand Total', () => {
    const t = buildFixedReport({ def: def('monthly-admin-report'), facts: [hit1, hit2, blu1], statusLabel: (s) => s, months, amcStores: stores })
    expect(t.columns.map((c) => c.label)).toEqual(['AMC BRAND', 'Total Store Count', 'Total AC Count', 'Open', 'Resolved', 'Open', 'Resolved', 'Open', 'Resolved', '% Diff'])
    expect(t.headGroups.map((g) => g.label)).toEqual(['01-Apr-26', '01-May-26', 'Total'])
    expect(cell(t, 'HITACHI', 'stores')).toBe(46)
    // HITACHI: opened Apr 1 / May 1; resolved May 1
    expect([cell(t, 'HITACHI', 'o0'), cell(t, 'HITACHI', 'c0'), cell(t, 'HITACHI', 'o1'), cell(t, 'HITACHI', 'c1')]).toEqual([1, 0, 1, 1])
    // BLUE STAR: opened Apr 1, resolved Apr 1
    expect([cell(t, 'BLUE STAR', 'o0'), cell(t, 'BLUE STAR', 'c0')]).toEqual([1, 1])
    expect([cell(t, 'grand', 'stores'), cell(t, 'grand', 'acs'), cell(t, 'grand', 'to'), cell(t, 'grand', 'tc')]).toEqual([141, 1364, 3, 2])
    // % Diff = (resolved - opened) / opened, shown whole
    expect(cell(t, 'grand', 'pct')).toBeCloseTo(-1 / 3)
    expect(cellText(cell(t, 'grand', 'pct'), t.columns[t.columns.length - 1])).toBe('-33%')
  })

  it('the Priority Wise Report groups by priority list, TOP lists first', () => {
    const t = buildFixedReport({ def: def('priority-wise-report'), facts: [hit1, hit2, blu1], statusLabel: (s) => s, months, amcStores: [{ brand: 'ROS', stores: 184, acs: 1706 }, { brand: 'TOP 40', stores: 40, acs: 400 }] })
    expect(t.columns[0].label).toBe('PRIORITY STORE')
    expect(t.rows.map((r) => r.key)).toEqual(['TOP 40', 'ROS', 'grand'])
    expect(cell(t, 'ROS', 'o0')).toBe(2)
  })

  it('the Weekly Admin Report has a pair per week of the month, Week-1 starting on the 1st', () => {
    const month = resolveMonth('2026-05', now)
    const t = buildFixedReport({ def: def('weekly-admin-report'), facts: [hit2], statusLabel: (s) => s, month, amcStores: stores })
    expect(t.headGroups.map((g) => g.label)).toEqual(['Week-1', 'Week-2', 'Week-3', 'Week-4', 'Week-5', 'Total'])
    expect(cell(t, 'HITACHI', 'o0')).toBe(1)
  })
})
