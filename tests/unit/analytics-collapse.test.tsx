// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/lib/actions/analyticsReportExport', () => ({ exportAgeBucketReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { buildAgeSummary } from '@/lib/reporting/analytics/age-summary'
import { flattenSummary, collapsedForLevel, levelOf, catKey, NOTHING_COLLAPSED } from '@/lib/reporting/analytics/summary-rows'
import { AgeSummaryView } from '@/components/reports/analytics/AgeSummaryView'

afterEach(() => cleanup())

// Krishan: AC ISSUE (COOLING, FACE REVERSE) + FAN (one sub category). Mohit: FLOOD LIGHT (CHIP).
const summary = buildAgeSummary([
  { technician: 'Krishan', category: 'ADMIN AC ISSUE', subCategory: 'COOLING ISSUE', ageDays: 1 },
  { technician: 'Krishan', category: 'ADMIN AC ISSUE', subCategory: 'FACE REVERSE', ageDays: 2 },
  { technician: 'Krishan', category: 'ADMIN AC ISSUE', subCategory: 'FACE REVERSE', ageDays: 8 },
  { technician: 'Krishan', category: 'FAN', subCategory: 'CEILING FAN', ageDays: 3 },
  { technician: 'Mohit Kumar', category: 'FLOOD LIGHT ISSUE', subCategory: 'CHIP', ageDays: 1 },
])
const kinds = (c = NOTHING_COLLAPSED) => flattenSummary(summary, c).map((r) => `${r.kind}:${[r.techLabel, r.catLabel, r.subLabel].filter(Boolean).join('/')}`)

describe('which rows are shown when things are collapsed', () => {
  it('everything open: technician, category and sub category on the first row, a total row per technician', () => {
    expect(kinds()).toEqual([
      'sub:Krishan/ADMIN AC ISSUE/COOLING ISSUE',
      'sub:FACE REVERSE',
      'sub:FAN/CEILING FAN',
      'techTotal:Krishan Total',
      'sub:Mohit Kumar/FLOOD LIGHT ISSUE/CHIP',
      'techTotal:Mohit Kumar Total',
    ])
  })

  it('a collapsed category becomes one line with its own totals', () => {
    const rows = flattenSummary(summary, { tech: new Set(), cat: new Set([catKey('Krishan', 'ADMIN AC ISSUE')]) })
    expect(rows.map((r) => r.kind)).toEqual(['cat', 'sub', 'techTotal', 'sub', 'techTotal'])
    const cat = rows[0]
    expect(cat.techLabel).toBe('Krishan')
    expect(cat.catLabel).toBe('ADMIN AC ISSUE')
    expect(cat.subLabel).toBe('')
    expect(cat.total).toBe(3) // COOLING 1 + FACE REVERSE 2
    expect(cat.counts).toEqual({ '0–5 days': 2, '6–10 days': 1 })
    expect(rows[0].catToggle).toMatchObject({ type: 'cat', expanded: false })
  })

  it('a collapsed technician becomes one line with their totals, and loses the separate total row', () => {
    const rows = flattenSummary(summary, { tech: new Set(['Krishan']), cat: new Set() })
    expect(rows.map((r) => r.kind)).toEqual(['tech', 'sub', 'techTotal'])
    expect(rows[0].techLabel).toBe('Krishan')
    expect(rows[0].total).toBe(4)
    expect(rows[0].techToggle).toMatchObject({ type: 'tech', expanded: false })
  })

  it('every group of rows has its arrow on the right row', () => {
    const rows = flattenSummary(summary, NOTHING_COLLAPSED)
    expect(rows[0].techToggle).toMatchObject({ type: 'tech', key: 'Krishan', expanded: true })
    expect(rows[0].catToggle).toMatchObject({ type: 'cat', expanded: true })
    expect(rows[1].catToggle).toBeUndefined() // second sub category of the same category
    expect(rows[2].catToggle).toBeDefined()   // the next category starts here
  })

  it('the three level buttons match Excel: technicians only, + categories, + sub categories', () => {
    expect(flattenSummary(summary, collapsedForLevel(summary, 'technicians')).map((r) => r.kind)).toEqual(['tech', 'tech'])
    expect(flattenSummary(summary, collapsedForLevel(summary, 'categories')).map((r) => r.kind)).toEqual(['cat', 'cat', 'techTotal', 'cat', 'techTotal'])
    expect(flattenSummary(summary, collapsedForLevel(summary, 'subcategories')).map((r) => r.kind)).toEqual(['sub', 'sub', 'sub', 'techTotal', 'sub', 'techTotal'])
  })

  it('knows which level button to light up, or none when mixed by hand', () => {
    expect(levelOf(summary, collapsedForLevel(summary, 'technicians'))).toBe('technicians')
    expect(levelOf(summary, collapsedForLevel(summary, 'categories'))).toBe('categories')
    expect(levelOf(summary, NOTHING_COLLAPSED)).toBe('subcategories')
    expect(levelOf(summary, { tech: new Set(), cat: new Set([catKey('Krishan', 'FAN')]) })).toBeNull()
  })

  it('collapsing never changes any number, only how many lines show it', () => {
    const sumOf = (c: Parameters<typeof flattenSummary>[1]) => flattenSummary(summary, c).filter((r) => r.kind !== 'techTotal').reduce((a, r) => a + r.total, 0)
    expect(sumOf(NOTHING_COLLAPSED)).toBe(5)
    expect(sumOf(collapsedForLevel(summary, 'categories'))).toBe(5)
    expect(sumOf(collapsedForLevel(summary, 'technicians'))).toBe(5)
  })
})

describe('the table on screen', () => {
  const exportProps = { slug: 's', group: 'g', services: [], preset: 'all', from: '', to: '', statuses: ['open'] }
  const renderView = () => render(<AgeSummaryView summary={summary} dayWord="today" exportProps={exportProps} />)
  const bodyText = () => [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '')
  const has = (text: string) => bodyText().some((t) => t.includes(text))

  it('starts fully open', () => {
    renderView()
    expect(has('COOLING ISSUE')).toBe(true)
    expect(has('CEILING FAN')).toBe(true)
    expect(screen.getByRole('button', { name: '+ Sub categories' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('the arrow next to a category hides its sub categories and shows the category total; clicking again brings them back', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse ADMIN AC ISSUE' }))
    expect(has('COOLING ISSUE')).toBe(false)
    expect(has('FACE REVERSE')).toBe(false)
    expect(has('ADMIN AC ISSUE')).toBe(true)
    expect(has('CEILING FAN')).toBe(true) // other categories untouched
    fireEvent.click(screen.getByRole('button', { name: 'Expand ADMIN AC ISSUE' }))
    expect(has('COOLING ISSUE')).toBe(true)
  })

  it('"+ Categories" shows categories only, "Technicians" shows technicians only, "+ Sub categories" opens everything', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: '+ Categories' }))
    expect(has('COOLING ISSUE')).toBe(false)
    expect(has('ADMIN AC ISSUE')).toBe(true)
    expect(has('FLOOD LIGHT ISSUE')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Technicians' }))
    expect(has('ADMIN AC ISSUE')).toBe(false)
    expect(has('Krishan')).toBe(true)
    expect(has('Mohit Kumar')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '+ Sub categories' }))
    expect(has('COOLING ISSUE')).toBe(true)
  })

  it('the Grand Total row never goes away', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Technicians' }))
    const last = bodyText().at(-1)!
    expect(last.startsWith('Grand Total')).toBe(true)
    expect(within(document.querySelector('tbody tr:last-child') as HTMLElement).getAllByRole('cell').some((c) => c.textContent === '5')).toBe(true)
  })

  it('the first three columns are frozen too (Responsible, Category, Sub Category) in every row', () => {
    renderView()
    const lefts = ['md:left-0', 'md:left-[150px]', 'md:left-[340px]']
    const headCells = [...document.querySelectorAll('thead th')].slice(0, 3)
    // heading cells are sticky to the top already; the frozen three also stick left and sit ABOVE the scrolling headings (z-30 vs z-10)
    headCells.forEach((th, i) => { expect(th.className).toContain('sticky'); expect(th.className).toContain('md:z-30'); expect(th.className).toContain(lefts[i]) })
    const others = [...document.querySelectorAll('thead th')].slice(3)
    others.forEach((th) => { expect(th.className).toContain('z-10'); expect(th.className).not.toContain('md:z-30') })
    for (const tr of document.querySelectorAll('tbody tr')) {
      const cells = [...tr.children]
      const spanning = cells[0].getAttribute('colspan') === '3' // total rows: one wide frozen cell
      const frozen = spanning ? [cells[0]] : cells.slice(0, 3)
      frozen.forEach((td, i) => { expect(td.className).toContain('md:sticky'); expect(td.className).toContain(lefts[i]) })
      // frozen cells must be solid, otherwise the numbers sliding underneath would show through
      frozen.forEach((td) => expect(td.className.includes('bg-card') || td.className.includes('bg-[color-mix')).toBe(true))
      // and nothing after the frozen block is frozen
      cells.slice(spanning ? 1 : 3).forEach((td) => expect(td.className).not.toContain('md:sticky'))
    }
  })

  it('column widths are fixed so the frozen offsets are exact', () => {
    renderView()
    const cols = [...document.querySelectorAll('colgroup col')].map((c) => (c as HTMLElement).style.width)
    expect(cols.slice(0, 3)).toEqual(['150px', '190px', '210px'])
    expect((document.querySelector('table') as HTMLElement).style.tableLayout).toBe('fixed')
  })

  it('the heading row is frozen: sticky cells inside a scrolling box', () => {
    renderView()
    const heads = [...document.querySelectorAll('thead th')]
    expect(heads.length).toBeGreaterThan(5)
    expect(heads.every((th) => th.className.includes('sticky') && th.className.includes('top-0'))).toBe(true)
    const box = document.querySelector('table')!.parentElement!
    expect(box.className).toContain('overflow-auto')
    expect(box.className).toMatch(/max-h-/)
  })
})

describe('Excel follows the screen', () => {
  it('writes the collapsed lines too', async () => {
    const { buildAgeBucketWorkbook, HEADER_ROW } = await import('@/lib/reporting/analytics/age-summary-xlsx')
    const ExcelJS = (await import('exceljs')).default
    const wb = buildAgeBucketWorkbook({
      title: 'T', teamName: 'G', rangeLabel: 'x', statusLabels: ['Open'], servicesLabel: 'All services', dayWord: 'today', ticketCount: 5, summary,
      collapsed: collapsedForLevel(summary, 'categories'),
    })
    const read = new ExcelJS.Workbook()
    await read.xlsx.load(await wb.xlsx.writeBuffer() as ArrayBuffer)
    const ws = read.getWorksheet('Summary')!
    const rows: unknown[][] = []
    for (let i = HEADER_ROW + 1; i <= ws.rowCount; i++) rows.push((ws.getRow(i).values as unknown[]).slice(1).slice(0, 3))
    expect(rows.map((r) => r.map((v) => v ?? '').join('|'))).toEqual([
      'Krishan|ADMIN AC ISSUE|',
      '|FAN|',
      'Krishan Total||',
      'Mohit Kumar|FLOOD LIGHT ISSUE|',
      'Mohit Kumar Total||',
      'Grand Total||',
    ])
  })
})
