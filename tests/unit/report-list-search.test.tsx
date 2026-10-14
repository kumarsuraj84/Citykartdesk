// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ReportSearchList, matchesReportSearch } from '@/components/reports/analytics/ReportSearchList'
import { FIXED_REPORTS, REPORTS_FOLDER } from '@/lib/reporting/analytics/fixed-reports'

afterEach(() => cleanup())

describe('searching the predefined reports by name', () => {
  it('matches any capitals and every word typed', () => {
    expect(matchesReportSearch('Weekly Admin Report', 'weekly')).toBe(true)
    expect(matchesReportSearch('Weekly Admin Report', 'ADMIN report')).toBe(true)
    expect(matchesReportSearch('Weekly Admin Report', 'monthly')).toBe(false)
    expect(matchesReportSearch('Weekly Admin Report', '  ')).toBe(true)
  })
  it('narrows the list as you type, says how many matched, and can be cleared', () => {
    render(<ReportSearchList folder={REPORTS_FOLDER} reports={FIXED_REPORTS.map((d) => ({ slug: d.slug, title: d.title }))} />)
    expect(screen.getAllByRole('link')).toHaveLength(FIXED_REPORTS.length)
    fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'admin' } })
    const names = screen.getAllByRole('link').map((a) => a.textContent)
    expect(names).toEqual(expect.arrayContaining(['Weekly Admin Report', 'Monthly Admin Report', 'Admin Summary Report']))
    expect(names).not.toContain('NSO Status Report')
    expect(screen.getByText(`${names.length} of ${FIXED_REPORTS.length}`)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No report matches/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Clear search'))
    expect(screen.getAllByRole('link')).toHaveLength(FIXED_REPORTS.length)
  })
})
