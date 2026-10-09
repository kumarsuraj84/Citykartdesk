'use client'

import { AlertTriangle, Bell, BellRing, MessageSquare, ShieldCheck, UserCheck, X } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import type { PopupNotification } from '@/lib/notifications/popup-rules'

function iconFor(type: string) {
  switch (type) {
    case 'request_assigned': case 'request_reassigned': case 'task_assigned': case 'collaborator_added': return { Icon: UserCheck, tone: 'bg-primary/10 text-primary' }
    case 'comment_added': case 'internal_note_added': case 'mentioned': return { Icon: MessageSquare, tone: 'bg-primary/10 text-primary' }
    case 'approval_requested': return { Icon: ShieldCheck, tone: 'bg-warning/10 text-warning' }
    case 'approval_approved': case 'approval_decided': case 'request_resolved': return { Icon: ShieldCheck, tone: 'bg-success/10 text-success' }
    case 'approval_rejected': return { Icon: ShieldCheck, tone: 'bg-destructive/10 text-destructive' }
    case 'sla_breached': case 'csat_low_rating': case 'request_reopened': return { Icon: AlertTriangle, tone: 'bg-destructive/10 text-destructive' }
    case 'sla_warning': return { Icon: BellRing, tone: 'bg-destructive/10 text-destructive' }
    default: return { Icon: Bell, tone: 'bg-muted text-muted-foreground' }
  }
}

/** One pop-up card. Normal ones show a thin timer bar and go away by themselves; important ones have a red outline and stay. */
export function PopupCard({ n, important, durationMs, onOpen, onClose }: {
  n: PopupNotification
  important: boolean
  durationMs: number
  onOpen: () => void
  onClose: () => void
}) {
  const { Icon, tone } = iconFor(n.type)
  return (
    <div
      role="alert"
      onClick={onOpen}
      className={`relative w-[340px] cursor-pointer overflow-hidden rounded-xl border bg-card p-3 text-left shadow-lg transition-colors hover:border-foreground/30 ${important ? 'border-destructive/60' : 'border-border'}`}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-2.5 pr-5">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-snug text-foreground">{n.title}</p>
          {n.body && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{n.body}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            {formatRelativeTime(n.created_at)}{n.actor_name ? ` · ${n.actor_name}` : ''}{important ? ' · stays until dismissed' : ''}
          </p>
        </div>
      </div>
      {!important && (
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-[3px] bg-primary/60"
          style={{ animation: `ck-popup-shrink ${durationMs}ms linear forwards` }}
        />
      )}
    </div>
  )
}
