'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Bell, Check, CheckCheck, Archive } from 'lucide-react'
import {
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
} from '@/lib/actions/notifications'
import { formatRelativeTime } from '@/lib/utils'
import type { NotificationWithActor } from '@/types'

// ── Type colours ─────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  request_assigned:    'bg-blue-100 text-blue-600',
  request_reassigned:  'bg-blue-100 text-blue-600',
  comment_added:       'bg-slate-100 text-slate-600',
  internal_note_added: 'bg-amber-100 text-amber-600',
  mentioned:           'bg-violet-100 text-violet-600',
  collaborator_added:  'bg-teal-100 text-teal-600',
  collaborator_removed:'bg-slate-100 text-slate-500',
  approval_requested:  'bg-violet-100 text-violet-600',
  approval_approved:   'bg-emerald-100 text-emerald-600',
  approval_rejected:   'bg-red-100 text-red-600',
  approval_decided:    'bg-emerald-100 text-emerald-600',
  request_resolved:    'bg-emerald-100 text-emerald-600',
  request_closed:      'bg-slate-100 text-slate-500',
  request_auto_closed: 'bg-slate-100 text-slate-500',
  request_cancelled:   'bg-red-100 text-red-500',
  priority_changed:    'bg-orange-100 text-orange-600',
  status_changed:      'bg-sky-100 text-sky-600',
  sla_warning:         'bg-amber-100 text-amber-600',
  sla_breached:        'bg-red-100 text-red-600',
}

type Filter = 'all' | 'unread' | 'archived'

// ── Notification row ──────────────────────────────────────────────────────────

function NotificationItem({
  notification,
  onRead,
  onArchive,
}: {
  notification: NotificationWithActor
  onRead: (id: string) => void
  onArchive: (id: string) => void
}) {
  const isUnread = !notification.read_at
  const initials = notification.actor?.full_name
    ? notification.actor.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'
  const colorClass = TYPE_COLORS[notification.type] ?? 'bg-slate-100 text-slate-600'

  const inner = (
    <div
      className={`group flex items-start gap-4 rounded-xl border bg-card px-5 py-4 transition-colors hover:border-border/60 hover:bg-muted/30 ${
        isUnread ? 'border-l-[3px] border-l-primary border-r-border border-t-border border-b-border' : 'border-border'
      }`}
    >
      {/* Avatar */}
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${colorClass}`}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm leading-snug ${isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
            {notification.title}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {isUnread && (
              <span className="h-2 w-2 rounded-full bg-primary" />
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeTime(notification.created_at)}
            </span>
          </div>
        </div>
        {notification.body && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {notification.body}
          </p>
        )}
      </div>

      {/* Actions — show on hover */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isUnread && (
          <button
            type="button"
            title="Mark as read"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRead(notification.id) }}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Archive"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArchive(notification.id) }}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )

  if (notification.link) {
    return (
      <Link href={notification.link} onClick={() => onRead(notification.id)} className="block">
        {inner}
      </Link>
    )
  }

  return <div>{inner}</div>
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: Filter }) {
  const copy = {
    all:      { heading: 'All caught up',              sub: 'No notifications yet.' },
    unread:   { heading: 'No unread notifications',    sub: "You're all caught up." },
    archived: { heading: 'Nothing archived',           sub: 'Archived notifications appear here.' },
  }[filter]

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-8 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <Bell className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-foreground">{copy.heading}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{copy.sub}</p>
      </div>
    </div>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export interface NotificationsClientProps {
  initialNotifications: NotificationWithActor[]
  initialUnreadCount: number
}

export function NotificationsClient({
  initialNotifications,
  initialUnreadCount,
}: NotificationsClientProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [isPending, startTransition] = useTransition()

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
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    )
    setUnreadCount(0)
    startTransition(async () => {
      const result = await markAllNotificationsRead()
      if (result?.error) { toast.error(result.error); setNotifications(prevNotifications); setUnreadCount(prevUnreadCount) }
    })
  }

  const visible = notifications.filter((n) => {
    if (filter === 'unread') return !n.read_at && !n.archived_at
    if (filter === 'archived') return !!n.archived_at
    return !n.archived_at
  })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stay updated on your requests and activity
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={isPending}
            className="btn-soft shadow-sm"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
        {(['all', 'unread', 'archived'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors capitalize ${
              filter === f
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f}
            {f === 'unread' && unreadCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2">
        {visible.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          visible.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onRead={handleRead}
              onArchive={handleArchive}
            />
          ))
        )}
      </div>
    </div>
  )
}
