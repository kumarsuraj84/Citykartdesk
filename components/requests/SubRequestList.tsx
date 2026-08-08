'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { GitBranch, Plus, User } from 'lucide-react'
import { createSubRequest } from '@/lib/actions/requests'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import type { RequestPriority, RequestStatus } from '@/types'

export type SubRequest = {
  id: string
  request_no: string
  title: string
  status: RequestStatus
  priority: RequestPriority
  assignee: { id: string; full_name: string } | null
}

const PRIORITY_OPTIONS: RequestPriority[] = ['low', 'medium', 'high', 'urgent']

interface SubRequestListProps {
  parentRequestId: string
  initialSubRequests: SubRequest[]
  canManage: boolean
  teamMembers: { id: string; full_name: string }[]
}

export function SubRequestList({ parentRequestId, initialSubRequests, canManage, teamMembers }: SubRequestListProps) {
  const [subRequests, setSubRequests] = useState(initialSubRequests)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<RequestPriority>('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd() {
    if (!title.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await createSubRequest(parentRequestId, title.trim(), {
        priority,
        assignedTo: assignedTo || undefined,
      })
      if (res.error) { setError(res.error); return }
      if (res.id) {
        const assignee = teamMembers.find((m) => m.id === assignedTo) ?? null
        setSubRequests((prev) => [
          ...prev,
          { id: res.id!, request_no: '…', title: title.trim(), status: 'open', priority, assignee },
        ])
        setTitle('')
        setPriority('medium')
        setAssignedTo('')
        setAdding(false)
      }
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          Sub-Requests
          {subRequests.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {subRequests.length}
            </span>
          )}
        </div>
        {canManage && !adding && (
          <button onClick={() => { setAdding(true); setError(null) }} className="btn-ghost">
            <Plus className="h-3 w-3" /> Add
          </button>
        )}
      </div>

      <div className="divide-y divide-border">
        {subRequests.length === 0 && !adding && (
          <p className="px-4 py-4 text-xs text-muted-foreground text-center">No sub-requests</p>
        )}

        {subRequests.map((sr) => (
          <Link
            key={sr.id}
            href={`/requests/${sr.id}`}
            className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors"
          >
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">{sr.request_no}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{sr.title}</span>
            <StatusBadge status={sr.status} size="sm" />
            <PriorityBadge priority={sr.priority} size="sm" />
            {sr.assignee ? (
              <span className="shrink-0 text-[10px] text-muted-foreground">{sr.assignee.full_name.split(' ')[0]}</span>
            ) : (
              <User className="h-3 w-3 text-amber-500 shrink-0" />
            )}
          </Link>
        ))}

        {adding && (
          <div className="px-4 py-3 space-y-2">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="Sub-request title…"
              className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center gap-2">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as RequestPriority)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleAdd} disabled={isPending || !title.trim()} className="btn-gradient">
                {isPending ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => { setAdding(false); setTitle(''); setError(null) }} className="btn-soft">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
