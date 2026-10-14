// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/reports/analytics/repeated-ac-complain-report' }))

import { ReportFilters } from '@/components/reports/analytics/ReportFilters'

afterEach(() => { cleanup(); push.mockClear() })

const props = {
  combos: [], groups: [], services: [], defaults: { statuses: [], groups: [], services: [] }, effective: { statuses: [], techs: [], groups: [], services: [] },
}
const options = [{ value: '2026-10', label: 'October 2026' }, { value: '2026-09', label: 'September 2026' }, { value: '2026-08', label: 'August 2026' }]

describe('the month filter of the monthly-style reports takes several months, to compare month on month', () => {
  it('ticks any number of months and applies them in the page address', () => {
    render(<ReportFilters {...props} month={{ value: '2026-10', multi: true, resetLabel: 'This month', options }} />)
    fireEvent.click(screen.getByRole('button', { name: /Month \(1\)/ }))
    const box = screen.getByRole('listbox', { name: 'Month choices' })
    fireEvent.click(within(box).getByLabelText('September 2026'))
    fireEvent.click(within(box).getByLabelText('August 2026'))
    fireEvent.click(within(box).getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(String(push.mock.calls[0][0])).toContain('month=2026-08%2C2026-09%2C2026-10')
  })
  it('the reset button goes back to the report\'s own month', () => {
    render(<ReportFilters {...props} month={{ value: '2026-09,2026-10', multi: true, resetLabel: 'This month', options }} />)
    fireEvent.click(screen.getByRole('button', { name: /Month \(2\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'This month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(String(push.mock.calls[0][0])).not.toContain('month=')
  })
})
