// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

let path = '/home'
vi.mock('next/navigation', () => ({ usePathname: () => path }))
vi.mock('@/components/ckoneai/assistant.css', () => ({}))

import { AssistantLauncher, ASSISTANT_FRAME_SRC } from '@/components/ckoneai/AssistantLauncher'

let headStatus = 200
beforeEach(() => { headStatus = 200; vi.stubGlobal('fetch', vi.fn(async () => ({ status: headStatus }))) })
afterEach(() => { cleanup(); path = '/home'; vi.unstubAllGlobals() })

const frame = () => document.querySelector('iframe') as HTMLIFrameElement | null
const win = () => document.getElementById('ckoneai-window') as HTMLElement | null
const launcher = () => document.querySelector('.ai-launcher') as HTMLButtonElement
const post = (data: unknown, source: unknown, origin = window.location.origin) =>
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource })) })
const openIt = async () => { await act(async () => { fireEvent.click(launcher()) }) }
const statusText = () => document.querySelector('.ai-head__status')?.textContent

describe('the Ask CK Desk bot button (the CKOneAI assistant button)', () => {
  it('is the CKOneAI robot button, bottom right, with the Ask CK Desk label, and loads nothing before a click', () => {
    render(<AssistantLauncher />)
    expect(document.querySelector('.ai-root')).toBeTruthy()
    expect(launcher().querySelector('svg .ai-robot-eyes')).toBeTruthy()          // the robot with its blinking eyes
    expect(launcher().textContent).toContain('Ask CK Desk')
    expect(launcher().textContent).toContain('Tickets, approvals, SLA')
    expect(launcher().getAttribute('aria-label')).toBe('Open Ask CK Desk')
    expect(frame()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()                                          // nothing calls the assistant while a page is merely viewed
  })

  it('opens the window on the first click and creates the chat page then; minimise keeps it, close removes it', async () => {
    render(<AssistantLauncher />)
    await openIt()
    expect(frame()!.getAttribute('src')).toBe(ASSISTANT_FRAME_SRC)
    expect(ASSISTANT_FRAME_SRC).toBe('/ckoneai-ui?embed=1&bridge=ckdesk')
    expect(win()!.getAttribute('data-open')).toBe('true')
    expect(launcher().getAttribute('aria-expanded')).toBe('true')
    const first = frame()
    fireEvent.click(screen.getByRole('button', { name: 'Minimise' }))
    expect(win()!.getAttribute('data-open')).toBe('false')
    expect(frame()).toBe(first)                                                   // kept: the conversation stays
    await openIt()
    expect(win()!.getAttribute('data-open')).toBe('true')
    expect(frame()).toBe(first)
    fireEvent.click(screen.getByRole('button', { name: /^Close and end/ }))
    expect(frame()).toBeNull()                                                    // removed
  })

  it('Esc minimises it and returns focus to the button, and so does the Esc message of the chat page', async () => {
    render(<AssistantLauncher />)
    await openIt()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(win()!.getAttribute('data-open')).toBe('false')
    expect(document.activeElement).toBe(launcher())
    await openIt()
    post({ type: 'ckoneai:escape' }, frame()!.contentWindow)
    expect(win()!.getAttribute('data-open')).toBe('false')
  })

  it('ignores messages that do not come from its own frame and own address', async () => {
    render(<AssistantLauncher />)
    await openIt()
    post({ type: 'ckoneai:escape' }, window)
    post({ type: 'ckoneai:escape' }, frame()!.contentWindow, 'http://evil.example')
    post('ckoneai:escape', frame()!.contentWindow)
    expect(win()!.getAttribute('data-open')).toBe('true')
  })

  it('shows Connecting, then Online only when the page is reachable, loaded and says it is ready or online', async () => {
    render(<AssistantLauncher />)
    await openIt()
    await act(async () => { await Promise.resolve() })                            // the reachability answer
    expect(statusText()).toContain('Connecting')                                  // reachable, but the frame has not loaded
    fireEvent.load(frame()!)
    expect(statusText()).toContain('Connecting')                                  // loaded, but no word from the page yet
    post({ type: 'ckoneai:ready' }, frame()!.contentWindow)
    expect(statusText()).toContain('Online')
    post({ type: 'ckoneai:status', state: 'offline' }, frame()!.contentWindow)
    expect(statusText()).toContain('Offline')
    expect(screen.getByText(/not reachable right now/)).toBeTruthy()
    post({ type: 'ckoneai:status', state: 'online' }, frame()!.contentWindow)
    expect(statusText()).toContain('Online')
  })

  it('shows Offline at once when the assistant page cannot be reached (502 / network failure)', async () => {
    headStatus = 502
    render(<AssistantLauncher />)
    await openIt()
    await act(async () => { await Promise.resolve() })
    expect(statusText()).toContain('Offline')
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    render(<AssistantLauncher />)
    await openIt()
    await act(async () => { await Promise.resolve() })
    expect(statusText()).toContain('Offline')
  })

  it('counts a reply finished while the window is minimised (once per reply), shows 9+ above nine, and clears when it is opened', async () => {
    render(<AssistantLauncher />)
    await openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Minimise' }))
    const w = frame()!.contentWindow
    post({ type: 'ckoneai:assistant-message', id: 'a' }, w)
    post({ type: 'ckoneai:assistant-message', id: 'a' }, w)                       // the same reply twice counts once
    post({ type: 'ckoneai:assistant-message', id: 'b' }, w)
    expect(launcher().querySelector('.ai-launcher__badge')!.textContent).toBe('2')
    expect(launcher().getAttribute('aria-label')).toBe('Open Ask CK Desk, 2 unread replies')
    for (let i = 0; i < 9; i++) post({ type: 'ckoneai:assistant-message', id: `x${i}` }, w)
    expect(launcher().querySelector('.ai-launcher__badge')!.textContent).toBe('9+')
    await openIt()
    expect(launcher().querySelector('.ai-launcher__badge')).toBeNull()
    post({ type: 'ckoneai:assistant-message', id: 'live' }, frame()!.contentWindow)   // a reply while the window is open and visible is not unread
    expect(launcher().querySelector('.ai-launcher__badge')).toBeNull()
  })

  it('has an Open on a full page link (new tab) and is not shown on the full page itself', async () => {
    const { unmount } = render(<AssistantLauncher />)
    await openIt()
    const a = screen.getByRole('link', { name: /Open on a full page/ })
    expect(a.getAttribute('href')).toBe('/ckoneai')
    expect(a.getAttribute('target')).toBe('_blank')
    unmount()
    path = '/ckoneai'
    render(<AssistantLauncher />)
    expect(document.querySelector('.ai-root')).toBeNull()
  })
})
