// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/lib/actions/fixedReportExport', () => ({ exportFixedReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { FIXED_REPORTS, REPORTS_FOLDER, REPORTS_NAME, buildFixedReport, findFixedReport, normName, type FixedReportDef } from '@/lib/reporting/analytics/fixed-reports'
import { buildReportWorkbook, XLSX_HEAD_ROW } from '@/lib/reporting/analytics/report-table-xlsx'
import { cellText, shortDate, type ReportTable } from '@/lib/reporting/analytics/report-table'
import { ReportTableView } from '@/components/reports/analytics/ReportTableView'
import { fact } from './helpers/fact'

afterEach(() => cleanup())

const def = (slug: string) => findFixedReport(slug) as FixedReportDef
const build = (slug: string, facts: ReturnType<typeof fact>[], extra: Partial<Parameters<typeof buildFixedReport>[0]> = {}) =>
  buildFixedReport({ def: def(slug), facts, statusLabel: (s) => s, ...extra })
const col = (t: ReportTable, key: string) => t.columns.findIndex((c) => c.key === key)
const lines = (t: ReportTable) => t.rows.map((r) => `${r.kind}:${t.columns.slice(0, t.lead).map((_, i) => r.cells[i]).filter((v) => v !== '').join('/')}`)

describe('the fixed reports are the sheets of the Excel report, under their names', () => {
  it('has exactly the fifteen reports, in the order of the sheets (the last three are the weekly, monthly and priority-wise ones)', () => {
    expect(FIXED_REPORTS.map((r) => r.title)).toEqual([
      '🚩Red Flag Store Report', 'Store AC Not Working Report', 'AMC Vendor Report', 'Store Side Pending Tickets Report', 'AC Issues Report',
      'Repair & Maintenance Report', 'Admin Requirement Report', 'NSO Status Report', 'NSO Summary Report', 'BD Status Report', 'BD Summary Report', 'Admin Summary Report',
      'Weekly Admin Report', 'Monthly Admin Report', 'Priority Wise Report',
    ])
    expect(new Set(FIXED_REPORTS.map((r) => r.slug)).size).toBe(15)
    expect(REPORTS_NAME).toBe('Predefined Reports')
    expect(REPORTS_FOLDER).toBe('Admin/NSO/BD Reports')
  })
  it('no name has CKDESK or ckdesk in it', () => {
    for (const r of FIXED_REPORTS) expect(r.title).not.toMatch(/ckdesk/i)
  })
  it('compares service names ignoring capitals and punctuation', () => {
    expect(normName('ADMIN - REQUIREMENTS (NON TRADING)')).toBe(normName('Admin Requirements (Non Trading)'))
    expect(normName('ADMIN - AC')).not.toBe(normName('ADMIN REPAIR'))
  })
})

const t1 = fact({ ticketNo: 'CKSD-1', technician: 'Arun Das', category: 'HANGERS', subCategory: 'SHOE HANGER', cluster: 'BR2', store: 'BBR', requester: 'BBR', ageDays: 2, ageBucket: '0–5 days' })
const t2 = fact({ ticketNo: 'CKSD-2', technician: 'Arun Das', category: 'HANGERS', subCategory: 'SLIPPER HANGER', cluster: 'BR2', store: 'BBR', requester: 'BBR', ageDays: 8, ageBucket: '6–10 days' })
const t3 = fact({ ticketNo: 'CKSD-3', technician: 'Arun Das', category: 'MAT', subCategory: 'MAT RED', cluster: 'BR3', store: 'SBP', requester: 'SBP', ageDays: 3, ageBucket: '0–5 days' })
const t4 = fact({ ticketNo: 'CKSD-4', technician: 'Krishan', category: 'ADMIN AC ISSUE', subCategory: 'COOLING ISSUE', cluster: 'JH1', store: 'LSR', requester: 'LSR', ageDays: 12, ageBucket: '11–20 days' })

describe('summary reports (Admin / BD / NSO)', () => {
  it('lists each technician once with their categories, a Total line per technician and a Grand Total', () => {
    const t = build('admin-summary-report', [t1, t2, t3, t4])
    expect(t.columns.map((c) => c.label)).toEqual(['Responsible', 'Category', '0–5 days', '6–10 days', '11–20 days', 'Total Tickets', 'Created today', 'Resolved today'])
    expect(lines(t)).toEqual(['row:Arun Das/HANGERS', 'row:MAT', 'subtotal:Arun Das Total', 'row:Krishan/ADMIN AC ISSUE', 'subtotal:Krishan Total', 'grand:Grand Total'])
    const grand = t.rows.at(-1)!
    expect(grand.cells.slice(2)).toEqual([2, 1, 1, 4, '', ''])
    expect(t.scopeText).toContain('4 tickets')
  })
  it('every number points at the tickets behind it, a blank does not', () => {
    const t = build('admin-summary-report', [t1, t2, t3, t4])
    const hangers = t.rows[0]
    const tickets = (ci: number) => (hangers.refs[ci] ?? []).map((i) => t.tickets[i].no)
    expect(tickets(col(t, 'b:0–5 days'))).toEqual(['CKSD-1'])
    expect(tickets(col(t, 'b:6–10 days'))).toEqual(['CKSD-2'])
    expect(tickets(col(t, 'total'))).toEqual(['CKSD-1', 'CKSD-2'])
    expect(hangers.refs[col(t, 'b:11–20 days')]).toBeUndefined()
    expect(hangers.refs[0]).toBeUndefined()
    expect((t.rows.at(-1)!.refs[col(t, 'total')] ?? []).length).toBe(4)
  })
  it('counts what was created and resolved on the day, also for a technician with nothing else', () => {
    const day = { start: new Date('2026-10-12T00:00:00'), end: new Date('2026-10-12T23:59:59'), word: 'today' }
    const created = fact({ ticketNo: 'CKSD-5', technician: 'Arun Das', category: 'HANGERS', createdAt: new Date('2026-10-12T09:00:00').toISOString() })
    const resolved = fact({ ticketNo: 'CKSD-6', technician: 'Mohit', category: 'FAN', status: 'resolved', createdAt: '2026-10-01T09:00:00.000Z', resolvedAt: new Date('2026-10-12T11:00:00').toISOString() })
    const cancelled = fact({ ticketNo: 'CKSD-7', technician: 'Arun Das', category: 'HANGERS', status: 'cancelled', createdAt: new Date('2026-10-12T09:30:00').toISOString() })
    const t = build('admin-summary-report', [t1], { dayFacts: [created, resolved, cancelled], day })
    const hangers = t.rows.find((r) => r.key === 'Arun Das|HANGERS')!
    expect(hangers.cells[col(t, 'created')]).toBe(1)
    const mohit = t.rows.find((r) => r.key === 'Mohit|FAN')!
    expect(mohit.cells[col(t, 'resolved')]).toBe(1)
    expect(mohit.cells[col(t, 'total')]).toBe('')
    expect(t.rows.at(-1)!.cells[col(t, 'created')]).toBe(1)
  })
  it('an empty report has no rows', () => { expect(build('bd-summary-report', []).rows).toEqual([]) })
})

describe('status reports (NSO / BD)', () => {
  it('lists each ticket under its technician, repeats the technician, and totals them only when there are several', () => {
    const t = build('nso-status-report', [t1, t2, t3, t4])
    expect(t.columns.map((c) => c.label).slice(0, 8)).toEqual(['Responsible', 'CLUSTER', 'Requester', 'Category', 'Sub Category', 'Subject', 'Request #', '0–5 days'])
    expect(lines(t)).toEqual(['row:Arun Das/BR2', 'row:Arun Das/BR2', 'row:Arun Das/BR3', 'subtotal:Arun Das Total', 'row:Krishan/JH1', 'subtotal:Krishan Total', 'grand:Grand Total'])
    expect(build('bd-status-report', [t4]).rows.map((r) => r.kind)).toEqual(['row', 'grand'])
  })
  it('each ticket line is clickable in every column and a 1 sits in its age bucket', () => {
    const t = build('nso-status-report', [t1])
    const r = t.rows[0]
    expect(r.cells.slice(col(t, 'b:0–5 days'))).toEqual([1, 1])
    expect(r.refs.every((x) => x?.length === 1)).toBe(true)
    expect(t.tickets[r.refs[0]![0]].no).toBe('CKSD-1')
  })
})

describe('cluster list reports (Store Side Pending / AC Issues / Repair / Requirement)', () => {
  it('groups by cluster with a "<cluster> Total" line, a Status column except where the report is about one status', () => {
    const issues = build('ac-issues-report', [t1, t2, t3])
    expect(issues.columns.map((c) => c.label).slice(0, 8)).toEqual(['CLUSTER', 'Requester', 'Category', 'Sub Category', 'Subject', 'Request #', 'Created', 'Status'])
    expect(lines(issues)).toEqual(['row:BR2/BBR', 'row:BR2/BBR', 'subtotal:BR2 Total', 'row:BR3/SBP', 'subtotal:BR3 Total', 'grand:Grand Total'])
    const pending = build('store-side-pending-tickets-report', [t1])
    expect(pending.columns.map((c) => c.label)).not.toContain('Status')
    expect(shortDate('2026-10-02')).toBe('02-Oct-26')
  })
  it('a Total line counts its cluster per bucket', () => {
    const t = build('repair-maintenance-report', [t1, t2, t3])
    const br2 = t.rows.find((r) => r.key === 'BR2|total')!
    expect(br2.cells.slice(col(t, 'b:0–5 days'))).toEqual([1, 1, 2])
  })
})

describe('AC reports', () => {
  const ac = (no: string, store: string, o: Partial<ReturnType<typeof fact>> = {}) =>
    fact({ ticketNo: no, store, requester: store, acTotal: 10, acAmcBrand: 'DAIKIN', acAmcVendor: 'SHREYASH', ...o })

  it('Store AC Not Working: a line per store with its tickets by age, worst first, with no Sum of Ticket % columns', () => {
    const a = ac('A1', 'LSR', { acNotWorkingPct: 40, redFlag: 'Yes', ageBucket: '0–5 days' })
    const b = ac('A2', 'LSR', { acNotWorkingPct: 40, redFlag: 'Yes', ageBucket: '6–10 days' })
    const c = ac('A3', 'KGP', { acNotWorkingPct: 10, redFlag: 'No', ageBucket: '0–5 days' })
    const t = build('store-ac-not-working-report', [c, a, b])
    expect(t.rows.map((r) => r.cells[0])).toEqual(['LSR', 'KGP', 'Grand Total'])
    expect(t.headGroups.map((g) => g.label)).toEqual(['Ticket'])
    expect(t.columns.map((c) => c.label).some((l) => /%/.test(l))).toBe(false)
    expect(t.columns.at(-1)?.label).toBe('Total Ticket')
    const lsr = t.rows[0]
    expect(lsr.cells[col(t, 'total')]).toBe(2)
    expect(lsr.cells[col(t, 'b:0–5 days')]).toBe(1)
    const grand = t.rows.at(-1)!
    expect(grand.cells[col(t, 'total')]).toBe(3)
    expect(grand.cells.length).toBe(t.columns.length)
  })
  it('Red Flag Store: only stores above 30%, and the Server Room AC is not one of a store’s ACs', () => {
    const red = ac('A1', 'LSR', { acNotWorkingPct: 40, redFlag: 'Yes' })
    const fine = ac('A2', 'KGP', { acNotWorkingPct: 10, redFlag: 'No' })
    const server = ac('A3', 'ZZZ', { acNotWorkingPct: 90, redFlag: 'Yes', acNo: 'Server Room AC' })
    const t = build('red-flag-store-report', [red, fine, server])
    expect(t.rows.map((r) => r.cells[0])).toEqual(['LSR', 'Grand Total'])
    expect(t.headGroups).toEqual([])
    expect(t.columns.map((c) => c.label).some((l) => /%/.test(l))).toBe(false)
  })
  it('AMC Vendor: a line per ticket by AMC brand and vendor with the OEM ticket and the store’s AC Not Working %', () => {
    const a = ac('A1', 'LSR', { acNo: '9', oemTicketNo: 'B26', oemTicketDate: '2026-10-02', oemBucket: '6-10' })
    const b = ac('A2', 'LSR', { acNo: '14' })
    const t = build('amc-vendor-report', [a, b])
    expect(t.columns.map((c) => c.label)).toEqual(expect.arrayContaining(['AMC BRAND', 'AMC VENDOR', 'AC Serial Number', 'AC OEM Ticket Number', 'OEM Age Bucket', 'AC Not Working%']))
    expect(t.rows).toHaveLength(3)
    expect(t.rows[0].cells[col(t, 'oemdate')]).toBe('02-Oct-26')
    expect(t.rows[0].cells[col(t, 'total')]).toBe(2)
    expect(t.rows[0].cells[col(t, 'pct')]).toBeCloseTo(0.2)
    // clicking the store's totals opens both of its tickets
    expect(t.rows[0].refs[col(t, 'total')]).toHaveLength(2)
  })
})

describe('the report on screen', () => {
  const table = build('admin-summary-report', [t1, t2, t3, t4])
  const renderIt = () => render(<ReportTableView table={table} />)

  it('is the Excel table as it is: one heading row, a Total line per technician, a Grand Total, nothing to fold or choose', () => {
    renderIt()
    expect([...document.querySelectorAll('thead th')].map((c) => c.textContent)).toEqual(['Responsible', 'Category', '0–5 days', '6–10 days', '11–20 days', 'Total Tickets', 'Created today', 'Resolved today'])
    const body = [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '')
    expect(body.some((t) => t.startsWith('Arun Das Total'))).toBe(true)
    expect(body.at(-1)!.startsWith('Grand Total')).toBe(true)
    expect(screen.queryByRole('button', { name: /collapse|expand/i })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('every value with tickets is a button; the pop-up breaks it down and lists the tickets; Escape closes it', () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Arun Das · HANGERS, Total Tickets: 2' }))
    const dlg = screen.getByRole('dialog')
    expect(dlg.textContent).toContain('2 tickets')
    expect(within(dlg).getByText('SHOE HANGER')).toBeTruthy()
    expect(within(dlg).getByText('SLIPPER HANGER')).toBeTruthy()
    expect(within(dlg).getAllByRole('link').map((a) => a.textContent).sort()).toEqual(['CKSD-1', 'CKSD-2'])
    fireEvent.click(within(dlg).getByRole('button', { name: /SHOE HANGER/ }))
    expect(within(dlg).getAllByRole('link').map((a) => a.textContent)).toEqual(['CKSD-1'])
    expect(within(dlg).getAllByRole('link')[0].getAttribute('href')).toBe('/requests/CKSD-1')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a ticket line is clickable in every column and the Grand Total opens every ticket', () => {
    render(<ReportTableView table={build('nso-status-report', [t1])} />)
    fireEvent.click(screen.getByRole('button', { name: /Subject: Subject CKSD-1/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    cleanup()
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Grand Total, Total Tickets: 4' }))
    expect(within(screen.getByRole('dialog')).getAllByRole('link')).toHaveLength(4)
  })

  it('says so when there is nothing to show', () => {
    render(<ReportTableView table={build('bd-summary-report', [])} />)
    expect(screen.getByText('No tickets for this report right now')).toBeTruthy()
  })

  it('freezes the heading and the leading columns', () => {
    renderIt()
    expect(document.querySelector('thead')!.className).toContain('sticky')
    const first = document.querySelector('tbody tr td') as HTMLElement
    expect(first.className).toContain('md:sticky')
    expect(first.style.backgroundColor).not.toBe('')
    expect(document.querySelector('table')!.parentElement!.className).toContain('overflow-auto')
  })
})

describe('Excel is the same table', () => {
  it('writes the title, the heading and every line, with the Total lines and Grand Total', async () => {
    const ExcelJS = (await import('exceljs')).default
    const t = build('admin-summary-report', [t1, t2, t3, t4])
    const wb = buildReportWorkbook(t, new Date('2026-10-12T10:00:00'))
    const read = new ExcelJS.Workbook()
    await read.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer)
    const ws = read.worksheets[0]
    expect(ws.name).toBe('Admin Summary Report')
    expect(ws.getRow(1).getCell(1).value).toBe('Admin Summary Report')
    const row = (n: number) => Array.from({ length: t.columns.length }, (_, i) => ws.getRow(n).getCell(i + 1).value ?? '')
    expect(row(XLSX_HEAD_ROW)).toEqual(['Responsible', 'Category', '0–5 days', '6–10 days', '11–20 days', 'Total Tickets', 'Created today', 'Resolved today'])
    expect(row(XLSX_HEAD_ROW + 1)).toEqual(['Arun Das', 'HANGERS', 1, 1, '', 2, '', ''])
    expect(row(XLSX_HEAD_ROW + 3).slice(0, 2)).toEqual(['Arun Das Total', 'Arun Das Total']) // the merged label
    expect(row(ws.rowCount).slice(2)).toEqual([2, 1, 1, 4, '', ''])
  })
  it('keeps the heading groups, and writes percentages (the AMC Vendor report’s AC Not Working%) as percentages', async () => {
    const ExcelJS = (await import('exceljs')).default
    const g = build('store-ac-not-working-report', [fact({ ticketNo: 'A0', store: 'LSR', requester: 'LSR', acNotWorkingPct: 20, ageBucket: '0–5 days' })])
    const gr = new ExcelJS.Workbook()
    await gr.xlsx.load((await buildReportWorkbook(g).xlsx.writeBuffer()) as ArrayBuffer)
    expect(gr.worksheets[0].getRow(XLSX_HEAD_ROW).getCell(8).value).toBe('Ticket')
    const t = build('amc-vendor-report', [fact({ ticketNo: 'A1', store: 'LSR', requester: 'LSR', acNotWorkingPct: 20, ageBucket: '0–5 days' })])
    const read = new ExcelJS.Workbook()
    await read.xlsx.load((await buildReportWorkbook(t).xlsx.writeBuffer()) as ArrayBuffer)
    const ws = read.worksheets[0]
    expect(ws.getRow(XLSX_HEAD_ROW + 1).getCell(col(t, 'pct') + 1).numFmt).toBe('0.0%')
  })
})

// ── the group, service, technician and status filters ──────────────────────────────────────────
import {
  applyReportFilterToParams, choiceFromEffective, effectiveFilter, emptyReportFilter, linkedOptions, parseReportFilter, type FilterCombo, type FilterDefaults,
} from '@/lib/reporting/analytics/report-filter'
import { ReportFilters } from '@/components/reports/analytics/ReportFilters'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/reports/analytics/admin-summary-report' }))

const G1 = '11111111-1111-4111-8111-111111111111' // Admin group
const G2 = '22222222-2222-4222-8222-222222222222' // BD group
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // ADMIN - AC (Admin)
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // ADMIN REPAIR (Admin)
const S3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // BD (BD)
const OPEN = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval']
const combos: FilterCombo[] = [
  { group: G1, service: S1, status: 'open', tech: 'Krishan', count: 3 }, { group: G1, service: S2, status: 'in_progress', tech: 'Shivanshu', count: 2 },
  { group: G1, service: S2, status: 'open', tech: 'Shivanshu', count: 4 }, { group: G2, service: S3, status: 'open', tech: 'Mukesh', count: 5 },
  { group: G2, service: S3, status: 'resolved', tech: 'Mukesh', count: 9 },
]
const groups = [{ id: G1, name: 'ADMIN GROUP' }, { id: G2, name: 'BD Group' }]
const services = [{ id: S1, name: 'ADMIN - AC', groupId: G1 }, { id: S2, name: 'ADMIN REPAIR', groupId: G1 }, { id: S3, name: 'BD', groupId: G2 }]
const noDefaults: FilterDefaults = { statuses: OPEN, groups: [], services: [] }
const acDefaults: FilterDefaults = { statuses: OPEN, groups: [], services: [S1] }
const adminDefaults: FilterDefaults = { statuses: OPEN, groups: [G1], services: [] }
const eff = (o: Partial<ReturnType<typeof effectiveFilter>> = {}) => ({ statuses: OPEN, techs: [], groups: [], services: [], ...o })

describe('filter choices in the page address', () => {
  it('reads groups, services, technicians and statuses, dropping anything unknown', () => {
    const f = parseReportFilter({ status: 'resolved,open,bogus', tech: 'Krishan|Arun Das|Krishan', group: `${G1},${G2},not-an-id`, service: S1 })
    expect(f.statuses).toEqual(['open', 'resolved'])
    expect(f.techs).toEqual(['Krishan', 'Arun Das'])
    expect(f.groups).toEqual([G1, G2])
    expect(f.services).toEqual([S1])
    expect(parseReportFilter({})).toEqual(emptyReportFilter())
    expect(parseReportFilter({ group: 'all', service: 'all' })).toMatchObject({ groups: [], services: [], allGroups: true, allServices: true })
  })
  it('writes the choices back to the address and reads them again', () => {
    const p = new URLSearchParams('tab=x&group=old')
    applyReportFilterToParams(p, { ...emptyReportFilter(), groups: [G1, G2], services: [S1], techs: ['Krishan'], statuses: ['resolved'] })
    expect(parseReportFilter(Object.fromEntries(p))).toMatchObject({ groups: [G1, G2], services: [S1], techs: ['Krishan'], statuses: ['resolved'] })
    applyReportFilterToParams(p, emptyReportFilter())
    expect([...p.keys()]).toEqual(['tab'])
  })
})

describe('what is in force', () => {
  it('starts on the report’s own group and services, and a choice replaces them', () => {
    expect(effectiveFilter(emptyReportFilter(), adminDefaults)).toEqual(eff({ groups: [G1] }))
    expect(effectiveFilter(emptyReportFilter(), acDefaults)).toEqual(eff({ services: [S1] }))
    expect(effectiveFilter({ ...emptyReportFilter(), groups: [G2] }, adminDefaults)).toEqual(eff({ groups: [G2] }))
    expect(effectiveFilter({ ...emptyReportFilter(), statuses: ['resolved'] }, noDefaults).statuses).toEqual(['resolved'])
  })
  it('a group chosen selects all its services, unless some are picked', () => {
    // the AC report starts on the service ADMIN - AC; choosing the BD group means all BD services, not ADMIN - AC
    expect(effectiveFilter({ ...emptyReportFilter(), groups: [G2] }, acDefaults).services).toEqual([])
    expect(effectiveFilter({ ...emptyReportFilter(), groups: [G1], services: [S2] }, acDefaults).services).toEqual([S2])
  })
  it('"all" lifts the report’s own starting point', () => {
    expect(effectiveFilter({ ...emptyReportFilter(), allServices: true }, acDefaults).services).toEqual([])
    expect(effectiveFilter({ ...emptyReportFilter(), allGroups: true }, adminDefaults).groups).toEqual([])
  })
  it('turns what the bar shows back into a choice that does not repeat the report’s own', () => {
    expect(choiceFromEffective(eff({ groups: [G1] }), adminDefaults)).toEqual(emptyReportFilter())
    expect(choiceFromEffective(eff({ groups: [] }), adminDefaults)).toMatchObject({ allGroups: true })
    expect(choiceFromEffective(eff({ services: [] }), acDefaults)).toMatchObject({ allServices: true })
    expect(choiceFromEffective(eff({ groups: [G2] }), acDefaults)).toMatchObject({ groups: [G2], services: [], allServices: false })
  })
})

describe('the four filters follow each other', () => {
  const names = (l: { value: string }[]) => l.map((x) => x.value)
  it('shows every group and service when nothing is chosen', () => {
    const o = linkedOptions(combos, eff())
    expect(names(o.groups).sort()).toEqual([G1, G2].sort())
    expect(names(o.services)).toHaveLength(3)
  })
  it('a group narrows the service and technician lists to its own', () => {
    const o = linkedOptions(combos, eff({ groups: [G1] }))
    expect(names(o.services).sort()).toEqual([S1, S2].sort())
    expect(names(o.techs).sort()).toEqual(['Krishan', 'Shivanshu'])
    // its own list still offers the other group, so several groups can be chosen
    expect(names(o.groups)).toContain(G2)
  })
  it('several groups can be chosen at once', () => {
    const o = linkedOptions(combos, eff({ groups: [G1, G2] }))
    expect(names(o.services)).toHaveLength(3)
    expect(names(o.techs)).toContain('Mukesh')
  })
  it('a service narrows the groups, technicians and statuses', () => {
    const o = linkedOptions(combos, eff({ services: [S2] }))
    expect(names(o.groups)).toEqual([G1])
    expect(names(o.techs)).toEqual(['Shivanshu'])
    expect(o.statuses.find((s) => s.value === 'in_progress')?.count).toBe(2)
  })
  it('a technician narrows the groups and services, and statuses count tickets in the chosen statuses only', () => {
    expect(names(linkedOptions(combos, eff({ techs: ['Mukesh'] })).groups)).toEqual([G2])
    expect(linkedOptions(combos, eff({ techs: ['Mukesh'] })).statuses.find((s) => s.value === 'resolved')?.count).toBe(9)
    expect(names(linkedOptions(combos, eff()).techs)).not.toContain('Mukesh-resolved')
    // resolved tickets are not in the open statuses, so a technician who only has resolved ones is not offered
    expect(names(linkedOptions(combos.filter((c) => c.status === 'resolved'), eff()).techs)).toEqual([])
  })
  it('keeps a ticked value in its list with 0 even when the others hide it', () => {
    expect(linkedOptions(combos, eff({ groups: [G2], services: [S1] })).services.find((s) => s.value === S1)?.count).toBe(0)
  })
})

describe('the filter bar', () => {
  const bar = (effective = eff(), defaults = noDefaults) => render(<ReportFilters combos={combos} groups={groups} services={services} defaults={defaults} effective={effective} />)

  it('has Group, Service, Technician and Status, in that order, and nothing else', () => {
    bar()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Group', 'Service', 'Technician', 'Status'])
  })
  it('several groups can be ticked, and the service list becomes the services of those groups', () => {
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Group' }))
    const g = screen.getByRole('listbox', { name: 'Group choices' })
    fireEvent.click(within(g).getByLabelText(/ADMIN GROUP/))
    fireEvent.click(within(g).getByLabelText(/BD Group/))
    fireEvent.click(screen.getByRole('button', { name: 'Service' }))
    const sv = screen.getByRole('listbox', { name: 'Service choices' })
    expect(within(sv).getAllByRole('checkbox')).toHaveLength(3)
    cleanupPanels()
    fireEvent.click(screen.getByRole('button', { name: 'Group' }))
  })
  it('choosing a group leaves only its services to pick from, all of them chosen unless some are ticked', () => {
    push.mockClear()
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Group' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Group choices' })).getByLabelText(/ADMIN GROUP/))
    fireEvent.click(screen.getByRole('button', { name: 'Service' }))
    const sv = screen.getByRole('listbox', { name: 'Service choices' })
    expect(within(sv).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(sv).getByText(/ADMIN - AC/)).toBeTruthy()
    expect(within(sv).queryByText(/^BD/)).toBeNull()
    // nothing ticked in the service list = all services of the group
    fireEvent.click(within(sv).getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenCalledWith(`/reports/analytics/admin-summary-report?group=${G1}`)
  })
  it('picking a service as well narrows it, and Apply puts both in the address', () => {
    push.mockClear()
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Group' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Group choices' })).getByLabelText(/ADMIN GROUP/))
    fireEvent.click(screen.getByRole('button', { name: 'Service' }))
    const sv = screen.getByRole('listbox', { name: 'Service choices' })
    fireEvent.click(within(sv).getByLabelText(/ADMIN REPAIR/))
    fireEvent.click(within(sv).getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenCalledWith(`/reports/analytics/admin-summary-report?group=${G1}&service=${S2}`)
  })
  it('a report that starts on its own group shows it chosen, and can be reset to it', () => {
    push.mockClear()
    bar(eff({ groups: [G2] }), adminDefaults)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Group (1)', 'Service', 'Technician', 'Status', 'Reset'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(push).toHaveBeenCalledWith('/reports/analytics/admin-summary-report')
  })
  it('the technician list follows the group ticked so far, before Apply', () => {
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Group' }))
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Group choices' })).getByLabelText(/BD Group/))
    fireEvent.click(screen.getByRole('button', { name: 'Technician' }))
    const t = screen.getByRole('listbox', { name: 'Technician choices' })
    expect(within(t).getByText('Mukesh')).toBeTruthy()
    expect(within(t).queryByText('Krishan')).toBeNull()
  })
})

function cleanupPanels() { fireEvent.keyDown(document, { key: 'Escape' }) }
