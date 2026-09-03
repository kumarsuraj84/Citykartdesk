'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, Loader2, MessageSquare } from 'lucide-react'
import { ApprovalPanel } from './ApprovalPanel'
import { StatusBadge, PriorityBadge } from './RequestBadges'
import { getApprovalPreview, type ApprovalPreviewData } from '@/lib/actions/approvals'
import type { ApprovalWithDetails } from '@/lib/queries/approvals'
import type { UserRole } from '@/types'
import { formatRelativeTime } from '@/lib/utils'

interface Props {
  approval: ApprovalWithDetails
  viewerId: string
  viewerRole: UserRole
  onClose: () => void
}

// Lets an approver see the ticket details + conversation and act on it right
// where they are — the Approvals list or the notification bell — instead of
// navigating away to the full request page.
export function ApprovalPreviewDialog({ approval, viewerId, viewerRole, onClose }: Props) {
  const [data, setData] = useState<ApprovalPreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getApprovalPreview(approval.id).then((res) => {
      if (cancelled) return
      if (res.error) setError(res.error)
      else setData(res.data ?? null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [approval.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const req = approval.request

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10 sm:pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{req?.request_no}</span>
              {req && <StatusBadge status={req.status} size="sm" />}
              {req && <PriorityBadge priority={req.priority} size="sm" />}
            </div>
            <h2 className="mt-1 truncate text-base font-semibold text-foreground">{req?.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : data ? (
            <>
              {/* Details */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border bg-muted/20 p-4 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Requester</p>
                  <p className="text-foreground">{data.request.requester_name}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Service</p>
                  <p className="text-foreground">{data.request.service_name}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Category</p>
                  <p className="text-foreground">{data.request.category_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sub Category</p>
                  <p className="text-foreground">{data.request.sub_category_name ?? '—'}</p>
                </div>
              </div>

              {data.request.description && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                    {data.request.description}
                  </p>
                </div>
              )}

              {/* Conversation */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" /> Conversation
                </p>
                {data.comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No messages yet.</p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {[...data.comments].reverse().map((c) => (
                      <div key={c.id} className="rounded-lg border border-border/60 bg-background px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-foreground">{c.author_name}</span>
                          <span className="text-[10px] text-muted-foreground" suppressHydrationWarning>{formatRelativeTime(c.created_at)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/90">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Link
                href={`/requests/${data.request.id}`}
                className="inline-block text-xs font-medium text-primary hover:underline"
              >
                Open full request →
              </Link>
            </>
          ) : null}

          {/* Approval action panel — same component/logic used on the full
              request page, so parallel/sequential approve/reject stays correct. */}
          <div className="border-t border-border pt-4">
            <ApprovalPanel approval={approval} viewerId={viewerId} viewerRole={viewerRole} />
          </div>
        </div>
      </div>
    </div>
  )
}
