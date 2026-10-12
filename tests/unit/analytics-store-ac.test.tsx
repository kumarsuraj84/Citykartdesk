// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import ExcelJS from 'exceljs'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/lib/actions/analyticsReportExport', () => ({ exportStoreAcReportXlsx: vi.fn(), exportTicketTreeReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { buildStoreAc, flattenStoreAc, parseStoreAcGroup, pctText } from '@/lib/reporting/analytics/store-ac'
import { buildStoreAcWorkbook, STORE_AC_HEADER_ROW } from '@/lib/reporting/analytics/store-ac-xlsx'
import { StoreAcView } from '@/components/reports/analytics/StoreAcView'
import { fact } from './helpers/fact'

afterEach(() => cleanup())

// LSR: 7 ACs, 3 open AC tickets (43%: red flag) in the cluster JH1. SBP: 12 ACs, 2 open (17%) in BR3. KGP: 10 ACs, 1 open (10%) in BR3. NEW: AC total not known.
const store = (code: string, o: Partial<Parameters<typeof fact>[0]>) => (n: number) =>
  Array.from({ length: n }, (_, i) => fact({ ticketNo: `${code}-${i + 1}`, store: code, ...o }))
const tickets = [
  ...store('LSR', { cluster: 'JH1', acTotal: 7, storeAcTickets: 3, acNotWorkingPct: (3 / 7) * 100, redFlag: 'Yes', zenatix: 'Yes' })(3),
  ...store('SBP', { cluster: 'BR3', acTotal: 12, storeAcTickets: 2, acNotWorkingPct: (2 / 12) * 100, redFlag: 'No', ageDays: 9, ageBucket: '6–10 days' })(2),
  ...store('KGP', { cluster: 'BR3', acTotal: 10, storeAcTickets: 1, acNotWorkingPct: 10, redFlag: 'No' })(1),
  ...store('NEW', { cluster: '', acTotal: null, storeAcTickets: 1, acNotWorkingPct: null, redFlag: '' })(1),
]

describe('Store AC Not Working', () => {
  it('one line per store with its AC total, open AC tickets, % and red flag; the worst stores first inside a group', () => {
    const r = buildStoreAc(tickets, 'cluster', 30)
    expect(r.groups.map((g) => g.name)).toEqual(['BR3', 'JH1', '(Not set)'])
    const br3 = r.groups[0]
    expect(br3.stores.map((s) => s.store)).toEqual(['SBP', 'KGP'])
    expect(br3.stores[0]).toMatchObject({ acTotal: 12, openAcTickets: 2, redFlag: false, total: 2, counts: { '6–10 days': 2 } })
    expect(pctText(br3.stores[0].pct)).toBe('17%')
    const lsr = r.groups[1].stores[0]
    expect(lsr).toMatchObject({ store: 'LSR', acTotal: 7, openAcTickets: 3, redFlag: true, zenatix: 'Yes', total: 3 })
    expect(pctText(lsr.pct)).toBe('43%')
  })

  it('a group\'s % is its open AC tickets over its AC total (only stores whose AC total is known); the grand total adds up', () => {
    const r = buildStoreAc(tickets, 'cluster', 30)
    expect(r.groups[0]).toMatchObject({ acTotal: 22, openAcTickets: 3, total: 3 })
    expect(pctText(r.groups[0].pct)).toBe('14%')
    // the store with no AC total has no %, no red flag, and does not count in the group's AC total
    const unset = r.groups[2]
    expect(unset.stores[0]).toMatchObject({ store: 'NEW', acTotal: null, pct: null, redFlag: false })
    expect(unset.acTotal).toBe(0)
    expect(unset.pct).toBeNull()
    expect(r.grand).toMatchObject({ stores: 4, redFlagStores: 1, acTotal: 29, openAcTickets: 6, total: 7 })
    expect(pctText(r.grand.pct)).toBe('21%')
    expect(r.buckets).toEqual(['0–5 days', '6–10 days'])
  })

  it('the red flag follows the limit the viewer sets: above it, not at it', () => {
    expect(buildStoreAc(tickets, 'cluster', 50).grand.redFlagStores).toBe(0)
    expect(buildStoreAc(tickets, 'cluster', 10).grand.redFlagStores).toBe(2) // 17% and 43% (10% is not above 10)
    expect(buildStoreAc(tickets, 'cluster', 42).grand.redFlagStores).toBe(1)
  })

  it('can group by region, priority list or AC-AMC brand, or not at all', () => {
    expect(buildStoreAc(tickets, 'none', 30).groups.map((g) => g.name)).toEqual(['All stores'])
    expect(buildStoreAc(tickets, 'region', 30).groups.map((g) => g.name)).toEqual(['R2'])
    expect(buildStoreAc(tickets, 'acAmcBrand', 30).groups.map((g) => g.name)).toEqual(['DAIKIN'])
    expect([parseStoreAcGroup('region'), parseStoreAcGroup('nonsense'), parseStoreAcGroup(undefined)]).toEqual(['region', 'cluster', 'cluster'])
  })

  it('folded groups hide their stores; "no grouping" shows only stores', () => {
    const r = buildStoreAc(tickets, 'cluster', 30)
    expect(flattenStoreAc(r, new Set(), 'cluster').map((x) => x.kind)).toEqual(['group', 'store', 'store', 'group', 'store', 'group', 'store'])
    expect(flattenStoreAc(r, new Set(['BR3', 'JH1']), 'cluster').map((x) => `${x.kind}:${x.group.name}`)).toEqual(['group:BR3', 'group:JH1', 'group:(Not set)', 'store:(Not set)'])
    expect(flattenStoreAc(buildStoreAc(tickets, 'none', 30), new Set(), 'none').every((x) => x.kind === 'store')).toBe(true)
  })

  it('no tickets: nothing to show', () => {
    const r = buildStoreAc([], 'cluster', 30)
    expect(r.groups).toEqual([])
    expect(r.grand).toMatchObject({ stores: 0, total: 0, pct: null })
  })
})

describe('Store AC Not Working Excel', () => {
  const build = async (groupBy: 'cluster' | 'none', collapsed?: ReadonlySet<string>) => {
    const wb = buildStoreAcWorkbook({
      title: 'Admin Store AC Not Working Report Age bucket wise', teamName: 'ADMIN GROUP', rangeLabel: 'All time', statusLabels: ['Open'], servicesLabel: 'ADMIN - AC',
      filtersText: '', redFlagPercent: 30, groupBy, report: buildStoreAc(tickets, groupBy, 30), collapsed,
    })
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(await wb.xlsx.writeBuffer())
    return back.getWorksheet('Stores')!
  }
  const rowsOf = (sheet: ExcelJS.Worksheet) => { const out: unknown[][] = []; sheet.eachRow((row, r) => { if (r > STORE_AC_HEADER_ROW) out.push((row.values as unknown[]).slice(1)) }); return out }

  it('has the store columns, the red flag, one column per age bucket and a total that adds up', async () => {
    const sheet = await build('cluster')
    const header = (sheet.getRow(STORE_AC_HEADER_ROW).values as unknown[]).slice(1)
    expect(header.slice(0, 3)).toEqual(['Cluster', 'Store', 'City'])
    expect(header.slice(-3)).toEqual(['0–5 days', '6–10 days', 'Grand Total'])
    expect(header).toContain('AC Not Working %')
    const rows = rowsOf(sheet)
    const lsr = rows.find((r) => r[1] === 'LSR')!
    expect(lsr[header.indexOf('Red Flag')]).toBe('Red Flag')
    expect(lsr[header.indexOf('AC Not Working %')]).toBe('43%')
    expect(lsr[header.indexOf('Open AC Tickets')]).toBe(3)
    const grand = rows[rows.length - 1]
    expect(grand[0]).toBe('Grand Total')
    expect(grand[header.indexOf('AC Total')]).toBe(29)
    expect(grand[grand.length - 1]).toBe(7)
  })

  it('folds like the screen, and "no grouping" has no group column', async () => {
    const folded = rowsOf(await build('cluster', new Set(['BR3', 'JH1', '(Not set)'])))
    expect(folded.map((r) => r[0])).toEqual(['BR3', 'JH1', '(Not set)', 'Grand Total'])
    const flat = await build('none')
    expect(((flat.getRow(STORE_AC_HEADER_ROW).values as unknown[]).slice(1))[0]).toBe('Store')
    expect(rowsOf(flat).map((r) => r[0])).toEqual(['LSR', 'SBP', 'KGP', 'NEW', 'Grand Total'])
  })
})

describe('Store AC Not Working screen', () => {
  const exportProps = { slug: 's', group: 'g', services: [], preset: 'all', from: '', to: '', statuses: ['open'], filters: {}, groupBy: 'cluster', redFlagPercent: 30 }
  const show = (defaultCollapsed = false) => render(<StoreAcView report={buildStoreAc(tickets, 'cluster', 30)} groupBy="cluster" redFlagPercent={30} defaultCollapsed={defaultCollapsed} exportProps={exportProps} />)

  it('shows the stores with their %, marks the red flag and counts the red flag stores', () => {
    show()
    expect(screen.getByText('LSR')).toBeTruthy()
    // the store's 43% and its cluster's 43% (the only store in it)
    expect(screen.getAllByText('43%')).toHaveLength(2)
    const lsrRow = screen.getByText('LSR').closest('tr')!
    expect(within(lsrRow).getByText('Red Flag')).toBeTruthy()
    expect(within(screen.getByText('SBP').closest('tr')!).queryByText('Red Flag')).toBeNull()
    expect(screen.getByText(/red flag \(above 30%\)/).textContent).toContain('1')
  })

  it('opens and closes a group with its arrow, and the level buttons close every group', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse JH1' }))
    expect(screen.queryByText('LSR')).toBeNull()
    expect(screen.getByText('SBP')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand JH1' }))
    expect(screen.getByText('LSR')).toBeTruthy()
    const levels = within(screen.getByRole('group', { name: 'Level of detail' }))
    fireEvent.click(levels.getByRole('button', { name: 'Cluster' }))
    expect(screen.queryByText('SBP')).toBeNull()
    expect(screen.getByText('JH1')).toBeTruthy()
    fireEvent.click(levels.getByRole('button', { name: '+ Stores' }))
    expect(screen.getByText('SBP')).toBeTruthy()
  })

  it('says so when no store matches', () => {
    render(<StoreAcView report={buildStoreAc([], 'cluster', 30)} groupBy="cluster" redFlagPercent={30} defaultCollapsed={false} exportProps={exportProps} />)
    expect(screen.getByText('No stores match these filters')).toBeTruthy()
  })
})
