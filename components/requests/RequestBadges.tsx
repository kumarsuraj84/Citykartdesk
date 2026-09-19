/**
 * Shared badge primitives for request status, priority, and SLA.
 * All badge styles source from lib/constants/requests — no duplicates.
 */
import { RotateCcw, Globe, MessageCircle, Inbox, Mail, Phone, UserRound, Webhook, type LucideIcon } from 'lucide-react'
import { ticketSourceKey, TICKET_SOURCE_LABELS, type TicketSourceKey } from '@/lib/sources'
import { STATUS_LABELS, STATUS_STYLES, PRIORITY_BADGE_STYLES, PRIORITY_LABELS, PRIORITY_ARROWS } from '@/lib/constants/requests'
import type { RequestStatus, RequestPriority } from '@/types'

// ── Status Badge ──────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: RequestStatus
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0'

  return (
    <span className={`${base} ${STATUS_STYLES[status]}`}>
      <span className="h-1.5 w-1.5 rounded bg-current opacity-70" />
      {STATUS_LABELS[status]}
    </span>
  )
}

// ── Priority Badge ────────────────────────────────────────────────────────────

interface PriorityBadgeProps {
  priority: RequestPriority
  size?: 'sm' | 'md'
}

export function PriorityBadge({ priority, size = 'md' }: PriorityBadgeProps) {
  const base =
    size === 'sm'
      ? 'chip-3d gap-1 text-[11px] font-medium'
      : 'chip-3d gap-1 text-xs font-medium'

  return (
    <span className={`${base} ${PRIORITY_BADGE_STYLES[priority] ?? 'bg-gray-100 text-gray-600'}`}>
      <span className="font-bold leading-none">{PRIORITY_ARROWS[priority] ?? '·'}</span>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  )
}

// ── Reopened Badge ────────────────────────────────────────────────────────────
// A distinct, unmissable color (violet, used nowhere else in the status/
// priority palette) so a technician immediately recognizes "this ticket has
// history" — was resolved-then-reopened, or rejected-then-reopened — before
// they even open it. `count` shows how many times if it's happened more than once.

interface ReopenedBadgeProps {
  count: number
  size?: 'sm' | 'md'
}

export function ReopenedBadge({ count, size = 'md' }: ReopenedBadgeProps) {
  if (count <= 0) return null
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0'
  return (
    <span
      className={`${base} border border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300`}
      title={`Reopened ${count} time${count > 1 ? 's' : ''} — check the conversation for why.`}
    >
      <RotateCcw className="h-3 w-3" />
      Reopened{count > 1 ? ` ×${count}` : ''}
    </span>
  )
}

// ── Source Badge ──────────────────────────────────────────────────────────────
// Where the ticket came from (Web, WhatsApp, Email, ...) so a technician knows
// how to reach the requester and what context to expect. Derived from
// source_metadata.created_via — see ticketSourceKey() in lib/sources.ts.

const SOURCE_ICONS: Record<TicketSourceKey, LucideIcon> = {
  portal: Globe,
  whatsapp: MessageCircle,
  intake: Inbox,
  email: Mail,
  phone: Phone,
  manual: UserRound,
  api: Webhook,
}

const SOURCE_STYLES: Record<TicketSourceKey, string> = {
  portal: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
  whatsapp: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  intake: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  email: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  phone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  manual: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  api: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
}

interface SourceBadgeProps {
  sourceMetadata: unknown
  size?: 'sm' | 'md'
}

export function SourceBadge({ sourceMetadata, size = 'md' }: SourceBadgeProps) {
  const key = ticketSourceKey(sourceMetadata)
  const Icon = SOURCE_ICONS[key]
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0'
  return (
    <span className={`${base} ${SOURCE_STYLES[key]}`} title={`Raised via ${TICKET_SOURCE_LABELS[key]}`}>
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {TICKET_SOURCE_LABELS[key]}
    </span>
  )
}
