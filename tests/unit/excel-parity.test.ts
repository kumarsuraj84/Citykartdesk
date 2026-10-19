/**
 * Checks our report calculations against the Excel report workbook the reports replace: its 95 raw tickets, the columns the
 * workbook worked out itself (age, buckets, months, weeks, OEM age, NSO, AC Not Working %, Red Flag) and one of its pivots.
 * The fixture is an extract of "Citykart Desk Zoho Report.xlsx" (as on 12 Oct 2026, no ticket text).
 */
import { describe, it, expect } from 'vitest'
import fixture from '../fixtures/zoho-report-parity.json'
import { ageBucketLabel } from '@/lib/reporting/aging'
import { buildFixedReport, findFixedReport } from '@/lib/reporting/analytics/fixed-reports'
import { fact } from './helpers/fact'
import { ageInDays, daysFrom, isNsoStore, makeFact, monthLabel, weekOfMonth, type AcFormFields, type RawTicket } from '@/lib/reporting/analytics/facts'

type Row = (typeof fixture.tickets)[number]
const tickets = fixture.tickets as Row[]
const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`)
const asOf = at(fixture.asOf, 12)
const STILL_OPEN = ['Open', 'In Progress', 'Waiting on User']

describe('age and age bucket match the Excel', () => {
  it('counts whole days that have passed: the Excel ages are the calendar difference, or one less for a ticket created later in the day than the report time', () => {
    const open = tickets.filter((t) => STILL_OPEN.includes(t.status) && t.created)
    expect(open.length).toBeGreaterThan(80)
    const calendar = (day: string) => Math.round((new Date(2026, 9, 12).getTime() - new Date(`${day}T00:00:00`).getTime()) / 86_400_000)
    let lower = 0
    for (const t of open) {
      const cal = calendar(t.created!)
      expect([cal, cal - 1], `${t.store} ${t.created}`).toContain(t.age)
      if (t.age === cal - 1) lower++
    }
    expect(lower).toBeGreaterThan(0) // so it is not pure calendar days
    // and our rule gives exactly those two answers, depending on the time of day the ticket was created
    for (const t of open) {
      const earlyInTheDay = ageInDays(at(t.created!, 8).toISOString(), at(fixture.asOf, 17).toISOString()) // created 8 am, looked at 5 pm
      const lateInTheDay = ageInDays(at(t.created!, 20).toISOString(), at(fixture.asOf, 17).toISOString()) // created 8 pm, looked at 5 pm
      expect(lateInTheDay).toBe(earlyInTheDay - 1)
      expect([earlyInTheDay, lateInTheDay], `${t.store} ${t.created}`).toContain(t.age)
    }
  })

  it('a day counts only after 24 hours: created 6 pm yesterday is 0 days old at 10 am today and 1 day old at 6 pm today', () => {
    expect(ageInDays(at('2026-10-11', 18).toISOString(), at('2026-10-12', 10).toISOString())).toBe(0)
    expect(ageInDays(at('2026-10-11', 18).toISOString(), at('2026-10-12', 18).toISOString())).toBe(1)
    expect(ageInDays(at('2026-10-01', 10).toISOString(), at('2026-10-12', 15).toISOString())).toBe(11)
    expect(ageInDays(at('2026-10-12', 0).toISOString(), at('2026-10-12', 23).toISOString())).toBe(0)
    // a ticket never has a negative age
    expect(ageInDays(at('2026-10-12', 10).toISOString(), at('2026-10-12', 9).toISOString())).toBe(0)
  })

  it('puts every age in the bucket the Excel puts it in', () => {
    for (const t of tickets) expect(ageBucketLabel(t.age), `age ${t.age}`).toBe(t.ageBucket)
  })
})

describe('months and weeks match the Excel', () => {
  it('Open Month / Open Week from the created date, Close Month / Close Week from the resolved date', () => {
    for (const t of tickets) {
      const created = at(t.created!)
      expect(monthLabel(created), t.created!).toBe(t.openMonth)
      expect(weekOfMonth(created), t.created!).toBe(t.openWeek)
      if (t.resolved) {
        expect(monthLabel(at(t.resolved))).toBe(t.closeMonth)
        expect(weekOfMonth(at(t.resolved))).toBe(t.closeWeek)
      }
    }
  })

  it('weeks run Monday to Sunday and the 1st of the month always starts Week-1', () => {
    // Oct 2026 starts on a Thursday: Thu 1 - Sun 4 is Week-1, Mon 5 starts Week-2
    expect([1, 4, 5, 11, 12, 26, 31].map((d) => weekOfMonth(new Date(2026, 9, d)))).toEqual(['Week-1', 'Week-1', 'Week-2', 'Week-2', 'Week-3', 'Week-5', 'Week-5'])
    // a month that starts on a Monday has full weeks; one that starts on a Sunday can reach Week-6
    expect(weekOfMonth(new Date(2026, 5, 1))).toBe('Week-1') // Mon 1 Jun 2026
    expect(weekOfMonth(new Date(2026, 5, 7))).toBe('Week-1')
    expect(weekOfMonth(new Date(2026, 5, 8))).toBe('Week-2')
    expect(weekOfMonth(new Date(2026, 2, 31))).toBe('Week-6') // Sun 1 Mar 2026 .. Tue 31 Mar
  })
})

describe('OEM ticket age matches the Excel', () => {
  it('is the days from the OEM ticket date to the day before the report day, in the same buckets (the Excel counts to yesterday; the app counts to today)', () => {
    const withOem = tickets.filter((t) => t.oemDate)
    expect(withOem.length).toBe(7)
    const yesterday = new Date(2026, 9, 11)
    for (const t of withOem) {
      expect(Math.max(0, daysFrom(t.oemDate!, yesterday)), t.oemDate!).toBe(t.oemAge)
      const ours = ageBucketLabel(t.oemAge!).replace(' days', '').replace('–', '-').replace('90+', '>90')
      expect(ours).toBe(t.oemBucket)
      // as on today it is one day more
      expect(daysFrom(t.oemDate!, asOf)).toBe(t.oemAge! + 1)
    }
  })
})

describe('NSO stores match the Excel list', () => {
  const master = new Map(fixture.master.map((m) => [m.store, m]))

  it('every store on the Excel NSO list is NSO by the 9-month rule, and the others are stores with no open date yet', () => {
    const list = new Set(fixture.nso)
    for (const s of list) expect(isNsoStore(master.get(s)?.openDate ?? null, asOf), s).toBe(true)
    const extra = fixture.master.filter((m) => isNsoStore(m.openDate, asOf) && !list.has(m.store))
    expect(extra.length).toBeGreaterThan(0)
    for (const m of extra) expect(m.openDate, `${m.store} has no open date`).toBeNull()
    // and no store the Excel calls regular is NSO by the rule
    const regularButNso = fixture.master.filter((m) => !list.has(m.store) && m.openDate && isNsoStore(m.openDate, asOf))
    expect(regularButNso).toEqual([])
  })

  it('agrees with the NSO column of the tickets', () => {
    for (const t of tickets.filter((x) => x.nso !== null)) {
      expect(isNsoStore(master.get(t.store)?.openDate ?? null, asOf), t.store).toBe(t.nso === 'NSO')
    }
  })

  it('the 9 months run to the same day: opened 14 Feb 2026 is NSO through 14 Nov 2026 and regular from 15 Nov', () => {
    expect(isNsoStore('2026-02-14', new Date(2026, 10, 14))).toBe(true)
    expect(isNsoStore('2026-02-14', new Date(2026, 10, 15))).toBe(false)
    expect(isNsoStore(null, new Date(2030, 0, 1))).toBe(true)
  })
})

describe('AC Not Working % and Red Flag match the Excel', () => {
  const STATUS: Record<string, string> = { Open: 'open', 'In Progress': 'in_progress', 'Waiting on User': 'waiting_user', Resolved: 'resolved', Closed: 'closed', Cancelled: 'cancelled' }
  const masterByStore = new Map(fixture.master.map((m) => [m.store, m]))
  const acFields = new Map<string, AcFormFields>([['ADMIN - AC', { acNo: { id: 'acno' }, oemTicketDate: { id: 'oemdate' } }]])

  const raw = (t: Row, i: number): RawTicket => ({
    id: `t${i}`, request_no: `CK-${i}`, title: 'x', status: STATUS[t.status] ?? t.status, priority: 'medium',
    created_at: at(t.created!).toISOString(), resolved_at: t.resolved ? at(t.resolved).toISOString() : null, closed_at: null,
    form_data: { acno: t.acNo, oemdate: t.oemDate },
    service: { id: t.service, name: t.service, auto_oem_routing: t.service === 'ADMIN - AC' },
    category: { name: t.category }, sub_category: { name: t.subCategory }, assignee: { full_name: t.technician },
    requester: {
      full_name: t.store,
      store: {
        id: t.store, code: t.store, city: null, state: null, cluster: null, region: null, priority_list: null, festival: null,
        ac_total: t.acTotal ?? masterByStore.get(t.store)?.acTotal ?? null, ac_brand: null, ac_amc_brand: null, ac_amc_vendor: null, zenatix: null,
        open_date: masterByStore.get(t.store)?.openDate ?? null,
      },
    },
  })

  // the store's open AC tickets, the way the app counts them (open work only, Server Room AC left out)
  const openAc = new Map<string, number>()
  tickets.forEach((t) => {
    if (t.service === 'ADMIN - AC' && STILL_OPEN.includes(t.status) && t.acNo.trim().toLowerCase() !== 'server room ac') openAc.set(t.store, (openAc.get(t.store) ?? 0) + 1)
  })
  const ctx = { asOf, acFields, openAcByStore: openAc, redFlagPercent: 30 }

  it('open AC tickets of the store, AC Not Working % and Red Flag are the same as the Excel for every AC ticket', () => {
    const closedStores = new Set(tickets.filter((t) => t.service === 'ADMIN - AC' && t.status === 'Closed').map((t) => t.store))
    const acRows = tickets.map((t, i) => ({ t, f: makeFact(raw(t, i), ctx) })).filter(({ t }) => t.service === 'ADMIN - AC')
    expect(acRows.length).toBe(9)
    for (const { t, f } of acRows) {
      if (closedStores.has(t.store)) continue // the Excel also counts Closed tickets as open; the app does not (see below)
      expect(f.storeAcTickets, t.store).toBe(t.totalTicket)
      expect(f.acNotWorkingPct! / 100, t.store).toBeCloseTo(t.acNotWorkingPct!, 10)
      expect(f.redFlag === 'Yes', t.store).toBe(t.redFlag === 'Red Flag')
    }
  })

  it('3 open tickets for a store with 7 ACs is 43%, above the 30% limit, so a red flag; 2 of 7 is 29%, no red flag', () => {
    const f = (open: number) => makeFact(raw({ ...tickets[0], store: 'ZZZ', acTotal: 7 }, 0), { ...ctx, openAcByStore: new Map([['ZZZ', open]]) })
    expect(Math.round(f(3).acNotWorkingPct!)).toBe(43)
    expect(f(3).redFlag).toBe('Yes')
    expect(Math.round(f(2).acNotWorkingPct!)).toBe(29)
    expect(f(2).redFlag).toBe('No')
    // exactly at the limit is not above it
    const exactly = makeFact(raw({ ...tickets[0], store: 'ZZZ', acTotal: 10 }, 0), { ...ctx, openAcByStore: new Map([['ZZZ', 3]]) })
    expect(exactly.acNotWorkingPct).toBeCloseTo(30)
    expect(exactly.redFlag).toBe('No')
  })

  it('every ticket counts, also when two tickets are for the same AC', () => {
    const f = makeFact(raw({ ...tickets[0], store: 'ZZZ', acTotal: 7 }, 0), { ...ctx, openAcByStore: new Map([['ZZZ', 3]]) })
    expect(f.storeAcTickets).toBe(3)
  })

  it('OEM age, store type, months and weeks come out the same through the real ticket code path', () => {
    for (const [i, t] of tickets.entries()) {
      const f = makeFact(raw(t, i), ctx)
      expect(f.openMonth).toBe(t.openMonth)
      expect(f.openWeek).toBe(t.openWeek)
      if (t.service === 'ADMIN - AC') {
        if (t.oemDate) expect(f.oemAgeDays).toBe(t.oemAge! + 1) // as on today
        else { expect(f.oemAgeDays).toBeNull(); expect(f.oemBucket).toBe('') } // the Excel showed "0-5" for these
      }
    }
  })
})

describe('the Admin Summary Report matches the Excel "Admin Zoho Report" pivot', () => {
  it('counts the tickets that are still being worked by Responsible, Category and age bucket exactly as the pivot does', () => {
    const facts = tickets
      .filter((t) => STILL_OPEN.includes(t.status) && ['Arun Das', 'Krishan', 'Shivanshu'].includes(t.responsible))
      .map((t, i) => fact({ ticketNo: `T${i}`, technician: t.responsible, category: t.category, ageDays: t.age, ageBucket: ageBucketLabel(t.age) }))
    const table = buildFixedReport({ def: findFixedReport('admin-summary-report')!, facts, statusLabel: (s) => s })
    const lines = table.rows.filter((r) => r.kind === 'row')
    const cell = (tech: string, cat: string, key: string) => {
      const ci = table.columns.findIndex((c) => c.key === key)
      // a technician's name is only on its first line: walk up to it
      const idx = table.rows.findIndex((r) => r.kind === 'row' && r.key === `${tech}|${cat}`)
      return idx < 0 ? undefined : table.rows[idx].cells[ci]
    }
    expect(fixture.pivot.length).toBeGreaterThan(15)
    for (const p of fixture.pivot) {
      for (const b of fixture.pivotBuckets) expect(cell(p.responsible, p.category, `b:${b}`) || 0, `${p.responsible} / ${p.category} / ${b}`).toBe(p.counts[b as keyof typeof p.counts])
      expect(cell(p.responsible, p.category, 'total'), `${p.responsible} / ${p.category}`).toBe(p.total)
    }
    // and nothing in the report that the pivot does not have
    expect(lines.length).toBe(fixture.pivot.length)
  })
})
