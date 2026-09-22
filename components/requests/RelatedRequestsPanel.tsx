'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Link2, X, Plus, Search } from 'lucide-react'
import { addRelatedRequest, removeRelatedRequest } from '@/lib/actions/requests'

export type RelatedRequest = {
  id: string
  link_id: string
  link_type: string
  created_by: string
  request_no: string
  title: string
  status: string
  priority: string
}

interface RelatedRequestsPanelProps {
  requestId: string
  initialRelated: RelatedRequest[]
  canManage: boolean
}

const LINK_LABELS: Record<string, string> = {
  related:      'Related',
  duplicates:   'Duplicates',
  blocks:       'Blocks',
  is_blocked_by:'Blocked by',
  caused_by:    'Caused by',
}

export function RelatedRequestsPanel({ requestId, initialRelated, canManage }: RelatedRequestsPanelProps) {
  const [related, setRelated]       = useState(initialRelated)
  // Re-sync when someone else links/unlinks a related request and the page's own periodic
  // refresh (AppShell's AutoRefresh) hands this component a fresh list.
  const [prevInitial, setPrevInitial] = useState(initialRelated)
  if (prevInitial !== initialRelated) {
    setPrevInitial(initialRelated)
    setRelated(initialRelated)
  }
  const [adding, setAdding]         = useState(false)
  const [query, setQuery]           = useState('')
  const [linkType, setLinkType]     = useState('related')
  const [error, setError]           = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRemove(linkId: string) {
    startTransition(async () => {
      const res = await removeRelatedRequest(linkId)
      if (res?.error) { setError(res.error); return }
      setRelated((prev) => prev.filter((r) => r.link_id !== linkId))
    })
  }

  function handleAdd() {
    if (!query.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await addRelatedRequest(requestId, query.trim(), linkType)
      if (res?.error) { setError(res.error); return }
      if (res?.related) {
        setRelated((prev) => [...prev, res.related as RelatedRequest])
        setQuery('')
        setAdding(false)
      }
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          Related Requests
          {related.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {related.length}
            </span>
          )}
        </div>
        {canManage && !adding && (
          <button
            onClick={() => { setAdding(true); setError(null) }}
            className="btn-ghost"
          >
            <Plus className="h-3 w-3" /> Link
          </button>
        )}
      </div>

      <div className="divide-y divide-border">
        {related.length === 0 && !adding && (
          <p className="px-4 py-4 text-xs text-muted-foreground text-center">No linked requests</p>
        )}

        {related.map((r) => (
          <div key={r.link_id} className="flex items-center gap-2 px-4 py-2.5">
            <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground shrink-0">
              {LINK_LABELS[r.link_type] ?? r.link_type}
            </span>
            <Link
              href={`/requests/${r.id}`}
              className="min-w-0 flex-1 text-xs text-primary hover:underline truncate"
            >
              {r.request_no} — {r.title}
            </Link>
            {canManage && (
              <button
                onClick={() => handleRemove(r.link_id)}
                disabled={isPending}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {adding && (
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground shrink-0"
              >
                {Object.entries(LINK_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
                  placeholder="Request # or title…"
                  className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={isPending || !query.trim()}
                className="btn-gradient"
              >
                {isPending ? 'Linking…' : 'Link'}
              </button>
              <button
                onClick={() => { setAdding(false); setQuery(''); setError(null) }}
                className="btn-soft"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
