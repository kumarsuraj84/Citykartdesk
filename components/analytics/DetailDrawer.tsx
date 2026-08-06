'use client'

import { useEffect, useState, useTransition, useRef } from 'react'
import Link from 'next/link'
import { X, ExternalLink, Loader2, AlertCircle, Clock, CheckCircle2, Circle, Pause, XCircle } from 'lucide-react'
import { getFilteredRequests, type DrawerFilter, type DrawerRequest } from '@/lib/actions/analytics'

// ── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  open:             { label: 'Open',             icon: Circle,       color: 'text-blue-500' },
  in_progress:      { label: 'In Progress',      icon: Clock,        color: 'text-amber-500' },
  pending_approval: { label: 'Pending Approval', icon: Pause,        color: 'text-purple-500' },
  resolved:         { label: 'Resolved',         icon: CheckCircle2, color: 'text-green-600' },
  closed:           { label: 'Closed',           icon: CheckCircle2, color: 'text-green-700' },
  cancelled:        { label: 'Cancelled',        icon: XCircle,      color: 'text-muted-foreground' },
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high:   'bg-orange-400',
  medium: 'bg-amber-400',
  low:    'bg-slate-400',
}

function RelTime({ iso }: { iso: string }) {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  < 60)  return <>{mins}m ago</>
  if (hours < 24)  return <>{hours}h ago</>
  return <>{days}d ago</>
}

function SlaChip({ deadline, status }: { deadline: string | null; status: string }) {
  if (!deadline) return null
  if (['resolved', 'closed', 'cancelled'].includes(status)) return null
  const breached = new Date(deadline) < new Date()
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      breached
        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    }`}>
      {breached ? 'SLA !' : 'On-track'}
    </span>
  )
}

function RequestRow({ r }: { r: DrawerRequest }) {
  const cfg  = STATUS_CONFIG[r.status] ?? { label: r.status, icon: Circle, color: 'text-muted-foreground' }
  const Icon = cfg.icon
  return (
    <Link
      href={`/requests/${r.id}`}
      className="group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
    >
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-snug">
            {r.title}
          </p>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${PRIORITY_DOT[r.priority] ?? 'bg-slate-400'}`} />
          <span className="text-[11px] text-muted-foreground capitalize">{r.priority}</span>
          {r.team_name && (
            <><span className="text-muted-foreground/40">·</span><span className="text-[11px] text-muted-foreground">{r.team_name}</span></>
          )}
          {r.assignee_name && (
            <><span className="text-muted-foreground/40">·</span><span className="text-[11px] text-muted-foreground">{r.assignee_name}</span></>
          )}
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px] text-muted-foreground"><RelTime iso={r.created_at} /></span>
          <SlaChip deadline={r.resolution_due_at} status={r.status} />
        </div>
      </div>
    </Link>
  )
}

// ── Main drawer ──────────────────────────────────────────────────────────────

interface Props {
  filter: DrawerFilter | null
  onClose: () => void
}

export function DetailDrawer({ filter, onClose }: Props) {
  const [isPending, startTransition] = useTransition()
  const [data, setData]  = useState<DrawerRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prevFilterRef    = useRef<string>('')

  const open = !!filter

  useEffect(() => {
    if (!filter) { setData(null); setError(null); return }
    const key = JSON.stringify(filter)
    if (key === prevFilterRef.current) return
    prevFilterRef.current = key
    setData(null); setError(null)
    startTransition(async () => {
      const res = await getFilteredRequests(filter)
      if (res.error) setError(res.error)
      else setData(res.data)
    })
  }, [filter])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-[480px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">{filter?.title ?? ''}</h2>
            {filter?.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{filter.description}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted transition-colors ml-4 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isPending && (
            <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}
          {!isPending && error && (
            <div className="flex items-center gap-2 px-5 py-8 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {!isPending && data && data.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No matching requests</p>
            </div>
          )}
          {!isPending && data && data.length > 0 && (
            <>
              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                {data.length}{data.length === 50 ? '+' : ''} requests
              </p>
              {data.map((r) => <RequestRow key={r.id} r={r} />)}
            </>
          )}
        </div>

        {/* Footer */}
        {data && data.length > 0 && (
          <div className="border-t border-border px-5 py-3 shrink-0 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{data.length} results shown</span>
            <Link href="/requests" className="text-xs text-primary hover:underline">
              View all requests →
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
