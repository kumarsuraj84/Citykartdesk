// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/lib/actions/fixedReportExport', () => ({ exportFixedReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { FIXED_REPORTS, REPORTS_NAME, buildFixedReport, findFixedReport, normName, type FixedReportDef } from '@/lib/reporting/analytics/fixed-reports'
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
  it('has exactly the twelve reports, in the order of the sheets', () => {
    expect(FIXED_REPORTS.map((r) => r.title)).toEqual([
      '🚩Red Flag Store Report', 'Store AC Not Working Report', 'AMC Vendor Report', 'Store Side Pending Tickets Report', 'AC Issues Report',
      'Repair & Maintenance Report', 'Admin Requirement Report', 'NSO Status Report', 'NSO Summary Report', 'BD Status Report', 'BD Summary Report', 'Admin Summary Report',
    ])
    expect(new Set(FIXED_REPORTS.map((r) => r.slug)).size).toBe(12)
    expect(REPORTS_NAME).toBe('Fixed predefined Reports')
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

  it('Store AC Not Working: a line per store with its tickets by age and as a share of its ACs, worst first', () => {
    const a = ac('A1', 'LSR', { acNotWorkingPct: 40, redFlag: 'Yes', ageBucket: '0–5 days' })
    const b = ac('A2', 'LSR', { acNotWorkingPct: 40, redFlag: 'Yes', ageBucket: '6–10 days' })
    const c = ac('A3', 'KGP', { acNotWorkingPct: 10, redFlag: 'No', ageBucket: '0–5 days' })
    const t = build('store-ac-not-working-report', [c, a, b])
    expect(t.rows.map((r) => r.cells[0])).toEqual(['LSR', 'KGP', 'Grand Total'])
    expect(t.headGroups.map((g) => g.label)).toEqual(['Ticket', 'Sum of Ticket %'])
    const lsr = t.rows[0]
    expect(lsr.cells[col(t, 'total')]).toBe(2)
    expect(lsr.cells[col(t, 'pct')]).toBeCloseTo(0.2)
    expect(lsr.cells[col(t, 'p:6–10 days')]).toBeCloseTo(0.1)
    // the Grand Total share is tickets over the ACs of the stores that have them
    const grand = t.rows.at(-1)!
    expect(grand.cells[col(t, 'total')]).toBe(3)
    expect(grand.cells[col(t, 'pct')]).toBeCloseTo(3 / 20)
    expect(cellText(lsr.cells[col(t, 'pct')], t.columns[col(t, 'pct')])).toBe('20%')
  })
  it('Red Flag Store: only stores above 30%, and the Server Room AC is not one of a store’s ACs', () => {
    const red = ac('A1', 'LSR', { acNotWorkingPct: 40, redFlag: 'Yes' })
    const fine = ac('A2', 'KGP', { acNotWorkingPct: 10, redFlag: 'No' })
    const server = ac('A3', 'ZZZ', { acNotWorkingPct: 90, redFlag: 'Yes', acNo: 'Server Room AC' })
    const t = build('red-flag-store-report', [red, fine, server])
    expect(t.rows.map((r) => r.cells[0])).toEqual(['LSR', 'Grand Total'])
    expect(t.headGroups).toEqual([])
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
  it('keeps the heading groups and writes percentages as percentages', async () => {
    const ExcelJS = (await import('exceljs')).default
    const t = build('store-ac-not-working-report', [fact({ ticketNo: 'A1', store: 'LSR', requester: 'LSR', acNotWorkingPct: 20, ageBucket: '0–5 days' })])
    const read = new ExcelJS.Workbook()
    await read.xlsx.load((await buildReportWorkbook(t).xlsx.writeBuffer()) as ArrayBuffer)
    const ws = read.worksheets[0]
    expect(ws.getRow(XLSX_HEAD_ROW).getCell(8).value).toBe('Ticket')
    expect(ws.getRow(XLSX_HEAD_ROW + 2).getCell(col(t, 'pct') + 1).numFmt).toBe('0.0%')
  })
})

// ── the status and technician filters ───────────────────────────────────────────────────────────
import { applyReportFilterToParams, linkedOptions, parseReportFilter, type FilterCombo } from '@/lib/reporting/analytics/report-filter'
import { ReportFilters } from '@/components/reports/analytics/ReportFilters'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/reports/analytics/admin-summary-report' }))

const combos: FilterCombo[] = [
  { status: 'open', tech: 'Krishan', count: 3 }, { status: 'in_progress', tech: 'Krishan', count: 2 },
  { status: 'open', tech: 'Arun Das', count: 4 }, { status: 'resolved', tech: 'Mukesh', count: 9 },
]
const OPEN = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval']

describe('filter choices in the page address', () => {
  it('reads statuses and technicians, dropping anything unknown', () => {
    const f = parseReportFilter({ status: 'resolved,open,bogus', tech: 'Krishan|Arun Das|Krishan' })
    expect(f.statuses).toEqual(['open', 'resolved'])
    expect(f.techs).toEqual(['Krishan', 'Arun Das'])
    expect(parseReportFilter({})).toEqual({ statuses: [], techs: [] })
  })
  it('writes them back, and a status choice equal to the report’s own is no choice', () => {
    const p = new URLSearchParams('status=resolved&tech=X')
    applyReportFilterToParams(p, { statuses: OPEN, techs: ['Krishan'] }, OPEN)
    expect(p.get('status')).toBeNull()
    expect(p.get('tech')).toBe('Krishan')
    applyReportFilterToParams(p, { statuses: ['resolved'], techs: [] }, OPEN)
    expect(p.get('status')).toBe('resolved')
    expect(p.get('tech')).toBeNull()
  })
})

describe('the two filters follow each other', () => {
  it('shows the technicians who have tickets in the chosen statuses', () => {
    expect(linkedOptions(combos, OPEN, []).techs.map((t) => t.value)).toEqual(['Krishan', 'Arun Das'])
    expect(linkedOptions(combos, ['resolved'], []).techs.map((t) => t.value)).toEqual(['Mukesh'])
    expect(linkedOptions(combos, ['open'], []).techs.map((t) => [t.value, t.count])).toEqual([['Arun Das', 4], ['Krishan', 3]])
  })
  it('shows each status with the tickets the chosen technicians have in it', () => {
    const all = linkedOptions(combos, OPEN, [])
    expect(all.statuses.find((s) => s.value === 'open')?.count).toBe(7)
    const krishan = linkedOptions(combos, OPEN, ['Krishan'])
    expect(krishan.statuses.find((s) => s.value === 'open')?.count).toBe(3)
    expect(krishan.statuses.find((s) => s.value === 'resolved')?.count).toBe(0)
  })
  it('keeps a ticked technician in the list even when the statuses hide their tickets', () => {
    expect(linkedOptions(combos, ['resolved'], ['Krishan']).techs.find((t) => t.value === 'Krishan')?.count).toBe(0)
  })
})

describe('the filter bar', () => {
  const bar = (selected = { statuses: OPEN, techs: [] as string[] }) => render(<ReportFilters combos={combos} defaultStatuses={OPEN} selected={selected} />)

  it('has a Status and a Technician filter and nothing else', () => {
    bar()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Status', 'Technician'])
  })
  it('the technician list follows the statuses ticked so far, before Apply', () => {
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    const statuses = screen.getByRole('listbox', { name: 'Status choices' })
    fireEvent.click(within(statuses).getByLabelText(/Resolved/))
    for (const s of ['Open', 'Assigned', 'In Progress', 'Waiting on User']) fireEvent.click(within(statuses).getByLabelText(new RegExp(`^${s}`)))
    fireEvent.click(screen.getByRole('button', { name: 'Technician' }))
    const techs = screen.getByRole('listbox', { name: 'Technician choices' })
    expect(within(techs).getByText('Mukesh')).toBeTruthy()
  })
  it('Apply puts the choices in the page address', () => {
    push.mockClear()
    bar()
    fireEvent.click(screen.getByRole('button', { name: 'Technician' }))
    const techs = screen.getByRole('listbox', { name: 'Technician choices' })
    fireEvent.click(within(techs).getByLabelText(/Krishan/))
    fireEvent.click(within(techs).getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenCalledWith('/reports/analytics/admin-summary-report?tech=Krishan')
  })
  it('shows what is chosen and can reset it', () => {
    push.mockClear()
    bar({ statuses: ['resolved'], techs: ['Mukesh'] })
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Status (1)', 'Technician (1)', 'Reset'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(push).toHaveBeenCalledWith('/reports/analytics/admin-summary-report')
  })
})
