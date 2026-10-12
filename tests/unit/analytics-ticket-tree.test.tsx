// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import ExcelJS from 'exceljs'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/lib/actions/analyticsReportExport', () => ({ exportTicketTreeReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import {
  buildTicketTree, flattenTree, collapsedForTreeLevel, treeLevelOf, treeColumns, filterByMinTickets, parseGroupBy, parseMinTickets,
  storeKey, NO_OEM, type TreeTicket,
} from '@/lib/reporting/analytics/ticket-tree'
import { buildTicketTreeWorkbook, TREE_HEADER_ROW } from '@/lib/reporting/analytics/ticket-tree-xlsx'
import { TicketTreeView } from '@/components/reports/analytics/TicketTreeView'

afterEach(() => cleanup())

const t = (o: Partial<TreeTicket> & { ticketNo: string }): TreeTicket => ({
  id: o.ticketNo, subject: `Subject ${o.ticketNo}`, requester: 'LSR', store: 'LSR', oem: 'DAIKAIN OEM - ALL', technician: 'Krishan', category: 'ADMIN AC ISSUE',
  subCategory: 'COOLING ISSUE', service: 'ADMIN - AC', status: 'in_progress', priority: 'medium', createdAt: '2026-10-01T10:00:00.000Z', ageDays: 3, ageBucket: '0–5 days', ...o,
})

const rows: TreeTicket[] = [
  t({ ticketNo: 'CK-1', store: 'LSR', oem: 'DAIKAIN OEM - ALL', technician: 'Krishan', ageDays: 11, ageBucket: '11–20 days' }),
  t({ ticketNo: 'CK-2', store: 'LSR', oem: 'DAIKAIN OEM - ALL', technician: 'Krishan', ageDays: 2 }),
  t({ ticketNo: 'CK-3', store: 'SBP', oem: 'BLUE STAR OEM - BR', technician: 'Krishan', ageDays: 9, ageBucket: '6–10 days' }),
  t({ ticketNo: 'CK-4', store: 'KGP', oem: 'BLUE STAR OEM - BR', technician: 'Shivanshu', category: 'FAN', ageDays: 1 }),
  // an IT ticket from a store with an OEM: the OEM has nothing to do with it
  t({ ticketNo: 'CK-5', store: 'HO Person', oem: '', technician: 'Unassigned', category: 'FAN', ageDays: 20, ageBucket: '11–20 days' }),
]

const labels = (tree = buildTicketTree(rows, 'technician'), c = collapsedForTreeLevel(tree, 'tickets')) =>
  flattenTree(tree, c).map((r) => `${r.kind}:${[r.groupLabel, r.storeLabel, r.ticket?.ticketNo].filter(Boolean).join('/')}`)

describe('ticket tree', () => {
  it('groups by responsible → store → ticket, Unassigned last, oldest ticket first, totals added up', () => {
    const tree = buildTicketTree(rows, 'technician')
    expect(tree.groups.map((g) => g.name)).toEqual(['Krishan', 'Shivanshu', 'Unassigned'])
    expect(tree.groups[0].stores.map((s) => s.name)).toEqual(['LSR', 'SBP'])
    expect(tree.groups[0].stores[0].tickets.map((x) => x.ticketNo)).toEqual(['CK-1', 'CK-2'])
    expect(tree.groups[0].total).toBe(3)
    expect(tree.groups[0].counts).toEqual({ '11–20 days': 1, '0–5 days': 1, '6–10 days': 1 })
    expect(tree.buckets).toEqual(['0–5 days', '6–10 days', '11–20 days'])
    expect(tree.grand.total).toBe(5)
    expect(tree.grand.counts['11–20 days']).toBe(2)
  })

  it('can group by OEM or by category', () => {
    // grouped by OEM, a ticket that has no OEM to do with it (an IT ticket) is not listed at all
    const byOem = buildTicketTree(rows, 'oem')
    expect(byOem.groups.map((g) => g.name)).toEqual(['BLUE STAR OEM - BR', 'DAIKAIN OEM - ALL'])
    expect(byOem.grand.total).toBe(4)
    // an AC ticket whose store has no OEM is listed, last, as "(No OEM)"
    expect(buildTicketTree([...rows, t({ ticketNo: 'CK-6', store: 'ZZZ', oem: NO_OEM })], 'oem').groups.map((g) => g.name).slice(-1)).toEqual([NO_OEM])
    const byCat = buildTicketTree(rows, 'category')
    expect(byCat.groups.map((g) => [g.name, g.total])).toEqual([['ADMIN AC ISSUE', 3], ['FAN', 2]])
  })

  it('keeps only stores with at least N tickets, counted over the whole result', () => {
    expect(filterByMinTickets(rows, 2).map((r) => r.ticketNo)).toEqual(['CK-1', 'CK-2'])
    expect(filterByMinTickets(rows, 1)).toHaveLength(5)
    const tree = buildTicketTree(rows, 'oem', 2)
    expect(tree.groups.map((g) => g.name)).toEqual(['DAIKAIN OEM - ALL'])
    expect(tree.grand.total).toBe(2)
    // the OEM grouping leaves out tickets without an OEM before counting a store's tickets
    expect(buildTicketTree([...rows, t({ ticketNo: 'IT-1', store: 'LSR', oem: '' })], 'oem', 3).grand.total).toBe(0)
    // a store raising tickets under two responsibles still counts as one store with all its tickets
    const split = [t({ ticketNo: 'A', store: 'X', technician: 'P' }), t({ ticketNo: 'B', store: 'X', technician: 'Q' })]
    expect(buildTicketTree(split, 'technician', 2).grand.total).toBe(2)
  })

  it('reads the grouping and the minimum from the address, with safe defaults', () => {
    expect(parseGroupBy('oem', 'technician')).toBe('oem')
    expect(parseGroupBy('nonsense', 'category')).toBe('category')
    expect(parseGroupBy(undefined, 'technician')).toBe('technician')
    expect([parseMinTickets('3'), parseMinTickets('0'), parseMinTickets('-2'), parseMinTickets('x'), parseMinTickets(undefined), parseMinTickets('5000'), parseMinTickets('2.5')]).toEqual([3, 1, 1, 1, 1, 1000, 1])
  })

  it('everything open: heading and store on the first line, a total line per heading', () => {
    expect(labels()).toEqual([
      'ticket:Krishan/LSR/CK-1', 'ticket:CK-2', 'ticket:SBP/CK-3', 'groupTotal:Krishan Total',
      'ticket:Shivanshu/KGP/CK-4', 'groupTotal:Shivanshu Total',
      'ticket:Unassigned/HO Person/CK-5', 'groupTotal:Unassigned Total',
    ])
  })

  it('a folded store becomes one line with its totals; a folded heading likewise, without a total line', () => {
    const tree = buildTicketTree(rows, 'technician')
    const store = flattenTree(tree, { group: new Set(), store: new Set([storeKey('Krishan', 'LSR')]) })
    expect(store.map((r) => r.kind).slice(0, 3)).toEqual(['store', 'ticket', 'groupTotal'])
    expect(store[0]).toMatchObject({ groupLabel: 'Krishan', storeLabel: 'LSR', total: 2 })
    const group = flattenTree(tree, { group: new Set(['Krishan']), store: new Set() })
    expect(group[0]).toMatchObject({ kind: 'group', groupLabel: 'Krishan', total: 3 })
    expect(group[1].kind).toBe('ticket')
    expect(group.some((r) => r.groupLabel === 'Krishan Total')).toBe(false)
  })

  it('levels: headings only, + stores, + tickets', () => {
    const tree = buildTicketTree(rows, 'technician')
    expect(labels(tree, collapsedForTreeLevel(tree, 'groups'))).toEqual(['group:Krishan', 'group:Shivanshu', 'group:Unassigned'])
    expect(labels(tree, collapsedForTreeLevel(tree, 'stores'))).toEqual([
      'store:Krishan/LSR', 'store:SBP', 'groupTotal:Krishan Total', 'store:Shivanshu/KGP', 'groupTotal:Shivanshu Total', 'store:Unassigned/HO Person', 'groupTotal:Unassigned Total',
    ])
    for (const l of ['groups', 'stores', 'tickets'] as const) expect(treeLevelOf(tree, collapsedForTreeLevel(tree, l))).toBe(l)
    expect(treeLevelOf(tree, { group: new Set(['Krishan']), store: new Set(['x']) })).toBeNull()
  })

  it('does not repeat the grouping column among the ticket columns', () => {
    expect(treeColumns('technician').map((c) => c.key)).not.toContain('technician')
    expect(treeColumns('oem').map((c) => c.key)).not.toContain('oem')
    expect(treeColumns('category').map((c) => c.key)).not.toContain('category')
    expect(treeColumns('oem').map((c) => c.key)).toContain('technician')
    expect(treeColumns('technician', false).map((c) => c.key)).not.toContain('oem')
  })
})

describe('ticket tree Excel', () => {
  const build = async (collapsed?: Parameters<typeof buildTicketTreeWorkbook>[0]['collapsed'], tree = buildTicketTree(rows, 'technician')) => {
    const wb = buildTicketTreeWorkbook({
      title: 'Admin Ticket Status Report Age bucket wise', teamName: 'ADMIN GROUP', rangeLabel: 'All time', statusLabels: ['Open'], servicesLabel: 'All services',
      extraFilters: '', groupBy: 'technician', tree, collapsed, statusLabel: (s) => s,
    })
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(await wb.xlsx.writeBuffer())
    return back.getWorksheet('Tickets')!
  }
  const col = (sheet: ExcelJS.Worksheet, n: number) => {
    const out: unknown[] = []
    sheet.eachRow((row, r) => { if (r > TREE_HEADER_ROW) out.push(row.getCell(n).value) })
    return out
  }

  it('has the heading, store and ticket columns, one column per age bucket and a grand total that adds up', async () => {
    const sheet = await build()
    const header = sheet.getRow(TREE_HEADER_ROW).values as unknown[]
    expect(header.slice(1, 4)).toEqual(['Responsible', 'Store', 'Category'])
    expect(header.slice(-4)).toEqual(['0–5 days', '6–10 days', '11–20 days', 'Grand Total'])
    const labelsCol = col(sheet, 1)
    expect(labelsCol).toContain('Krishan Total')
    expect(labelsCol[labelsCol.length - 1]).toBe('Grand Total')
    const lastRow = sheet.getRow(sheet.rowCount)
    expect(lastRow.getCell(sheet.columnCount).value).toBe(5)
  })

  it('follows what is folded on screen', async () => {
    const tree = buildTicketTree(rows, 'technician')
    const sheet = await build(collapsedForTreeLevel(tree, 'groups'))
    expect(col(sheet, 1)).toEqual(['Krishan', 'Shivanshu', 'Unassigned', 'Grand Total'])
  })

  it('says so when nothing matches', async () => {
    const sheet = await build(undefined, buildTicketTree([], 'technician'))
    expect(col(sheet, 1)).toEqual(['No tickets match these filters.'])
  })
})

describe('ticket tree screen', () => {
  const tree = buildTicketTree(rows, 'technician')
  const exportProps = { slug: 's', group: 'g', services: [], preset: 'all', from: '', to: '', statuses: ['open'], technician: '', bucket: '', groupBy: 'technician', minTickets: 1 }
  const show = (level: 'groups' | 'stores' | 'tickets') => render(<TicketTreeView tree={tree} groupBy="technician" oemAvailable defaultLevel={level} exportProps={exportProps} />)
  const body = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent ?? '')

  it('opens at the level the report asks for', () => {
    show('stores')
    expect(screen.queryByText('CK-1')).toBeNull()
    expect(screen.getAllByRole('button', { name: /Expand/ }).length).toBeGreaterThan(0)
  })

  it('opens and closes a heading with its arrow, and the level buttons fold everything', () => {
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
    expect(screen.queryByText('CK-1')).toBeNull()
    expect(screen.queryByText('LSR')).toBeNull()
    fireEvent.click(levels.getByRole('button', { name: '+ Stores' }))
    expect(screen.getByText('LSR')).toBeTruthy()
    expect(screen.queryByText('CK-1')).toBeNull()
    fireEvent.click(levels.getByRole('button', { name: '+ Tickets' }))
    expect(screen.getByText('CK-1')).toBeTruthy()
  })

  it('links each ticket number to the ticket', () => {
    show('tickets')
    expect(screen.getByText('CK-3').closest('a')?.getAttribute('href')).toContain('/requests/CK-3')
  })
})
