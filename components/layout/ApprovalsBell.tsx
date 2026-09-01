'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { ClipboardCheck, X, Loader2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { getApprovalForRequestAction } from '@/lib/actions/approvals'
import { ApprovalPreviewDialog } from '@/components/requests/ApprovalPreviewDialog'
import type { NotificationWithActor, UserRole } from '@/types'
import type { ApprovalWithDetails } from '@/lib/queries/approvals'

interface ApprovalsBellProps {
  initialNotifications: NotificationWithActor[]
  initialCount: number
  viewerId: string
  viewerRole: UserRole
  dark?: boolean
}

// A dedicated bell for "needs your approval" — kept separate from general
// notifications (comments, assignments, SLA warnings, …) so an actionable
// item never gets lost in an unrelated feed. Items here disappear on their
// own once acted on (approveApproval/rejectApproval archive them).
export function ApprovalsBell({
  initialNotifications,
  initialCount,
  viewerId,
  viewerRole,
  dark = false,
}: ApprovalsBellProps) {
  const [open, setOpen] = useState(false)
  const [notifications] = useState(initialNotifications)
  const [previewApproval, setPreviewApproval] = useState<ApprovalWithDetails | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handlePreview(n: NotificationWithActor) {
    if (!n.request_id) return
    setOpen(false)
    setPreviewLoading(true)
    const approval = await getApprovalForRequestAction(n.request_id)
    setPreviewLoading(false)
    if (!approval) { toast.error('This approval is no longer available.'); return }
    setPreviewApproval(approval)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${initialCount} pending approvals`}
        title="Approvals"
        className={dark
          ? "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 transition-colors"
          : "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        }
      >
        <ClipboardCheck className="h-[18px] w-[18px]" />
        {initialCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold leading-none text-white">
            {initialCount > 99 ? '99+' : initialCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Approvals</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <ClipboardCheck className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">Nothing awaiting your approval</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((n) => {
                const initials = n.actor?.full_name
                  ? n.actor.full_name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
                  : '?'
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handlePreview(n)}
                    className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/40 ${!n.read_at ? 'bg-primary/[0.03]' : ''}`}
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs leading-snug ${!n.read_at ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{n.body}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">{formatRelativeTime(n.created_at)}</p>
                    </div>
                  </button>
                )
              })
            )}
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
