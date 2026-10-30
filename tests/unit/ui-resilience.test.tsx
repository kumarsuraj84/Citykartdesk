// @vitest-environment jsdom
/**
 * Audit fixes for the app shell and forms (E-01, E-02, E-04, E-05, E-22, E-25, E-30):
 *  - one failed page no longer kills every page until a full reload;
 *  - the background refresh waits while rows are ticked or a pop-up is open, and keeps away from heavy pages;
 *  - pop-ups close with Escape and give focus back;
 *  - a ticked row survives a background refresh; bulk Cancel / Resolve ask for a message first;
 *  - a failed send keeps what the person typed and says so in plain words.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { useState } from 'react'

const nav = vi.hoisted(() => ({ pathname: '/requests', refresh: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh, push: nav.push, replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/events/client', () => ({ queueEvent: vi.fn(), flushEvents: vi.fn() }))
vi.mock('@/lib/error-reporting', () => ({ reportError: vi.fn() }))

const updateRequestStatus = vi.hoisted(() => vi.fn(async () => ({})))
const bulkUpdateStatus = vi.hoisted(() => vi.fn(async () => ({ succeeded: [] as string[], failed: [] as { id: string; error: string }[] })))
const addComment = vi.hoisted(() => vi.fn(async (): Promise<{ commentId?: string; error?: string }> => ({ commentId: 'c1' })))
vi.mock('@/lib/actions/requests', () => ({
  bulkAssignRequests: vi.fn(), bulkUpdateStatus, bulkAddCollaborators: vi.fn(), bulkExportRequests: vi.fn(), searchOrgMembers: vi.fn(async () => []),
  updateRequestStatus, addComment, deleteEmptyComment: vi.fn(),
}))
vi.mock('@/lib/actions/attachments', () => ({ uploadAttachment: vi.fn(async () => ({})) }))
vi.mock('@/lib/actions/ticketCopy', () => ({ copyCommentByEmail: vi.fn(), searchCcContacts: vi.fn(async () => []) }))
vi.mock('@/lib/attachments/validate', () => ({ validateAttachment: vi.fn(async () => ({ valid: true })) }))
vi.mock('@/components/requests/SLABadge', () => ({ SLABadge: () => null }))
vi.mock('@/components/requests/RequestBadges', () => ({
  StatusBadge: () => null, PriorityBadge: () => null, ReopenedBadge: () => null, SourceBadge: () => null,
}))

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AutoRefresh } from '@/components/layout/AutoRefresh'
import { useModalA11y } from '@/components/ui/useModalA11y'
import { isBusy } from '@/lib/ui/busy'
import { RequestsTable } from '@/components/requests/RequestsTable'
import { CommentForm } from '@/components/requests/CommentForm'
import type { RequestWithRelations } from '@/types'

beforeEach(() => { nav.pathname = '/requests'; nav.refresh.mockClear(); nav.push.mockClear(); updateRequestStatus.mockClear(); bulkUpdateStatus.mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

// ── E-01 ─────────────────────────────────────────────────────────────────────

describe('ErrorBoundary (E-01)', () => {
  function Bomb({ explode }: { explode: boolean }) {
    if (explode) throw new Error('Server Components render failed')
    return <p>page is fine</p>
  }

  it('shows a plain message (not the raw error), then recovers when the person moves to another page', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(<ErrorBoundary><Bomb explode /></ErrorBoundary>)
    expect(screen.getByText('This page could not load')).toBeTruthy()
    expect(screen.queryByText(/Server Components render failed/)).toBeNull()

    nav.pathname = '/home'
    rerender(<ErrorBoundary><Bomb explode={false} /></ErrorBoundary>)
    expect(screen.getByText('page is fine')).toBeTruthy()
    quiet.mockRestore()
  })

  it('"Try again" asks the server again and redraws the page', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    let explode = true
    function Flaky() { if (explode) throw new Error('boom'); return <p>back again</p> }
    render(<ErrorBoundary><Flaky /></ErrorBoundary>)
    expect(screen.getByRole('link', { name: 'Go to Home' }).getAttribute('href')).toBe('/home')
    explode = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(nav.refresh).toHaveBeenCalled()
    expect(screen.getByText('back again')).toBeTruthy()
    quiet.mockRestore()
  })
})

// ── E-04 / E-05 ──────────────────────────────────────────────────────────────

describe('AutoRefresh (E-04, E-05)', () => {
  it('refreshes about every 30 seconds on a ticket page, not every 12', () => {
    vi.useFakeTimers()
    render(<AutoRefresh />)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(nav.refresh).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(20_000) }) // 40 s: past the longest possible first wait (36 s)
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })

  it('stays off on the dashboards, the intake inbox and the admin pages', () => {
    vi.useFakeTimers()
    for (const path of ['/dashboards/executive', '/intake/inbox', '/admin/users']) {
      nav.pathname = path
      const { unmount } = render(<AutoRefresh />)
      act(() => { vi.advanceTimersByTime(120_000) })
      unmount()
    }
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it('waits while a pop-up is open and carries on after it closes', () => {
    vi.useFakeTimers()
    function Page() {
      const [open, setOpen] = useState(true)
      const dialog = useModalA11y({ onClose: () => setOpen(false), label: 'Test dialog', enabled: open })
      return open ? <div {...dialog.props}><button>inside</button></div> : <p>closed</p>
    }
    render(<><AutoRefresh /><Page /></>)
    act(() => { vi.advanceTimersByTime(90_000) })
    expect(nav.refresh).not.toHaveBeenCalled() // dialog open
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(nav.refresh).toHaveBeenCalled()
  })
})

// ── E-22 ─────────────────────────────────────────────────────────────────────

describe('useModalA11y (E-22)', () => {
  function Demo({ onClose }: { onClose: () => void }) {
    const dialog = useModalA11y({ onClose, label: 'Demo' })
    return <div {...dialog.props}><button>first</button><button>second</button></div>
  }

  it('is a labelled modal dialog, focuses the first control, closes on Escape, and marks the page busy while open', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<Demo onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Demo' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByText('first'))
    expect(isBusy()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    expect(isBusy()).toBe(false)
    expect(document.activeElement).toBe(opener) // focus goes back to what opened it
    opener.remove()
  })

  it('keeps Tab inside the dialog', () => {
    render(<Demo onClose={() => {}} />)
    screen.getByText('second').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('first'))
  })
})

// ── E-04 / E-23 / E-25 ───────────────────────────────────────────────────────

function row(id: string, no: string): RequestWithRelations {
  return {
    id, request_no: no, title: `Printer: Jam ${no}`, status: 'open', priority: 'medium', reopen_count: 0, updated_at: new Date().toISOString(),
    service: { name: 'Printer' }, requester: { id: 'u9', full_name: 'Asha' }, assignee: null, category: null, sub_category: null,
    resolution_due_at: null, response_due_at: null, source_metadata: null,
  } as unknown as RequestWithRelations
}

function table(requests: RequestWithRelations[]) {
  return (
    <RequestsTable requests={requests} emptyTitle="none" emptyDescription="none" viewerId="v1" teamMembers={[]}
      showAssignAction={false} sortCol="updated_at" sortDir="desc" pathname="/requests/queue" currentSearch="" />
  )
}

describe('RequestsTable (E-04, E-23, E-25)', () => {
  it('keeps the ticked rows when the page refreshes with the same tickets, drops them for a different page', () => {
    const { rerender } = render(table([row('a', 'CKSD-1'), row('b', 'CKSD-2')]))
    fireEvent.click(screen.getByRole('button', { name: 'Select CKSD-1' }))
    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(isBusy()).toBe(true) // so the background refresh waits while rows are ticked

    rerender(table([row('a', 'CKSD-1'), row('b', 'CKSD-2')])) // a background refresh: new array, same tickets
    expect(screen.getByText('1 selected')).toBeTruthy()

    rerender(table([row('x', 'CKSD-9')])) // a different page of tickets
    expect(screen.queryByText(/selected/)).toBeNull()
    expect(isBusy()).toBe(false)
  })

  it('shows the ticket number and title as real links, and labels the select-all box for what it does', () => {
    render(table([row('a', 'CKSD-1')]))
    const link = screen.getByRole('link', { name: 'CKSD-1' })
    expect(link.getAttribute('href')).toContain('/requests/a')
    expect(screen.getByRole('button', { name: 'Select all on this page' })).toBeTruthy()
  })

  it('asks for a message before cancelling several tickets, and sends it once for all of them', async () => {
    render(table([row('a', 'CKSD-1'), row('b', 'CKSD-2')]))
    fireEvent.click(screen.getByRole('button', { name: 'Select all on this page' }))
    fireEvent.click(screen.getByRole('button', { name: /Change Status/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }))
    expect(bulkUpdateStatus).not.toHaveBeenCalled()
    // nothing is sent until the message is written
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel tickets' }))
    expect(screen.getByText('This message is required.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Duplicate of another ticket' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tickets' }))
    await waitFor(() => expect(bulkUpdateStatus).toHaveBeenCalledTimes(1))
    expect(bulkUpdateStatus).toHaveBeenCalledWith(['a', 'b'], 'cancelled', 'Duplicate of another ticket')
  })

  it('keeps a result message with the ticket numbers and reasons until it is closed', async () => {
    bulkUpdateStatus.mockImplementationOnce(async () => ({ succeeded: ['b'], failed: [{ id: 'a', error: 'Transition is not permitted.' }] }))
    render(table([row('a', 'CKSD-1'), row('b', 'CKSD-2')]))
    fireEvent.click(screen.getByRole('button', { name: 'Select all on this page' }))
    fireEvent.click(screen.getByRole('button', { name: /Change Status/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'No longer needed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tickets' }))
    expect(await screen.findByText(/1 of 2 requests could not be updated/)).toBeTruthy()
    expect(screen.getByText(/Transition is not permitted\./)).toBeTruthy()
    expect(screen.getByText('1 selected')).toBeTruthy() // only the failed ticket stays ticked, for a retry
    fireEvent.click(screen.getByRole('button', { name: 'Close this message' }))
    expect(screen.queryByText(/could not be updated/)).toBeNull()
  })
})

// ── E-02 / E-30 ──────────────────────────────────────────────────────────────

describe('CommentForm when the server cannot be reached (E-02, E-30)', () => {
  it('keeps the typed comment and says what to do, instead of throwing to the error page', async () => {
    addComment.mockImplementationOnce(async () => { throw new Error('Failed to fetch') })
    render(<CommentForm requestId="r1" canPostInternal={false} />)
    const box = screen.getByPlaceholderText(/Add a public comment/) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Please call me back' } })
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    expect(await screen.findByText(/Could not send\. Check your internet/)).toBeTruthy()
    expect(box.value).toBe('Please call me back')
  })

  it('adds a template after what is already typed instead of replacing it', async () => {
    render(<CommentForm requestId="r1" canPostInternal={false} />)
    const box = screen.getByPlaceholderText(/Add a public comment/) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Hello Asha,' } })
    fireEvent.click(screen.getByRole('button', { name: /Templates/ }))
    const firstTemplate = document.querySelector('div.max-h-60 button') as HTMLButtonElement
    const bodyText = firstTemplate.querySelector('p.line-clamp-1')?.textContent ?? ''
    fireEvent.click(firstTemplate)
    await waitFor(() => expect(box.value.startsWith('Hello Asha,')).toBe(true))
    expect(box.value.length).toBeGreaterThan('Hello Asha,'.length)
    expect(bodyText.length).toBeGreaterThan(0)
  })
})
