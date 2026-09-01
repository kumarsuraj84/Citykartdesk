'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, UserPlus, X, ChevronDown, History } from 'lucide-react'
import {
  updateRequestStatus,
  assignRequest,
  changePriority,
  addCollaborator,
  removeCollaborator,
  searchOrgMembers,
  searchAgentTierMembers,
  reclassifyRequest,
  updateRequestCategory,
} from '@/lib/actions/requests'
import { StatusBadge, PriorityBadge } from './RequestBadges'
import { SLABadge } from './SLABadge'
import { SubmittedFieldRow } from './SubmittedFieldRow'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import { formatRelativeTime } from '@/lib/utils'
import type { RequestStatus, RequestPriority, RequestCollaborator, FormField, FormSection, AllowedSubCategory } from '@/types'

interface TeamMember { id: string; full_name: string }

interface RequestSidebarPanelProps {
  requestId: string
  requestNo: string
  status: RequestStatus
  priority: RequestPriority
  assigneeId: string | null
  assigneeName: string | null
  teamName: string
  serviceId: string
  serviceName: string
  categoryName: string | null
  subCategoryId: string | null
  subCategoryName: string | null
  reclassifyOptions: { id: string; name: string }[]
  allowedSubCategories: AllowedSubCategory[]
  requesterId: string
  requesterName: string
  resolutionDueAt: string | null
  responseDueAt: string | null
  createdAt: string
  updatedAt: string
  teamId: string
  viewerId: string
  isAgent: boolean
  isManager: boolean
  isRequester: boolean
  isTerminal: boolean
  teamMembers: TeamMember[]
  initialCollaborators: RequestCollaborator[]
  formSections: FormSection[]
  formSchema: FormField[]
  formData: Record<string, unknown>
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
  const [reopenRemark, setReopenRemark] = useState<string | null>(null)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Re-sync if the server-provided status changes underneath us — e.g. the
  // approval-rejection reopen banner (a sibling component entirely outside
  // this one) calls router.refresh() after reopening, which re-renders this
  // component with a fresh `status` prop but would otherwise leave `cur`
  // frozen at its very first value forever (useState's initializer only
  // runs once). Same pattern as CategoryRow below.
  const [prevStatus, setPrevStatus] = useState(status)
  if (status !== prevStatus) {
    setPrevStatus(status)
    setCur(status)
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function apply(next: RequestStatus, comment?: string) {
    const prev = cur
    setCur(next); setOpen(false); setReopenRemark(null); setReopenError(null)
    startTransition(async () => {
      const result = await updateRequestStatus(requestId, next, comment)
      if (result?.error) { toast.error(result.error); setCur(prev) }
    })
  }

  function pick(next: RequestStatus) {
    // A pure requester reopening a resolved ticket ("I'm not satisfied")
    // must explain why — the remark is required server-side too, but
    // collecting it here avoids a round-trip just to find that out.
    if (!isAgent && isRequester && cur === 'resolved' && next === 'open') {
      setReopenRemark('')
      return
    }
    apply(next)
  }

  function confirmReopen() {
    if (!reopenRemark?.trim()) { setReopenError('Please explain why you are reopening this request.'); return }
    apply('open', reopenRemark)
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
        {reopenRemark !== null && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 space-y-2 rounded-xl border border-border bg-card p-3 shadow-xl">
            <p className="text-[11px] font-medium text-foreground">Why are you reopening this?</p>
            <textarea
              autoFocus
              value={reopenRemark}
              onChange={(e) => { setReopenRemark(e.target.value); setReopenError(null) }}
              placeholder="Explain what's still wrong…"
              rows={3}
              className="w-full resize-none rounded-lg border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {reopenError && <p className="text-[11px] text-destructive">{reopenError}</p>}
            <div className="flex gap-2">
              <button onClick={confirmReopen} disabled={isPending} className="btn-gradient flex-1 !py-1 !text-xs">
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reopen'}
              </button>
              <button onClick={() => { setReopenRemark(null); setReopenError(null) }} className="btn-soft !py-1 !text-xs">
                Cancel
              </button>
            </div>
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
    const prev = cur
    setCur(p); setOpen(false)
    startTransition(async () => {
      const result = await changePriority(requestId, p)
      if (result?.error) { toast.error(result.error); setCur(prev) }
    })
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
// Assignee row — team members are listed directly (no typing needed for the
// common case), plus a search box to forward the ticket to ANY active org
// member, not just this team — assignRequest itself doesn't restrict the
// target to the request's team, so the picker shouldn't either.
function AssigneeRow({ requestId, assigneeId, assigneeName, viewerId, teamMembers, isAgent }: {
  requestId: string; assigneeId: string | null; assigneeName: string | null
  viewerId: string; teamMembers: TeamMember[]; isAgent: boolean
}) {
  const [open, setOpen] = useState(false)
  const [curId, setCurId] = useState(assigneeId)
  const [curName, setCurName] = useState(assigneeName)
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

  useEffect(() => {
    const q = query.trim()
    let cancelled = false
    const t = setTimeout(async () => {
      if (!q) { setResults([]); setSearching(false); return }
      setSearching(true)
      const found = await searchAgentTierMembers(q)
      if (!cancelled) { setResults(found); setSearching(false) }
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const teamMemberIds = new Set(teamMembers.map(m => m.id))
  const searchCandidates = results.filter(m => m.id !== curId && !teamMemberIds.has(m.id))

  function pick(id: string | null, name: string | null) {
    const prevId = curId, prevName = curName
    setCurId(id); setCurName(name); setOpen(false); setQuery('')
    startTransition(async () => {
      const result = await assignRequest(requestId, id)
      if (result?.error) { toast.error(result.error); setCurId(prevId); setCurName(prevName) }
    })
  }

  return (
    <PropRow label="Technician">
      <div ref={ref} className="relative">
        <button
          onClick={() => isAgent && setOpen(v => !v)}
          className={`flex items-center gap-1.5 ${isAgent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          {curName ? (
            <><Avatar name={curName} /><span className="text-xs font-medium text-foreground">{curName}</span></>
          ) : (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          )}
          {isAgent && !isPending && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-card shadow-xl">
            <div className="border-b border-border px-2 py-1.5">
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Forward to anyone…"
                className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none" />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
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
              {!query.trim() ? (
                <>
                  <div className="my-1 border-t border-border/50" />
                  {teamMembers.map(m => (
                    <button key={m.id} onClick={() => pick(m.id, m.full_name)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors ${m.id === curId ? 'bg-muted/60' : ''}`}>
                      <Avatar name={m.full_name} />
                      <span className="font-medium">{m.full_name}</span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <div className="my-1 border-t border-border/50" />
                  {searching ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                  ) : searchCandidates.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
                  ) : searchCandidates.map(m => (
                    <button key={m.id} onClick={() => pick(m.id, m.full_name)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                      <Avatar name={m.full_name} />
                      <span className="font-medium">{m.full_name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </PropRow>
  )
}

// Inline service corrector — the rare "this was raised against the wrong
// broad service entirely" case. Flat org-wide list (services no longer nest
// under a category, so there's nothing to cascade through); picking a
// different service clears the request's category/sub-category server-side
// since the old tags may not apply to the new service — the requester/agent
// re-picks via CategoryRow below.
function ServiceRow({ requestId, serviceId, serviceName, isAgent, options }: {
  requestId: string; serviceId: string; serviceName: string; isAgent: boolean
  options: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState({ id: serviceId, name: serviceName })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function pick(o: { id: string; name: string }) {
    if (o.id === cur.id) { setOpen(false); return }
    const prev = cur
    setCur(o); setOpen(false); setError(null)
    startTransition(async () => {
      const result = await reclassifyRequest(requestId, o.id)
      if (result?.error) { setError(result.error); setCur(prev) }
    })
  }

  return (
    <PropRow label="Service">
      <div ref={ref} className="relative">
        <button
          onClick={() => isAgent && setOpen((v) => !v)}
          className={`flex items-center gap-1 ${isAgent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
          title={error ?? undefined}
        >
          <span className={`text-xs ${error ? 'text-destructive' : 'text-foreground'}`}>{cur.name}</span>
          {isAgent && !isPending && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-60 max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl">
            <p className="px-1.5 pb-1 text-[10px] text-muted-foreground">Moving to a different service clears Category/Sub Category — you&apos;ll need to re-pick them.</p>
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => pick(o)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted transition-colors ${o.id === cur.id ? 'bg-muted/60 font-medium' : ''}`}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </PropRow>
  )
}

// Inline category corrector — the common "wrong classification, same
// service" case. Picking a sub-category (category is derived from it)
// re-runs SLA using that sub-category's own sla_config via
// updateRequestCategory, distinct from ServiceRow's rarer cross-service move.
function CategoryRow({ requestId, categoryName, subCategoryId, subCategoryName, isAgent, allowedSubCategories }: {
  requestId: string; categoryName: string | null; subCategoryId: string | null; subCategoryName: string | null
  isAgent: boolean; allowedSubCategories: AllowedSubCategory[]
}) {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState({ id: subCategoryId, name: subCategoryName, categoryName })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Re-sync if the server-provided classification changes underneath us —
  // e.g. ServiceRow's reclassify clears it, which lands here as fresh props
  // once the server action's revalidation completes. Adjusted during render
  // (React's documented pattern for this), not in an effect, so it can't
  // trigger a cascading extra render.
  const [prevSubCategoryId, setPrevSubCategoryId] = useState(subCategoryId)
  if (subCategoryId !== prevSubCategoryId) {
    setPrevSubCategoryId(subCategoryId)
    setCur({ id: subCategoryId, name: subCategoryName, categoryName })
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const canEdit = isAgent && allowedSubCategories.length > 0

  function pick(sc: AllowedSubCategory) {
    if (sc.id === cur.id) { setOpen(false); return }
    const prev = cur
    setCur({ id: sc.id, name: sc.name, categoryName: sc.category_name }); setOpen(false); setError(null)
    startTransition(async () => {
      const result = await updateRequestCategory(requestId, sc.id)
      if (result?.error) { setError(result.error); setCur(prev) }
    })
  }

  return (
    <>
      <PropRow label="Category">
        <div ref={ref} className="relative">
          <button
            onClick={() => canEdit && setOpen((v) => !v)}
            className={`flex items-center gap-1 ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            title={error ?? undefined}
          >
            <span className={`text-xs ${error ? 'text-destructive' : 'text-foreground'}`}>{cur.categoryName ?? '—'}</span>
            {canEdit && !isPending && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-1 w-60 max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl">
              {allowedSubCategories.map((sc) => (
                <button
                  key={sc.id}
                  onClick={() => pick(sc)}
                  className={`flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-muted transition-colors ${sc.id === cur.id ? 'bg-muted/60' : ''}`}
                >
                  <span className="text-xs text-foreground">{sc.name}</span>
                  <span className="text-[10px] text-muted-foreground">{sc.category_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PropRow>
      {cur.name && (
        <PropRow label="Sub Category">
          <span className="text-xs text-foreground">{cur.name}</span>
        </PropRow>
      )}
    </>
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
      // Use the real DB row id from the action's response, not a fabricated one —
      // removeCollaborator matches on this id, so a fake id silently fails to
      // remove any collaborator added earlier in the same page session.
      if (!result.error && result.id) {
        setCollaborators(prev => [...prev, {
          id: result.id!, user_id: member.id, added_by: viewerId,
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
          // Opens upward (bottom-full), not downward — Collaborators is the last row in
          // RequestSidebarPanel's `overflow-hidden` property list, so a downward dropdown
          // gets clipped by that ancestor instead of floating over the next card.
          <div className="absolute right-0 bottom-full z-50 mb-1 w-48 rounded-xl border border-border bg-card shadow-xl">
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
  assigneeId, assigneeName, teamName, serviceId, serviceName,
  categoryName, subCategoryId, subCategoryName, reclassifyOptions, allowedSubCategories,
  requesterId, requesterName,
  resolutionDueAt, responseDueAt, createdAt,
  viewerId, isAgent, isManager, isRequester, isTerminal,
  teamMembers, initialCollaborators,
  formSections, formSchema, formData,
}: RequestSidebarPanelProps) {
  const isOverdue = resolutionDueAt ? new Date(resolutionDueAt) < new Date() : false

  // Every submitted intake-form field (Reason for request, Mobile Number, …),
  // not just Category/Sub Category — shown right here so agents don't have to
  // switch to the Details tab to see what was actually submitted. File-type
  // fields are skipped (those are attachments, not form_data values); editing
  // still happens from the Details tab's "Submitted Information" panel.
  const submittedFields: FormField[] = (
    formSections.length > 0
      ? [...formSections].sort((a, b) => a.order - b.order).flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))
      : [...formSchema].sort((a, b) => a.order - b.order)
  ).filter((f) => f.type !== 'file')

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

        {/* Editable (manager+ only): Service — corrects a wrongly-submitted
            Category/Sub Category/Item. A technician (plain agent) can only
            reclassify within the current service via Category below, never
            move the ticket to a different service entirely. */}
        {isManager ? (
          <ServiceRow requestId={requestId} serviceId={serviceId} serviceName={serviceName} isAgent={isManager} options={reclassifyOptions} />
        ) : (
          <PropRow label="Service">
            <span className="text-xs text-foreground">{serviceName}</span>
          </PropRow>
        )}

        {/* Category / Sub Category — editable in place for agents/technicians
            (change classification within the same service, re-running
            Business Rules for reassignment); read-only otherwise. */}
        <CategoryRow
          requestId={requestId}
          categoryName={categoryName}
          subCategoryId={subCategoryId}
          subCategoryName={subCategoryName}
          isAgent={isAgent}
          allowedSubCategories={allowedSubCategories}
        />

        {/* Every submitted intake-form field, editable in place for agents —
            same click-to-edit popover pattern as the Service row above. */}
        {submittedFields.map((field) => (
          <SubmittedFieldRow
            key={field.id}
            requestId={requestId}
            field={field}
            value={formData[field.id]}
            canEdit={isAgent}
          />
        ))}

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
