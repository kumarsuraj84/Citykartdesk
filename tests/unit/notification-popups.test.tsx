// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

const toastCustom = vi.hoisted(() => vi.fn())
const toastDismiss = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
const markRead = vi.hoisted(() => vi.fn(async () => ({})))
const path = vi.hoisted(() => ({ value: '/home' }))
vi.mock('sonner', () => ({ toast: { custom: toastCustom, dismiss: toastDismiss } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => path.value }))
vi.mock('@/lib/actions/notifications', () => ({ markNotificationRead: markRead }))

import { NotificationPopups } from '@/components/layout/NotificationPopups'
import { PREFS_KEY } from '@/lib/notifications/popup-rules'

const REQ = '123e4567-e89b-12d3-a456-426614174000'
const mk = (id: string, type: string, extra: object = {}) => ({
  id, type, title: `title ${id}`, body: 'body', link: `/requests/${REQ}`, request_id: REQ, metadata: null,
  created_at: new Date().toISOString(), actor_name: 'Ayush', ...extra,
})
let reply: { items: unknown[]; unread: number }
// the address argument is only there so the calls can be inspected
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ now: new Date().toISOString(), ...reply }) }))

async function runFirstCheck() {
  render(<NotificationPopups viewerId="u1" />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
}
const shownIds = () => toastCustom.mock.calls.map((c) => (c[1] as { id: string }).id)

beforeEach(() => {
  vi.useFakeTimers()
  toastCustom.mockClear(); toastDismiss.mockClear(); push.mockClear(); markRead.mockClear(); fetchMock.mockClear()
  localStorage.clear(); path.value = '/home'; reply = { items: [], unread: 0 }
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('notification pop-ups', () => {
  it('shows a card for a new notification and asks only for what is new since the last check', async () => {
    reply = { items: [mk('a', 'comment_added')], unread: 1 }
    await runFirstCheck()
    expect(shownIds()).toEqual(['popup-a'])
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/notifications/new?since=')
    await act(async () => { await vi.advanceTimersByTimeAsync(8100) })
    expect(String(fetchMock.mock.calls[1][0])).toContain('since=') // moved forward to the server time of the last check
  })

  it('shows each notification once, even if the same one comes back', async () => {
    reply = { items: [mk('a', 'comment_added')], unread: 1 }
    await runFirstCheck()
    await act(async () => { await vi.advanceTimersByTimeAsync(8100) })
    expect(shownIds()).toEqual(['popup-a'])
  })

  it('important cards stay, normal ones go by themselves', async () => {
    reply = { items: [mk('a', 'comment_added'), mk('b', 'sla_breached')], unread: 2 }
    await runFirstCheck()
    const durations = Object.fromEntries(toastCustom.mock.calls.map((c) => [(c[1] as { id: string }).id, (c[1] as { duration: number }).duration]))
    expect(durations['popup-a']).toBe(8000)
    expect(durations['popup-b']).toBe(Infinity)
  })

  it('folds a burst into at most three cards plus one summary', async () => {
    reply = { items: ['1', '2', '3', '4', '5'].map((i) => mk(i, 'comment_added')), unread: 5 }
    await runFirstCheck()
    const ids = shownIds()
    expect(ids.filter((i) => i.startsWith('popup-') && !i.startsWith('popup-more'))).toEqual(['popup-3', 'popup-4', 'popup-5'])
    expect(ids.some((i) => i.startsWith('popup-more'))).toBe(true)
  })

  it('stays quiet when the person chose important-only or no pop-ups', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'important', sound: false }))
    reply = { items: [mk('a', 'comment_added'), mk('b', 'approval_requested')], unread: 2 }
    await runFirstCheck()
    expect(shownIds()).toEqual(['popup-b'])
    toastCustom.mockClear()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'off', sound: false }))
    reply = { items: [mk('c', 'sla_breached')], unread: 3 }
    await act(async () => { await vi.advanceTimersByTimeAsync(8100) })
    expect(toastCustom).not.toHaveBeenCalled()
  })

  it('does not pop up a normal change on the ticket that is already open', async () => {
    path.value = `/requests/${REQ}`
    reply = { items: [mk('a', 'comment_added')], unread: 1 }
    await runFirstCheck()
    expect(toastCustom).not.toHaveBeenCalled()
  })

  it('a hidden tab shows no cards but puts the unread count in the tab title', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.title = 'Citykart Desk'
    reply = { items: [mk('a', 'comment_added')], unread: 4 }
    await runFirstCheck()
    expect(toastCustom).not.toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('since=')
    expect(document.title).toBe('(4) Citykart Desk')
  })

  it('two tabs of the same browser do not both show it', async () => {
    reply = { items: [mk('a', 'comment_added')], unread: 1 }
    await runFirstCheck()
    toastCustom.mockClear()
    // a second tab is a new component sharing the same browser storage
    localStorage.removeItem('ck-popup-since:u1')
    await runFirstCheck()
    expect(toastCustom).not.toHaveBeenCalled()
  })

  it('opening a card marks it read and goes to the ticket', async () => {
    reply = { items: [mk('a', 'comment_added')], unread: 1 }
    await runFirstCheck()
    const render1 = toastCustom.mock.calls[0][0] as (id: string) => { props: { onOpen: () => void } }
    render1('tid').props.onOpen()
    expect(markRead).toHaveBeenCalledWith('a')
    expect(push).toHaveBeenCalledWith(`/requests/${REQ}`)
    expect(toastDismiss).toHaveBeenCalledWith('tid')
  })

  it('carries on quietly if a check fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    reply = { items: [mk('a', 'comment_added')], unread: 1 }
    await runFirstCheck()
    expect(toastCustom).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(8100) })
    expect(shownIds()).toEqual(['popup-a'])
  })
})
