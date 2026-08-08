'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Loader2, UserPlus, X, ChevronDown, History } from 'lucide-react'
import {
  updateRequestStatus,
  assignRequest,
  changePriority,
  addCollaborator,
  removeCollaborator,
  searchOrgMembers,
} from '@/lib/actions/requests'
import { StatusBadge, PriorityBadge } from './RequestBadges'
import { SLABadge } from './SLABadge'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import { formatRelativeTime } from '@/lib/utils'
import type { RequestStatus, RequestPriority, RequestCollaborator } from '@/types'

interface TeamMember { id: string; full_name: string }

interface RequestSidebarPanelProps {
  requestId: string
  requestNo: string
  status: RequestStatus
  priority: RequestPriority
  assigneeId: string | null
  assigneeName: string | null
  teamName: string
  serviceName: string
  requesterId: string
  requesterName: string
  resolutionDueAt: string | null
  responseDueAt: string | null
  createdAt: string
  updatedAt: string
  teamId: string
  viewerId: string
  isAgent: boolean
  isRequester: boolean
  isTerminal: boolean
  teamMembers: TeamMember[]
  initialCollaborators: RequestCollaborator[]
}

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const s = size === 'md' ? 'h-7 w-7 text-xs' : 'h-5 w-5 text-[10px]'
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary ${s}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

// A single property row: label on left, interactive value on right
function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="shrink-0 text-[11px] text-muted-foreground w-20">{label}</span>
      <div className="min-w-0 flex items-center justify-end">{children}</div>
    </div>
  )
}

// Inline status selector
function StatusRow({ requestId, status, isAgent, isRequester }: {
  requestId: string; status: RequestStatus; isAgent: boolean; isRequester: boolean
}) {
  const agentOpts = isAgent ? (AGENT_TRANSITIONS[status] ?? []) : []
  const reqOpts = isRequester ? (REQUESTER_TRANSITIONS[status] ?? []).filter(s => !agentOpts.includes(s)) : []
  const allOpts = [...agentOpts, ...reqOpts]
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(status)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function pick(next: RequestStatus) {
    setCur(next); setOpen(false)
    startTransition(async () => { await updateRequestStatus(requestId, next) })
  }

  return (
    <PropRow label="Status">
      <div ref={ref} className="relative">
        <button
          onClick={() => allOpts.length > 0 && setOpen(v => !v)}
          className={`flex items-center gap-1 ${allOpts.length > 0 ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          <StatusBadge status={cur} size="sm" />
          {allOpts.length > 0 && !isPending && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-xl border border-border bg-card shadow-xl py-1">
            {allOpts.map(s => (
              <button key={s} onClick={() => pick(s)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left">
                <StatusBadge status={s} size="sm" />
              </button>
            ))}
          </div>
        )}
      </div>
    </PropRow>
  )
}

// Inline priority selector
function PriorityRow({ requestId, priority, isAgent }: {
  requestId: string; priority: RequestPriority; isAgent: boolean
}) {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(priority)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)
  const opts: RequestPriority[] = ['urgent', 'high', 'medium', 'low']

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function pick(p: RequestPriority) {
    setCur(p); setOpen(false)
    startTransition(async () => { await changePriority(requestId, p) })
  }

  return (
    <PropRow label="Priority">
      <div ref={ref} className="relative">
        <button
          onClick={() => isAgent && setOpen(v => !v)}
          className={`flex items-center gap-1 ${isAgent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          <PriorityBadge priority={cur} size="sm" />
          {isAgent && !isPending && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-xl border border-border bg-card shadow-xl py-1">
            {opts.map(p => (
              <button key={p} onClick={() => pick(p)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors ${p === cur ? 'bg-muted/60' : ''}`}>
                <PriorityBadge priority={p} size="sm" />
              </button>
            ))}
          </div>
        )}
      </div>
    </PropRow>
  )
}

// Inline assignee selector
function AssigneeRow({ requestId, assigneeId, assigneeName, viewerId, teamMembers, isAgent }: {
  requestId: string; assigneeId: string | null; assigneeName: string | null
  viewerId: string; teamMembers: TeamMember[]; isAgent: boolean
}) {
  const [open, setOpen] = useState(false)
  const [curId, setCurId] = useState(assigneeId)
  const [curName, setCurName] = useState(assigneeName)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function pick(id: string | null, name: string | null) {
    setCurId(id); setCurName(name); setOpen(false)
    startTransition(async () => { await assignRequest(requestId, id) })
  }

  return (
    <PropRow label="Assignee">
      <div ref={ref} className="relative">
        <button
          onClick={() => isAgent && teamMembers.length > 0 && setOpen(v => !v)}
          className={`flex items-center gap-1.5 ${isAgent && teamMembers.length > 0 ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          {curName ? (
            <><Avatar name={curName} /><span className="text-xs font-medium text-foreground">{curName}</span></>
          ) : (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          )}
          {isAgent && teamMembers.length > 0 && !isPending && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-card shadow-xl py-1">
            {curId && (
              <button onClick={() => pick(null, null)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-3 w-3" />Unassign
              </button>
            )}
            {viewerId !== curId && (
              <button onClick={() => { const me = teamMembers.find(m => m.id === viewerId); pick(viewerId, me?.full_name ?? null) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted transition-colors">
                Assign to me
              </button>
            )}
            <div className="my-1 border-t border-border/50" />
            {teamMembers.map(m => (
              <button key={m.id} onClick={() => pick(m.id, m.full_name)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors ${m.id === curId ? 'bg-muted/60' : ''}`}>
                <Avatar name={m.full_name} />
                <span className="font-medium">{m.full_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </PropRow>
  )
}

// Collaborators row — agents can add ANY active user in the org (typeahead search),
// not just team members. Existing add/remove behaviour is unchanged.
function CollaboratorsRow({ requestId, assigneeId, viewerId, initialCollaborators }: {
  requestId: string; assigneeId: string | null; viewerId: string
  initialCollaborators: RequestCollaborator[]
}) {
  const [collaborators, setCollaborators] = useState(initialCollaborators)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; full_name: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  // Debounced org-wide search. All state updates happen inside the async timeout
  // callback (never synchronously in the effect body) to avoid cascading renders.
  useEffect(() => {
    const q = query.trim()
    let cancelled = false
    const t = setTimeout(async () => {
      if (!q) { setResults([]); setSearching(false); return }
      setSearching(true)
      const found = await searchOrgMembers(q)
      if (!cancelled) { setResults(found); setSearching(false) }
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const collabIds = new Set(collaborators.map(c => c.user_id))
  // Exclude the primary assignee and anyone already a collaborator
  const candidates = results.filter(m => m.id !== assigneeId && !collabIds.has(m.id))

  function handleAdd(member: { id: string; full_name: string }) {
    startTransition(async () => {
      const result = await addCollaborator(requestId, member.id)
      if (!result.error) {
        setCollaborators(prev => [...prev, {
          id: `opt-${member.id}`, user_id: member.id, added_by: viewerId,
          added_at: new Date().toISOString(),
          profile: { id: member.id, full_name: member.full_name },
        }])
      }
      setOpen(false); setQuery('')
    })
  }

  function handleRemove(c: RequestCollaborator) {
    startTransition(async () => {
      const result = await removeCollaborator(requestId, c.id)
      if (!result.error) setCollaborators(prev => prev.filter(x => x.id !== c.id))
    })
  }

  return (
    <PropRow label="Collaborators">
      <div ref={ref} className="relative flex items-center gap-1 flex-wrap justify-end">
        {collaborators.map(c => (
          <button key={c.id} onClick={() => handleRemove(c)} disabled={isPending} title={`Remove ${c.profile.full_name}`}
            className="group relative flex items-center disabled:opacity-50">
            <Avatar name={c.profile.full_name} />
            <span className="absolute -top-1 -right-1 hidden group-hover:flex h-3 w-3 items-center justify-center rounded-full bg-destructive text-white">
              <X className="h-2 w-2" />
            </span>
          </button>
        ))}
        <button onClick={() => setOpen(v => !v)}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors">
          <UserPlus className="h-2.5 w-2.5" />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-card shadow-xl">
            <div className="border-b border-border px-2 py-1.5">
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search people…"
                className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none" />
            </div>
            <div className="max-h-40 overflow-y-auto py-1">
              {!query.trim() ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Type a name to search</p>
              ) : searching ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
              ) : candidates.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
              ) : candidates.map(m => (
                <button key={m.id} onClick={() => handleAdd(m)} disabled={isPending}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-50">
                  <Avatar name={m.full_name} />{m.full_name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </PropRow>
  )
}

export function RequestSidebarPanel({
  requestId, requestNo, status, priority,
  assigneeId, assigneeName, teamName, serviceName,
  requesterId, requesterName,
  resolutionDueAt, responseDueAt, createdAt,
  viewerId, isAgent, isRequester, isTerminal,
  teamMembers, initialCollaborators,
}: RequestSidebarPanelProps) {
  const isOverdue = resolutionDueAt ? new Date(resolutionDueAt) < new Date() : false

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2.5">
        <span className="font-mono text-xs font-bold text-foreground">{requestNo}</span>
        {(resolutionDueAt || responseDueAt) && (
          <SLABadge resolutionDueAt={resolutionDueAt} responseDueAt={responseDueAt} status={status} showLabel />
        )}
      </div>

      {/* All properties in one compact list */}
      <div className="px-4 py-1">
        {/* Editable: Status */}
        <StatusRow requestId={requestId} status={status} isAgent={isAgent} isRequester={isRequester} />

        {/* Editable: Priority */}
        <PriorityRow requestId={requestId} priority={priority} isAgent={isAgent} />

        {/* Editable: Assignee */}
        {isAgent && (
          <AssigneeRow
            requestId={requestId}
            assigneeId={assigneeId}
            assigneeName={assigneeName}
            viewerId={viewerId}
            teamMembers={teamMembers}
            isAgent={!isTerminal}
          />
        )}

        {/* Read-only: Requester */}
        <PropRow label="Requester">
          <div className="flex items-center gap-1.5">
            <Avatar name={requesterName} />
            <span className="text-xs font-medium text-foreground">{requesterName}</span>
          </div>
        </PropRow>

        {/* Read-only: Team */}
        <PropRow label="Team">
          <span className="text-xs text-foreground">{teamName}</span>
        </PropRow>

        {/* Read-only: Service */}
        <PropRow label="Service">
          <span className="text-xs text-foreground">{serviceName}</span>
        </PropRow>

        {/* Read-only: Created */}
        <PropRow label="Created">
          <span className="text-xs text-muted-foreground">{formatRelativeTime(createdAt)}</span>
        </PropRow>

        {/* Read-only: Due */}
        {resolutionDueAt && (
          <PropRow label="Due">
            <span className={`text-xs font-semibold ${isOverdue ? 'text-red-600' : 'text-foreground'}`}>
              {new Date(resolutionDueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </PropRow>
        )}

        {/* Collaborators */}
        {isAgent && (
          <CollaboratorsRow
            requestId={requestId}
            assigneeId={assigneeId}
            viewerId={viewerId}
            initialCollaborators={initialCollaborators}
          />
        )}
      </div>

      {/* Requester history link */}
      {isAgent && (
        <div className="border-t border-border px-4 py-2.5">
          <Link
            href={`/requests?requester_id=${requesterId}`}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/20 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <History className="h-3 w-3" />
            View previous requests
          </Link>
        </div>
      )}
    </div>
  )
}
