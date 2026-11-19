// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

// The "Move Zoho tickets" table: select all that can be moved, views, reasons, shift-click, the limit of one batch, and that Move sends exactly what is ticked.
const refresh = vi.fn()
const moveAction = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/actions/zohoTransfer', () => ({ moveZohoTicketsAction: (...a: unknown[]) => moveAction(...a) }))

import { MoveWorkbench, type WorkbenchRow } from '@/app/(app)/zoho/move/MoveWorkbench'

beforeEach(() => { refresh.mockReset(); moveAction.mockReset() })
afterEach(() => cleanup())

const cell = (n: number) => [<td key="c">{`ticket ${n}`}</td>]
const row = (n: number, ready: boolean, ...codes: string[]): WorkbenchRow => ({ zohoNo: n, ready, codes, cells: cell(n) })
const reasons = [{ code: 'service_unmapped', title: 'Zoho service + category not mapped', count: 2 }, { code: 'already_moved', title: 'Already moved', count: 1 }]

function setup(rows: WorkbenchRow[], over: Partial<Parameters<typeof MoveWorkbench>[0]> = {}) {
  return render(<MoveWorkbench rows={rows} reasons={reasons} total={rows.length} truncated={false} canMove limit={25} unmatched={0} notice={null} fixHref="/zoho/mapping" {...over} />)
}
const tickBoxes = () => screen.queryAllByRole('checkbox').filter((c) => /^Move Zoho ticket/.test(c.getAttribute('aria-label') ?? '')) as HTMLInputElement[]
const mixed = [row(101, true), row(102, false, 'service_unmapped'), row(103, true), row(104, false, 'already_moved'), row(105, true), row(106, false, 'service_unmapped')]

describe('Move Zoho tickets: the table', () => {
  it('shows the counts and only ready tickets have a tick box', () => {
    setup(mixed)
    expect(screen.getByRole('button', { name: /Can be moved 3/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Cannot move yet 3/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^All 6/ })).toBeTruthy()
    expect(tickBoxes().map((c) => c.getAttribute('aria-label'))).toEqual(['Move Zoho ticket 101', 'Move Zoho ticket 103', 'Move Zoho ticket 105'])
  })

  it('"Select all that can be moved" ticks every ready ticket and nothing else, and "Clear ticks" undoes it', () => {
    setup(mixed)
    fireEvent.click(screen.getByRole('button', { name: /Select all that can be moved/ }))
    expect(tickBoxes().every((c) => c.checked)).toBe(true)
    expect(screen.getByText('3', { selector: 'strong' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear ticks' }))
    expect(tickBoxes().every((c) => !c.checked)).toBe(true)
  })

  it('the views: only the tickets that can be moved, only the ones that cannot, and a reason narrows the blocked list', () => {
    setup(mixed)
    fireEvent.click(screen.getByRole('button', { name: /Can be moved 3/ }))
    expect(screen.queryByText('ticket 102')).toBeNull()
    expect(screen.getByText('ticket 101')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Cannot move yet 3/ }))
    expect(screen.queryByText('ticket 101')).toBeNull()
    expect(screen.getByText('ticket 102')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/stopped for this reason/), { target: { value: 'already_moved' } })
    expect(screen.getByText('ticket 104')).toBeTruthy()
    expect(screen.queryByText('ticket 102')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getAllByText(/^ticket \d+$/)).toHaveLength(6)
  })

  it('the first batch only: with 30 ready tickets, 25 are ticked and the screen says why', () => {
    setup(Array.from({ length: 30 }, (_, i) => row(i + 1, true)))
    fireEvent.click(screen.getByRole('button', { name: /Select all that can be moved/ }))
    expect(tickBoxes().filter((c) => c.checked)).toHaveLength(25)
    expect(screen.getByRole('status').textContent).toMatch(/only 25 can be moved at a time.*5 more are ready/)
    // a 26th cannot be ticked by hand either
    fireEvent.click(tickBoxes()[25])
    expect(tickBoxes().filter((c) => c.checked)).toHaveLength(25)
  })

  it('shift-click ticks the ready tickets between two clicks', () => {
    setup(mixed)
    const boxes = tickBoxes()
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[2], { shiftKey: true })
    expect(tickBoxes().map((c) => c.checked)).toEqual([true, true, true])
  })

  it('the heading box ticks and unticks everything that can be moved', () => {
    setup(mixed)
    const head = screen.getByLabelText(/Tick or untick every ticket/) as HTMLInputElement
    fireEvent.click(head)
    expect(tickBoxes().every((c) => c.checked)).toBe(true)
    fireEvent.click(head)
    expect(tickBoxes().every((c) => !c.checked)).toBe(true)
  })

  it('Move asks first, then sends exactly the ticked numbers, then refreshes the list', async () => {
    moveAction.mockResolvedValue({ results: [{ zohoNo: 101, ok: true, requestNo: 'ZOHO-101', notes: [] }, { zohoNo: 103, ok: true, requestNo: 'ZOHO-103', notes: [] }] })
    setup(mixed)
    fireEvent.click(tickBoxes()[0]); fireEvent.click(tickBoxes()[1])
    fireEvent.click(screen.getByRole('button', { name: /Move 2 ticked tickets/ }))
    expect(moveAction).not.toHaveBeenCalled()                         // nothing moves before the second question
    fireEvent.click(screen.getByRole('button', { name: 'Yes, move them now' }))
    await waitFor(() => expect(moveAction).toHaveBeenCalledWith([101, 103]))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(within(screen.getByRole('status', { name: '' }) as HTMLElement).queryByText(/2 moved/)).toBeTruthy()
  })

  it('moving with nothing ticked is refused with a hint, and a person who may not move tickets sees no tick boxes', () => {
    setup(mixed)
    expect((screen.getByRole('button', { name: 'Move the ticked tickets' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    setup(mixed, { canMove: false })
    expect(tickBoxes()).toHaveLength(0)
    expect(screen.getByText(/Only an administrator can move tickets/)).toBeTruthy()
  })

  it('"Move all N that match" shows when more tickets match than one batch, and opens the run panel at the bottom of the page', () => {
    const tools = document.createElement('details'); tools.id = 'more-tools'
    const panel = document.createElement('section'); panel.id = 'move-everything'; panel.scrollIntoView = vi.fn()
    tools.appendChild(panel); document.body.appendChild(tools)
    setup(mixed, { total: 818, truncated: true })
    fireEvent.click(screen.getByRole('button', { name: /Move all 818 that match/ }))
    expect(tools.open).toBe(true)
    expect(panel.scrollIntoView).toHaveBeenCalled()
    tools.remove()
    cleanup()
    setup(mixed)                                                      // 6 match: one batch is enough, no extra button
    expect(screen.queryByRole('button', { name: /Move all/ })).toBeNull()
    cleanup()
    setup(mixed, { total: 818, truncated: true, canMove: false })    // a person who may not move sees nothing to press
    expect(screen.queryByRole('button', { name: /Move all/ })).toBeNull()
  })

  it('tickets that were moved (no longer ready after the refresh) leave the selection', () => {
    const view = setup(mixed)
    fireEvent.click(screen.getByRole('button', { name: /Select all that can be moved/ }))
    view.rerender(<MoveWorkbench rows={[row(101, false, 'already_moved'), ...mixed.slice(1)]} reasons={reasons} total={6} truncated={false} canMove limit={25} unmatched={0} notice={null} fixHref={null} />)
    expect(screen.getByText('2', { selector: 'strong' })).toBeTruthy()
  })
})
