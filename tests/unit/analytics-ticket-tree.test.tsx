// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import ExcelJS from 'exceljs'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/lib/actions/analyticsReportExport', () => ({ exportTicketTreeReportXlsx: vi.fn(), exportStoreAcReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import {
  buildTicketTree, flattenTree, collapsedForDepth, depthOf, columnsFor, filterByMinTickets, parseMinTickets, layoutById, LAYOUTS, cellValue, formatDay,
  type TicketTree,
} from '@/lib/reporting/analytics/ticket-tree'
import { buildTicketTreeWorkbook, TREE_HEADER_ROW } from '@/lib/reporting/analytics/ticket-tree-xlsx'
import { TicketTreeView } from '@/components/reports/analytics/TicketTreeView'
import { fact } from './helpers/fact'

afterEach(() => cleanup())

const rows = [
  fact({ ticketNo: 'CK-1', store: 'LSR', cluster: 'JH1', technician: 'Krishan', ageDays: 11, ageBucket: '11–20 days' }),
  fact({ ticketNo: 'CK-2', store: 'LSR', cluster: 'JH1', technician: 'Krishan', ageDays: 2 }),
  fact({ ticketNo: 'CK-3', store: 'SBP', cluster: 'BR3', technician: 'Krishan', ageDays: 9, ageBucket: '6–10 days' }),
  fact({ ticketNo: 'CK-4', store: 'KGP', cluster: 'BR4', technician: 'Shivanshu', category: 'FAN', ageDays: 1, oem: '', isAcTicket: false }),
  // a head office requester: no cluster, no OEM
  fact({ ticketNo: 'CK-5', store: 'HO Person', cluster: '', technician: 'Unassigned', category: 'FAN', ageDays: 20, ageBucket: '11–20 days', oem: '', isAcTicket: false, isStoreAccount: false }),
]
const L = (id: string) => layoutById(id, 'cluster-store').levels

const lines = (tree: TicketTree, collapsed: ReadonlySet<string> = new Set()) =>
  flattenTree(tree, collapsed).map((r) => `${r.kind}:${[...r.labels.filter(Boolean), r.ticket?.ticketNo].filter(Boolean).join('/')}`)

describe('grouped ticket table', () => {
  it('Cluster › Store › ticket: clusters A-Z with "(Not set)" last, oldest ticket first, a total line per cluster', () => {
    const tree = buildTicketTree(rows, L('cluster-store'))
    expect(tree.roots.map((r) => r.name)).toEqual(['BR3', 'BR4', 'JH1', '(Not set)'])
    expect(tree.roots[2].children.map((s) => s.name)).toEqual(['LSR'])
    expect(tree.roots[2].children[0].tickets.map((t) => t.ticketNo)).toEqual(['CK-1', 'CK-2'])
    expect(tree.roots[2].total).toBe(2)
    expect(tree.buckets).toEqual(['0–5 days', '6–10 days', '11–20 days'])
    expect(tree.grand.total).toBe(5)
    expect(lines(tree)).toEqual([
      'ticket:BR3/SBP/CK-3', 'total:BR3 Total', 'ticket:BR4/KGP/CK-4', 'total:BR4 Total',
      'ticket:JH1/LSR/CK-1', 'ticket:CK-2', 'total:JH1 Total', 'ticket:(Not set)/HO Person/CK-5', 'total:(Not set) Total',
    ])
  })

  it('three levels: Responsible › Cluster › Store, with a label on the first line of each heading only', () => {
    const tree = buildTicketTree(rows, L('tech-cluster-store'))
    expect(tree.roots.map((r) => r.name)).toEqual(['Krishan', 'Shivanshu', 'Unassigned'])
    expect(tree.roots[0].children.map((c) => c.name)).toEqual(['BR3', 'JH1'])
    const flat = flattenTree(tree)
    expect(flat[0].labels).toEqual(['Krishan', 'BR3', 'SBP'])
    expect(flat[1].labels).toEqual(['', 'JH1', 'LSR']) // Krishan is not repeated
    expect(flat[2].labels).toEqual(['', '', ''])
    expect(flat.filter((r) => r.kind === 'total').map((r) => r.labels[0])).toEqual(['Krishan Total', 'Shivanshu Total', 'Unassigned Total'])
  })

  it('four levels: AC-AMC brand › vendor › cluster › store', () => {
    const t = buildTicketTree([fact({ ticketNo: 'A', acAmcBrand: 'DAIKIN', acAmcVendor: 'V1' }), fact({ ticketNo: 'B', acAmcBrand: 'DAIKIN', acAmcVendor: 'V2' }), fact({ ticketNo: 'C', acAmcBrand: '', acAmcVendor: '' })], L('amc-brand-vendor-cluster-store'))
    expect(t.roots.map((r) => r.name)).toEqual(['DAIKIN', '(Not set)'])
    expect(t.roots[0].children.map((v) => v.name)).toEqual(['V1', 'V2'])
    expect(flattenTree(t)[0].labels).toEqual(['DAIKIN', 'V1', 'JH1', 'LSR'])
  })

  it('a folded heading or store becomes one line of totals; the level buttons fold one level at a time', () => {
    const tree = buildTicketTree(rows, L('tech-cluster-store'))
    expect(lines(tree, collapsedForDepth(tree, 0))).toEqual(['node:Krishan', 'node:Shivanshu', 'node:Unassigned'])
    // closing the clusters keeps each one as a line, with its total, under its responsible
    expect(lines(tree, collapsedForDepth(tree, 1))).toEqual(['node:Krishan/BR3', 'node:JH1', 'total:Krishan Total', 'node:Shivanshu/BR4', 'total:Shivanshu Total', 'node:Unassigned/(Not set)', 'total:Unassigned Total'])
    const stores = flattenTree(tree, collapsedForDepth(tree, 2))
    expect(stores.filter((r) => r.kind === 'node')).toHaveLength(4)
    expect(stores[0]).toMatchObject({ kind: 'node', total: 1 })
    expect(collapsedForDepth(tree, 'tickets').size).toBe(0)
    for (const d of [0, 1, 2, 'tickets'] as const) expect(depthOf(tree, collapsedForDepth(tree, d))).toBe(d)
    expect(depthOf(tree, new Set([tree.roots[0].key, tree.roots[1].children[0].key]))).toBeNull()
  })

  it('grouped by OEM, only tickets that have an OEM are listed (an IT ticket does not belong under an AC vendor)', () => {
    const tree = buildTicketTree(rows, L('oem-store'))
    expect(tree.grand.total).toBe(3)
    expect(tree.roots.map((r) => r.name)).toEqual(['DAIKAIN OEM - ALL'])
    // an AC ticket from a store with no OEM is listed, last
    const withNoOem = buildTicketTree([...rows, fact({ ticketNo: 'Z', store: 'ZZZ', oem: '(No OEM)' })], L('oem-store'))
    expect(withNoOem.roots.map((r) => r.name)).toEqual(['DAIKAIN OEM - ALL', '(No OEM)'])
  })

  it('keeps only stores with at least N tickets, counted over the whole result', () => {
    expect(filterByMinTickets(rows, 2).map((r) => r.ticketNo)).toEqual(['CK-1', 'CK-2'])
    expect(filterByMinTickets(rows, 1)).toHaveLength(5)
    expect(buildTicketTree(rows, L('cluster-store'), 2).grand.total).toBe(2)
    const split = [fact({ ticketNo: 'A', store: 'X', technician: 'P' }), fact({ ticketNo: 'B', store: 'X', technician: 'Q' })]
    expect(buildTicketTree(split, L('tech-store'), 2).grand.total).toBe(2)
    expect([parseMinTickets('3'), parseMinTickets('0'), parseMinTickets('x'), parseMinTickets(undefined), parseMinTickets('5000'), parseMinTickets('2.5')]).toEqual([3, 1, 1, 1, 1000, 1])
  })

  it('nothing matches: an empty table', () => {
    const tree = buildTicketTree([], L('cluster-store'))
    expect(tree.roots).toEqual([])
    expect(flattenTree(tree)).toEqual([])
    expect(tree.grand.total).toBe(0)
  })

  it('every layout has real levels ending in the store, and an unknown layout falls back', () => {
    for (const l of LAYOUTS) expect(l.levels[l.levels.length - 1]).toBe('store')
    expect(layoutById('nonsense', 'tech-store').id).toBe('tech-store')
    expect(layoutById('cluster-store', 'tech-store').id).toBe('cluster-store')
  })

  it('does not repeat a heading among the ticket columns; AC columns only where a service goes to an OEM', () => {
    const wanted = ['category', 'subject', 'technician', 'oem', 'acNo', 'cluster', 'ticketNo'] as const
    expect(columnsFor([...wanted], ['technician', 'store'], true)).toEqual(['category', 'subject', 'oem', 'acNo', 'cluster', 'ticketNo'])
    expect(columnsFor([...wanted], ['cluster', 'store'], false)).toEqual(['category', 'subject', 'technician', 'ticketNo'])
  })

  it('shows the cell values: dates, the OEM ticket date, percent and counts', () => {
    const t = fact({ ticketNo: 'Q', oemTicketDate: '2026-10-02', acNotWorkingPct: 36.36, storeAcTickets: 4, acTotal: 11 })
    expect(cellValue(t, 'oemTicketDate', String)).toBe('02 Oct 2026')
    expect(cellValue(t, 'acPct', String)).toBe('36%')
    expect(cellValue(t, 'storeAcTickets', String)).toBe(4)
    expect(cellValue(t, 'acTotal', String)).toBe(11)
    expect(cellValue(fact({ ticketNo: 'N', acNotWorkingPct: null, isAcTicket: false }), 'acPct', String)).toBe('')
    expect(cellValue(fact({ ticketNo: 'N', isAcTicket: false }), 'storeAcTickets', String)).toBe('')
    expect(formatDay(null)).toBe('')
    expect(formatDay('2026-02-14')).toBe('14 Feb 2026')
  })
})

describe('grouped ticket Excel', () => {
  const build = async (tree: TicketTree, collapsed?: ReadonlySet<string>, columns = columnsFor(['category', 'subject', 'ticketNo', 'status', 'createdDate', 'ageDays'], tree.levels, true)) => {
    const wb = buildTicketTreeWorkbook({
      title: 'Admin Ticket Status Report Age bucket wise', teamName: 'ADMIN GROUP', rangeLabel: 'All time', statusLabels: ['Open'], servicesLabel: 'All services',
      filtersText: 'Cluster: JH1', tree, columns, collapsed, statusLabel: (s) => s,
    })
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(await wb.xlsx.writeBuffer())
    return back.getWorksheet('Tickets')!
  }
  const col = (sheet: ExcelJS.Worksheet, n: number) => { const out: unknown[] = []; sheet.eachRow((row, r) => { if (r > TREE_HEADER_ROW) out.push(row.getCell(n).value) }); return out }

  it('has one column per heading level, the ticket columns, one column per age bucket and a grand total that adds up', async () => {
    const tree = buildTicketTree(rows, L('tech-cluster-store'))
    const sheet = await build(tree)
    const header = sheet.getRow(TREE_HEADER_ROW).values as unknown[]
    expect(header.slice(1, 8)).toEqual(['Responsible', 'Cluster', 'Store', 'Category', 'Subject', 'Ticket No', 'Status'])
    expect(header.slice(-4)).toEqual(['0–5 days', '6–10 days', '11–20 days', 'Grand Total'])
    expect(col(sheet, 1)).toContain('Krishan Total')
    expect(col(sheet, 1)[col(sheet, 1).length - 1]).toBe('Grand Total')
    expect(sheet.getRow(sheet.rowCount).getCell(sheet.columnCount).value).toBe(5)
    expect(String(sheet.getRow(3).getCell(1).value)).toContain('Cluster: JH1')
  })

  it('follows what is folded on screen', async () => {
    const tree = buildTicketTree(rows, L('tech-store'))
    const sheet = await build(tree, collapsedForDepth(tree, 0))
    expect(col(sheet, 1)).toEqual(['Krishan', 'Shivanshu', 'Unassigned', 'Grand Total'])
  })

  it('says so when nothing matches', async () => {
    expect(col(await build(buildTicketTree([], L('cluster-store'))), 1)).toEqual(['No tickets match these filters.'])
  })
})

describe('grouped ticket screen', () => {
  const tree = buildTicketTree(rows, L('tech-cluster-store'))
  const exportProps = { slug: 's', group: 'g', services: [], preset: 'all', from: '', to: '', statuses: ['open'], filters: {}, layout: 'tech-cluster-store', minTickets: 1 }
  const show = (depth: 'tickets' | number) => render(<TicketTreeView tree={tree} columns={['category', 'subject', 'ticketNo']} defaultDepth={depth} exportProps={exportProps} />)
  const body = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent ?? '')

  it('opens at the level the report asks for, with a button per heading level and one for the tickets', () => {
    show(2)
    expect(screen.queryByText('CK-1')).toBeNull()
    const levels = within(screen.getByRole('group', { name: 'Level of detail' }))
    expect(levels.getAllByRole('button').map((b) => b.textContent)).toEqual(['Responsible', '+ Cluster', '+ Store', '+ Tickets'])
    expect(levels.getByRole('button', { name: '+ Store' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens and closes a heading with its arrow, and the level buttons fold everything at one level', () => {
    show('tickets')
    expect(screen.getByText('CK-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Krishan' }))
    expect(screen.queryByText('CK-1')).toBeNull()
    expect(screen.getByText('CK-4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Krishan' }))
    expect(screen.getByText('CK-1')).toBeTruthy()

    const levels = within(screen.getByRole('group', { name: 'Level of detail' }))
    fireEvent.click(levels.getByRole('button', { name: 'Responsible' }))
    expect(body().map((r) => r.replace(/\d+/g, '').trim())).toEqual(['Krishan', 'Shivanshu', 'Unassigned', 'Grand Total'])
    fireEvent.click(levels.getByRole('button', { name: '+ Cluster' }))
    expect(screen.getByText('JH1')).toBeTruthy()
    expect(screen.queryByText('LSR')).toBeNull()
    fireEvent.click(levels.getByRole('button', { name: '+ Tickets' }))
    expect(screen.getByText('CK-1')).toBeTruthy()
  })

  it('links each ticket number to the ticket', () => {
    show('tickets')
    expect(screen.getByText('CK-3').closest('a')?.getAttribute('href')).toContain('/requests/CK-3')
  })

  it('says so when nothing matches', () => {
    render(<TicketTreeView tree={buildTicketTree([], L('cluster-store'))} columns={[]} defaultDepth="tickets" exportProps={exportProps} />)
    expect(screen.getByText('No tickets match these filters')).toBeTruthy()
  })
})
