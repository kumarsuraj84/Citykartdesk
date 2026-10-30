// Audit fixes (P3): India days, one age rule, one overdue rule, honest percentages, pivot totals, CSV guard, paging.
import { describe, it, expect } from 'vitest'
import {
  istToday, isOverdueDate, isDueToday, istDayStartIso, istAddDays, istRangeIso, istParts, istDay,
} from '@/lib/reporting/ist'
import { ageInDays, ageBucketLabel } from '@/lib/reporting/aging'
import { isNsoStore } from '@/lib/reporting/analytics/facts'
import { resolvePeriodParam, wholePercent, periodStart, TREND_DAILY_MAX_DAYS } from '@/lib/queries/analytics'
import { toCSV, countCsvRecords, neutraliseFormula } from '@/lib/export/csv'
import { computePivot } from '@/lib/reporting/pivot-engine'
import { formatMeasure, breachedAt, openAt, formatMeasure as fm, type ExecTicket } from '@/lib/reporting/executive/engine'
import { mergeByKey } from '@/lib/desktime/sync'
import { resolveDateRange, formatDay } from '@/lib/reporting/analytics/date-ranges'
import type { ReportField } from '@/lib/reporting/field-registry'

describe('India days (explicit +05:30, whatever zone the server runs in)', () => {
  it('today is the India day: 20:00 UTC on 28 Oct is already 29 Oct in India', () => {
    expect(istToday(new Date('2026-10-28T20:00:00Z'))).toBe('2026-10-29')
    expect(istToday(new Date('2026-10-28T18:29:00Z'))).toBe('2026-10-28')
  })

  it('a task due today is NOT overdue; yesterday is; a due date is judged by its day, not as midnight UTC', () => {
    expect(isOverdueDate('2026-10-29', '2026-10-29')).toBe(false)
    expect(isOverdueDate('2026-10-28', '2026-10-29')).toBe(true)
    expect(isOverdueDate(null, '2026-10-29')).toBe(false)
    expect(isDueToday('2026-10-29', '2026-10-29')).toBe(true)
    // a timestamp-shaped value keeps only its day
    expect(isOverdueDate('2026-10-29T00:00:00+00:00', '2026-10-29')).toBe(false)
  })

  it('day boundaries are fixed +05:30 moments, and a range is [from 00:00, day after to 00:00)', () => {
    expect(istDayStartIso('2026-10-29')).toBe('2026-10-29T00:00:00+05:30')
    expect(istAddDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(istAddDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(istRangeIso('2026-10-01', '2026-10-31')).toEqual({ gte: '2026-10-01T00:00:00+05:30', lt: '2026-11-01T00:00:00+05:30' })
  })

  it('weekday and hour are India time', () => {
    // 20:00 UTC Wednesday = 01:30 Thursday in India
    expect(istParts('2026-10-28T20:00:00Z')).toMatchObject({ day: '2026-10-29', weekday: 4, hour: 1, minute: 30 })
    expect(istDay(Date.parse('2026-10-28T20:00:00Z'))).toBe('2026-10-29')
  })

  it('a one-day custom range is 1 day (not 2), counted over the India day', () => {
    const r = resolvePeriodParam({ from: '2026-10-05', to: '2026-10-05' })
    expect(r.days).toBe(1)
    expect(r.start.toISOString()).toBe('2026-10-04T18:30:00.000Z')
    expect(r.end.toISOString()).toBe('2026-10-05T18:29:59.999Z')
    expect(resolvePeriodParam({ from: '2026-10-01', to: '2026-10-30' }).days).toBe(30)
  })

  it('a range may carry exact moments (a rolling 24 hours) and the list uses the same ones', () => {
    const asOf = Date.parse('2026-10-29T10:00:00Z')
    const r = resolvePeriodParam({ from: '2026-10-28', to: '2026-10-29', fromMs: asOf - 86_400_000, toMs: asOf })
    expect(r.start.getTime()).toBe(asOf - 86_400_000)
    expect(r.end.getTime()).toBe(asOf)
  })

  it('"last 30 days" starts at India midnight 29 days before today', () => {
    const start = periodStart('30d')
    expect(start.toISOString().slice(11)).toBe('18:30:00.000Z') // midnight India = 18:30 UTC the day before
  })

  it('one threshold decides daily or weekly trend points', () => {
    expect(TREND_DAILY_MAX_DAYS).toBe(60)
  })

  it('the report date presets use India days (no server-zone dependence)', () => {
    const r = resolveDateRange('today', undefined, undefined, new Date('2026-10-28T20:00:00Z'))
    expect(r.from?.toISOString()).toBe('2026-10-28T18:30:00.000Z')
    expect(formatDay(r.from as Date)).toBe('29 Oct 2026')
    const c = resolveDateRange('custom', '2026-10-01', '2026-10-31')
    expect(c.to?.toISOString()).toBe('2026-10-31T18:29:59.999Z')
  })
})

describe('one age rule (whole elapsed days, rounded down)', () => {
  const created = '2026-10-01T00:00:00Z'
  it('5 days 6 hours and 5 days 14 hours are both 5 days, both in "0–5 days"', () => {
    const a = ageInDays(created, new Date('2026-10-06T06:00:00Z'))
    const b = ageInDays(created, new Date('2026-10-06T14:00:00Z'))
    expect(a).toBe(5)
    expect(b).toBe(5)
    expect(ageBucketLabel(a)).toBe(ageBucketLabel(b))
    expect(ageBucketLabel(b)).toBe('0–5 days')
    expect(ageBucketLabel(ageInDays(created, new Date('2026-10-07T00:00:00Z')))).toBe('6–10 days')
  })
  it('never negative', () => {
    expect(ageInDays('2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z')).toBe(0)
  })
})

describe('NSO window does not overflow into the next month', () => {
  it('opened 31 May + 9 months ends 28 Feb, not 3 Mar', () => {
    // 28 Feb 2027 is still NSO; 1 Mar 2027 is regular
    expect(isNsoStore('2026-05-31', new Date(2027, 1, 28))).toBe(true)
    expect(isNsoStore('2026-05-31', new Date(2027, 2, 1))).toBe(false)
  })
})

describe('percentages never round up to 100', () => {
  it('99.6% shows as 99, only all-of-them is 100', () => {
    expect(wholePercent(996, 1000)).toBe(99)
    expect(wholePercent(1000, 1000)).toBe(100)
    expect(wholePercent(1, 1000)).toBe(1)
    expect(wholePercent(0, 10)).toBe(0)
    expect(wholePercent(0, 0)).toBe(0)
  })
  it('the executive SLA % shows one decimal just below 100', () => {
    expect(formatMeasure('sla', 99.6)).toBe('99.6%')
    expect(formatMeasure('sla', 100)).toBe('100%')
    expect(fm('sla', 83.2)).toBe('83%')
  })
})

const tk = (over: Partial<ExecTicket>): ExecTicket => ({
  id: 'x', no: 'N', subject: '', group: 'g', tech: 't', cat: '', sub: '', svc: '', req: '', dept: '', loc: '', store: '', state: '', oem: '', brand: '', cluster: '', region: '', stype: '', plist: '',
  acb: '', amb: '', amv: '', ac: '', acTotal: null, acOpen: 0, acPct: null, src: '', prio: 'low', status: 'open', created: 0, resolved: null, closed: null, due: 1000, tatH: null, breached: false,
  csat: null, reo: [], frH: null, ...over,
})

describe('a ticket whose clock is stopped is not breached', () => {
  it('waiting_user, hold_purchase_ho and pending_approval are never currently breached; an ordinary open ticket past its deadline is', () => {
    for (const s of ['waiting_user', 'hold_purchase_ho', 'pending_approval']) expect(breachedAt(tk({ status: s }), 5000)).toBe(false)
    expect(breachedAt(tk({ status: 'in_progress' }), 5000)).toBe(true)
    expect(openAt(tk({ status: 'waiting_user' }), 5000)).toBe(true) // still open, just not breached
  })
})

describe('pivot totals use the field own aggregate (not the cells added together)', () => {
  const fields: ReportField[] = [
    { key: 'team', label: 'Team', type: 'string' },
    { key: 'kind', label: 'Kind', type: 'string' },
    { key: 'hours', label: 'Hours', type: 'number' },
    { key: 'bucket', label: 'Bucket', type: 'string' },
  ]
  const rows = [
    { team: 'A', kind: 'x', hours: 4, bucket: '11–20 days' },
    { team: 'A', kind: 'x', hours: 6, bucket: '0–5 days' },
    { team: 'A', kind: 'y', hours: 7, bucket: '6–10 days' },
    { team: 'B', kind: 'x', hours: 10, bucket: '90+ days' },
  ]
  it('average: the Total column is the average of all the row records (5 and 7 do not add to 12)', () => {
    const res = computePivot(rows, { rowFields: ['team'], colFields: ['kind'], valueFields: [{ field: 'hours', agg: 'avg' }], filters: [] }, fields)
    const a = res.rows.find((r) => r.label === 'A')!
    expect(a.cells.map((c) => c[0])).toEqual([5, 7]) // kind x: avg(4,6) = 5, kind y: 7
    expect(a.rowTotal[0]).toBeCloseTo(17 / 3) // not 12
    expect(res.grandRowTotal[0]).toBeCloseTo(27 / 4)
  })
  it('min / max / distinct count are right too', () => {
    const base = { rowFields: ['team'], colFields: ['kind'], filters: [] }
    const min = computePivot(rows, { ...base, valueFields: [{ field: 'hours', agg: 'min' }] }, fields)
    expect(min.rows.find((r) => r.label === 'A')!.rowTotal[0]).toBe(4)
    expect(min.grandRowTotal[0]).toBe(4)
    const max = computePivot(rows, { ...base, valueFields: [{ field: 'hours', agg: 'max' }] }, fields)
    expect(max.grandRowTotal[0]).toBe(10)
    const dist = computePivot(rows, { ...base, valueFields: [{ field: 'team', agg: 'countDistinct' }] }, fields)
    expect(dist.rows.find((r) => r.label === 'A')!.rowTotal[0]).toBe(1) // not 2
    expect(dist.grandRowTotal[0]).toBe(2)
  })
  it('sum and count totals are unchanged', () => {
    const res = computePivot(rows, { rowFields: ['team'], colFields: ['kind'], valueFields: [{ field: 'hours', agg: 'sum' }], filters: [] }, fields)
    expect(res.rows.find((r) => r.label === 'A')!.rowTotal[0]).toBe(17)
    expect(res.grandRowTotal[0]).toBe(27)
  })
  it('groups are listed in natural order: age buckets 0–5, 6–10, 11–20 ... 90+', () => {
    const res = computePivot(rows, { rowFields: ['bucket'], colFields: [], valueFields: [{ field: 'hours', agg: 'sum' }], filters: [] }, fields)
    expect(res.rows.map((r) => r.label)).toEqual(['0–5 days', '6–10 days', '11–20 days', '90+ days'])
  })
})

describe('CSV', () => {
  it('a negative number stays a number; text that looks like a formula is neutralised', () => {
    expect(neutraliseFormula(-5)).toBe('-5')
    expect(neutraliseFormula('-12.5')).toBe('-12.5')
    expect(neutraliseFormula('=1+1')).toBe("'=1+1")
    expect(neutraliseFormula('-cmd|x')).toBe("'-cmd|x")
    expect(neutraliseFormula('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(toCSV([{ n: -5, t: '=bad' }], [{ key: 'n', label: 'N' }, { key: 't', label: 'T' }])).toBe("N,T\r\n-5,'=bad")
  })
  it('counts records, not lines: a quoted cell can hold line breaks', () => {
    const csv = toCSV([{ a: 'one\ntwo', b: 'x' }, { a: 'three', b: 'y' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }])
    expect(csv.split(/\r?\n/).length).toBe(4)
    expect(countCsvRecords(csv)).toBe(3) // header + 2 rows
    expect(countCsvRecords('')).toBe(0)
  })
})

describe('DeskTime upsert batches', () => {
  it('rows with the same key become one row with their minutes added', () => {
    const out = mergeByKey([
      { k: 'a', minutes: 10 }, { k: 'b', minutes: 5 }, { k: 'a', minutes: 7 },
    ], (r) => r.k)
    expect(out).toEqual([{ k: 'a', minutes: 17 }, { k: 'b', minutes: 5 }])
  })
})
