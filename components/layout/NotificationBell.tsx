'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Bell, Check, CheckCheck, Archive, X, Eye, Loader2 } from 'lucide-react'
import { markNotificationRead, markAllNotificationsRead, archiveNotification } from '@/lib/actions/notifications'
import { getApprovalForRequestAction } from '@/lib/actions/approvals'
import { ApprovalPreviewDialog } from '@/components/requests/ApprovalPreviewDialog'
import { formatRelativeTime } from '@/lib/utils'
import type { NotificationWithActor, UserRole } from '@/types'
import type { ApprovalWithDetails } from '@/lib/queries/approvals'

// ── Notification icon map ─────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  request_assigned:    'bg-primary/10 text-primary',
  request_reassigned:  'bg-primary/10 text-primary',
  comment_added:       'bg-muted text-muted-foreground',
  internal_note_added: 'bg-warning/10 text-warning',
  mentioned:           'bg-primary/10 text-primary',
  collaborator_added:  'bg-info/10 text-info',
  collaborator_removed:'bg-muted text-muted-foreground',
  approval_requested:  'bg-primary/10 text-primary',
  approval_approved:   'bg-success/10 text-success',
  approval_rejected:   'bg-destructive/10 text-destructive',
  approval_decided:    'bg-success/10 text-success',
  request_resolved:    'bg-success/10 text-success',
  request_closed:      'bg-muted text-muted-foreground',
  request_auto_closed: 'bg-muted text-muted-foreground',
  request_cancelled:   'bg-destructive/10 text-destructive',
  priority_changed:    'bg-warning/10 text-warning',
  status_changed:      'bg-info/10 text-info',
  sla_warning:         'bg-warning/10 text-warning',
  sla_breached:        'bg-destructive/10 text-destructive',
}

// ── Single notification row ───────────────────────────────────────────────────

function NotificationRow({
  notification,
  onRead,
  onArchive,
  onClose,
  onPreviewApproval,
}: {
  notification: NotificationWithActor
  onRead: (id: string) => void
  onArchive: (id: string) => void
  onClose: () => void
  onPreviewApproval: (n: NotificationWithActor) => void
}) {
  const isUnread = !notification.read_at
  // Actionable — preview + act right here instead of navigating away.
  const isApproval = notification.type === 'approval_requested' && !!notification.request_id
  const initials = notification.actor?.full_name
    ? notification.actor.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const colorClass = TYPE_COLORS[notification.type] ?? 'bg-muted text-muted-foreground'

  const inner = (
    <div
      className={`group flex items-start gap-3 px-4 py-2 transition-colors hover:bg-muted/40 ${
        isUnread ? 'bg-primary/[0.03]' : ''
      }`}
    >
      {/* Avatar */}
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${colorClass}`}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p className={`text-xs leading-snug ${isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
            {notification.title}
          </p>
          {isUnread && (
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground" suppressHydrationWarning>
          {formatRelativeTime(notification.created_at)}
        </p>
      </div>

      {/* Actions — show on hover */}
      <div className="flex shrink-0 flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isApproval && (
          <span title="Preview & approve" className="rounded p-0.5 text-primary">
            <Eye className="h-3 w-3" />
          </span>
        )}
        {isUnread && (
          <button
            type="button"
            title="Mark as read"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRead(notification.id) }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Check className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          title="Archive"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArchive(notification.id) }}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <Archive className="h-3 w-3" />
        </button>
      </div>
    </div>
  )

  // Actionable approval notifications preview (and act) in place instead of
  // navigating away — a plain div (not a nested <button>) since the row
  // itself already contains the mark-read/archive buttons above.
  if (isApproval) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => { onRead(notification.id); onClose(); onPreviewApproval(notification) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRead(notification.id); onClose(); onPreviewApproval(notification) }
        }}
        className="block cursor-pointer border-b border-border last:border-0"
      >
        {inner}
      </div>
    )
  }

  // If there's a link, wrap in Link and mark read on click
  if (notification.link) {
    return (
      <Link
        href={notification.link}
        prefetch={false}
        onClick={() => { onRead(notification.id); onClose() }}
        className="block border-b border-border last:border-0"
      >
        {inner}
      </Link>
    )
  }

  return <div className="border-b border-border last:border-0">{inner}</div>
}

// ── NotificationBell ──────────────────────────────────────────────────────────

interface NotificationBellProps {
  initialNotifications: NotificationWithActor[]
  initialUnreadCount: number
  viewerId: string
  viewerRole: UserRole
  dark?: boolean
}

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
  viewerId,
  viewerRole,
  dark = false,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  const [previewApproval, setPreviewApproval] = useState<ApprovalWithDetails | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  async function handlePreviewApproval(n: NotificationWithActor) {
    if (!n.request_id) return
    setPreviewLoading(true)
    const approval = await getApprovalForRequestAction(n.request_id)
    setPreviewLoading(false)
    if (!approval) { toast.error('This approval is no longer available.'); return }
    setPreviewApproval(approval)
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleRead(id: string) {
    const prevNotifications = notifications
    const prevUnreadCount = unreadCount
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    )
    setUnreadCount((c) => Math.max(0, c - 1))
    startTransition(async () => {
      const result = await markNotificationRead(id)
      if (result?.error) { toast.error(result.error); setNotifications(prevNotifications); setUnreadCount(prevUnreadCount) }
    })
  }

  function handleArchive(id: string) {
    const prevNotifications = notifications
    const prevUnreadCount = unreadCount
    const wasUnread = notifications.find((n) => n.id === id && !n.read_at)
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1))
    startTransition(async () => {
      const result = await archiveNotification(id)
      if (result?.error) { toast.error(result.error); setNotifications(prevNotifications); setUnreadCount(prevUnreadCount) }
    })
  }

  function handleMarkAll() {
    const prevNotifications = notifications
    const prevUnreadCount = unreadCount
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    setUnreadCount(0)
    startTransition(async () => {
      const result = await markAllNotificationsRead()
      if (result?.error) { toast.error(result.error); setNotifications(prevNotifications); setUnreadCount(prevUnreadCount) }
    })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${unreadCount} unread notifications`}
        className={dark
          ? "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 transition-colors"
          : "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        }
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  disabled={isPending}
                  title="Mark all as read"
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onRead={handleRead}
                  onArchive={handleArchive}
                  onClose={() => setOpen(false)}
                  onPreviewApproval={handlePreviewApproval}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2.5">
            <Link
              href="/notifications"
              prefetch={false}
              onClick={() => setOpen(false)}
              className="block w-full text-center text-xs font-medium text-primary hover:underline"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}

      {previewLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}

      {previewApproval && (
        <ApprovalPreviewDialog
          approval={previewApproval}
          viewerId={viewerId}
          viewerRole={viewerRole}
          onClose={() => setPreviewApproval(null)}
        />
      )}
    </div>
  )
}
