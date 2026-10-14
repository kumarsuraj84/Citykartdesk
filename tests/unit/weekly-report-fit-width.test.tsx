// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('@/lib/actions/fixedReportExport', () => ({ exportFixedReportXlsx: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { buildFixedReport, findFixedReport, type FixedReportDef } from '@/lib/reporting/analytics/fixed-reports'
import { resolveMonths } from '@/lib/reporting/analytics/weekly'
import { ReportTableView } from '@/components/reports/analytics/ReportTableView'
import { fact } from './helpers/fact'

afterEach(() => cleanup())

const months = resolveMonths('2026-04,2026-05', new Date('2026-10-14T10:00:00'))
const tableOf = (slug: string) =>
  buildFixedReport({ def: findFixedReport(slug) as FixedReportDef, facts: [fact({ ticketNo: 'CKSD-1', openMonth: 'Apr-26', createdAt: '2026-04-08T10:00:00.000Z' })], statusLabel: (s) => s, months, amcStores: [{ brand: 'DAIKIN', stores: 3, acs: 20 }] })

describe('the weekly, monthly and priority reports are only as wide as their columns', () => {
  it('are flagged compact, so the page does not stretch their few columns', () => {
    for (const slug of ['monthly-admin-report', 'priority-wise-report']) expect(tableOf(slug).compact).toBe(true)
    expect(buildFixedReport({ def: findFixedReport('admin-summary-report') as FixedReportDef, facts: [], statusLabel: (s) => s }).compact).toBeFalsy()
  })
  it('the table is drawn at the width its columns need, not 100% of the page', () => {
    const { container } = render(<ReportTableView table={tableOf('monthly-admin-report')} />)
    const table = container.querySelector('table') as HTMLElement
    expect(table.style.minWidth).toBe('')
    expect(table.style.width).toMatch(/px$/)
    expect(container.querySelector('.w-fit')).not.toBeNull()
  })
})
