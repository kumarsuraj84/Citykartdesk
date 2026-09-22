// @vitest-environment jsdom
/**
 * DESK-BUG — reported while testing across roles: the header bells felt like they never
 * updated without a manual page reload. AppShell's AutoRefresh soft-refreshes every page
 * every 12s (router.refresh()), which hands NotificationBell/ApprovalsBell fresh
 * `initial*` props — but both seeded their own local state from those props via a plain
 * useState, which only reads the value on mount and silently ignores every later prop
 * change. This is a render-level test (mirrors the existing prop → local-state re-sync
 * already proven for RequestBoardView/CollaboratorsRow) — it doesn't need real timers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { ApprovalsBell } from '@/components/layout/ApprovalsBell'
import type { NotificationWithActor } from '@/types'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/actions/notifications', () => ({
  markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn(), archiveNotification: vi.fn(),
}))
vi.mock('@/lib/actions/approvals', () => ({ getApprovalForRequestAction: vi.fn() }))

afterEach(() => cleanup())

function n(id: string, overrides: Partial<NotificationWithActor> = {}): NotificationWithActor {
  return {
    id, user_id: 'u1', actor_id: 'a1', type: 'comment_added', title: `Note ${id}`, body: null,
    request_id: null, task_id: null, link: null, metadata: {}, read_at: null, archived_at: null,
    created_at: new Date().toISOString(), actor: { id: 'a1', full_name: 'Someone', avatar_url: null },
    ...overrides,
  } as NotificationWithActor
}

describe('header bells pick up fresh props from AutoRefresh (were frozen at mount)', () => {
  it('NotificationBell: badge count and list update when new initial props arrive', () => {
    const { rerender } = render(
      <NotificationBell initialNotifications={[n('1')]} initialUnreadCount={1} viewerId="u1" viewerRole="user" />
    )
    expect(screen.getByLabelText('1 unread notifications')).toBeTruthy()

    // Simulate AutoRefresh's router.refresh(): the server re-ran with fresh data (someone
    // else's action produced a second, newer notification).
    rerender(
      <NotificationBell initialNotifications={[n('2'), n('1')]} initialUnreadCount={2} viewerId="u1" viewerRole="user" />
    )
    expect(screen.getByLabelText('2 unread notifications')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('2 unread notifications'))
    expect(document.body.textContent).toContain('Note 2')
  })

  it('ApprovalsBell: the dropdown list updates too, not just the badge number', () => {
    const { rerender } = render(
      <ApprovalsBell initialNotifications={[n('1')]} initialCount={1} viewerId="u1" viewerRole="manager" />
    )
    rerender(
      <ApprovalsBell initialNotifications={[n('2'), n('1')]} initialCount={2} viewerId="u1" viewerRole="manager" />
    )
    expect(screen.getByLabelText('2 pending approvals')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('2 pending approvals'))
    expect(document.body.textContent).toContain('Note 2')
  })
})
