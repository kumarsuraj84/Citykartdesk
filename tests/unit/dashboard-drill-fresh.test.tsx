// @vitest-environment jsdom
// The normal dashboard counts its numbers when the page loads and again every minute. The pop-up behind a number must work from tickets that are as new as
// those numbers: the tickets loaded for an earlier click are forgotten when the page counts again, and they are read fresh, not from the one-minute store.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const load = vi.hoisted(() => vi.fn())
const exec = vi.hoisted(() => vi.fn())
const profile = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions/analytics-drill', async (orig) => ({ ...(await orig<typeof import('@/lib/actions/analytics-drill')>()), loadDrillData: load }))
vi.mock('@/lib/actions/executiveDashboard', () => ({ nudgeTicket: vi.fn(), getExecutiveTicketDetail: vi.fn(async () => ({ error: 'n/a' })) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { useRequestDrill } from '@/components/analytics/useRequestDrill'
import { emptyStoreFilter } from '@/lib/analytics/store-filter'

afterEach(() => { cleanup(); load.mockReset() })

const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime()
const mkEnv = (asOf: number) => ({ asOf, period: '30d' as const, periodWindow: { start: NOW - 86_400_000, end: NOW }, periodLabel: 'last 30 days', groupIds: [], groupName: () => 'G', techName: () => 'T', store: emptyStoreFilter() })

function Harness({ end }: { end: number }) {
  const drill = useRequestDrill(mkEnv(end), vi.fn())
  return <div><button onClick={() => drill.open({ title: 'Open', status: ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval'] })}>click</button>{drill.modal}</div>
}

describe('the pop-up of the normal dashboard works from fresh tickets', () => {
  it('loads once per count of the page, and again after the page counted again', async () => {
    load.mockResolvedValue({ now: NOW, tickets: [], approvals: [], truncated: false })
    const { rerender } = render(<Harness end={NOW} />)
    fireEvent.click(screen.getByText('click'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText('click'))                      // same count of the page: the loaded tickets are reused
    expect(load).toHaveBeenCalledTimes(1)
    rerender(<Harness end={NOW + 60_000} />)                         // the page counted again (a new moment): the old tickets are forgotten
    fireEvent.click(screen.getByText('click'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })
})

describe('loadDrillData reads fresh', () => {
  it('asks for the tickets without the one-minute store', async () => {
    vi.resetModules()
    vi.doUnmock('@/lib/actions/analytics-drill')
    vi.doMock('@/lib/queries/profiles', () => ({ getCurrentProfile: profile }))
    vi.doMock('@/lib/queries/executive-dashboard', () => ({ loadExecutiveData: exec }))
    profile.mockResolvedValue({ id: 'u1' })
    exec.mockResolvedValue({ now: 1, tickets: [], approvals: [], truncated: false })
    const { loadDrillData } = await import('@/lib/actions/analytics-drill')
    await loadDrillData()
    expect(exec).toHaveBeenCalledWith({ id: 'u1' }, { fresh: true, people: undefined })
  })
})
