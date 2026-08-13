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
} from '@/lib/actions/requests'
import { StatusBadge, PriorityBadge } from './RequestBadges'
import { SLABadge } from './SLABadge'
import { SubmittedFieldRow } from './SubmittedFieldRow'
import { AGENT_TRANSITIONS, REQUESTER_TRANSITIONS } from '@/lib/constants/request-transitions'
import { formatRelativeTime } from '@/lib/utils'
import type { RequestStatus, RequestPriority, RequestCollaborator, FormField, FormSection } from '@/types'
import type { ReclassifyServiceOption } from '@/lib/queries/services'

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
  subCategoryName: string | null
  reclassifyOptions: ReclassifyServiceOption[]
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function pick(next: RequestStatus) {
    const prev = cur
    setCur(next); setOpen(false)
    startTransition(async () => {
      const result = await updateRequestStatus(requestId, next)
      if (result?.error) { toast.error(result.error); setCur(prev) }
    })
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
    <PropRow label="Assignee">
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

// Inline service (category / sub category / service) corrector — lets an agent
// fully re-route a wrongly-submitted ticket to any active service anywhere in
// the catalog (any category, any team), via three cascading dropdowns rather
// than one combined picker — picking a Category narrows Sub Category, picking
// a Sub Category narrows Service, and choosing a Service commits immediately
// (reclassifyRequest already supports moving across teams/categories freely).
function ServiceRow({ requestId, serviceId, serviceName, isAgent, options }: {
  requestId: string; serviceId: string; serviceName: string; isAgent: boolean
  options: ReclassifyServiceOption[]
}) {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState({ id: serviceId, name: serviceName })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const currentOption = options.find((o) => o.id === cur.id) ?? null
  const [draftCategoryId, setDraftCategoryId] = useState<string | null>(currentOption?.category_id ?? null)
  const [draftSubCategoryId, setDraftSubCategoryId] = useState<string | null>(currentOption?.sub_category_id ?? null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function openPicker() {
    // Re-seed the draft selection from whatever is current every time the
    // picker opens, so a prior aborted attempt doesn't linger.
    setDraftCategoryId(currentOption?.category_id ?? null)
    setDraftSubCategoryId(currentOption?.sub_category_id ?? null)
    setOpen(true)
  }

  const categories = Array.from(
    new Map(options.filter((o) => o.category_id).map((o) => [o.category_id!, o.category_name])).entries()
  ).map(([id, name]) => ({ id, name }))

  const subCategoriesInCategory = draftCategoryId
    ? Array.from(
        new Map(
          options
            .filter((o) => o.category_id === draftCategoryId && o.sub_category_id)
            .map((o) => [o.sub_category_id!, o.sub_category_name!])
        ).entries()
      ).map(([id, name]) => ({ id, name }))
    : []

  const servicesInScope = draftCategoryId
    ? options.filter((o) =>
        o.category_id === draftCategoryId &&
        (draftSubCategoryId ? o.sub_category_id === draftSubCategoryId : true)
      )
    : []

  function pick(o: ReclassifyServiceOption) {
    const prev = cur
    setCur({ id: o.id, name: o.name }); setOpen(false); setError(null)
    startTransition(async () => {
      const result = await reclassifyRequest(requestId, o.id)
      if (result?.error) { setError(result.error); setCur(prev) }
    })
  }

  return (
      <PropRow label="Service">
        <div ref={ref} className="relative">
          <button
            onClick={() => isAgent && (open ? setOpen(false) : openPicker())}
            className={`flex items-center gap-1 ${isAgent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            title={error ?? undefined}
          >
            <span className={`text-xs ${error ? 'text-destructive' : 'text-foreground'}`}>{cur.name}</span>
            {isAgent && !isPending && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-1 w-72 space-y-2 rounded-xl border border-border bg-card p-2.5 shadow-xl">
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Category</label>
                <select
                  value={draftCategoryId ?? ''}
                  onChange={(e) => { setDraftCategoryId(e.target.value || null); setDraftSubCategoryId(null) }}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select category…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sub Category</label>
                <select
                  value={draftSubCategoryId ?? ''}
                  onChange={(e) => setDraftSubCategoryId(e.target.value || null)}
                  disabled={!draftCategoryId || subCategoriesInCategory.length === 0}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">{subCategoriesInCategory.length === 0 ? 'None for this category' : 'All sub categories'}</option>
                  {subCategoriesInCategory.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Service</label>
                <select
                  value={servicesInScope.some((o) => o.id === cur.id) ? cur.id : ''}
                  onChange={(e) => { const o = options.find((x) => x.id === e.target.value); if (o) pick(o) }}
                  disabled={!draftCategoryId}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">{draftCategoryId ? 'Select service…' : 'Pick a category first'}</option>
                  {servicesInScope.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
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
  categoryName, subCategoryName, reclassifyOptions,
  requesterId, requesterName,
  resolutionDueAt, responseDueAt, createdAt,
  viewerId, isAgent, isRequester, isTerminal,
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

        {/* Editable (agent-only): Service — corrects a wrongly-submitted
            Category/Sub Category/Item. Non-agents just see it read-only. */}
        {isAgent ? (
          <ServiceRow requestId={requestId} serviceId={serviceId} serviceName={serviceName} isAgent={isAgent} options={reclassifyOptions} />
        ) : (
          <PropRow label="Service">
            <span className="text-xs text-foreground">{serviceName}</span>
          </PropRow>
        )}

        {/* Read-only: Category / Sub Category — visible to agent and requester alike. */}
        <PropRow label="Category">
          <span className="text-xs text-foreground">{categoryName ?? '—'}</span>
        </PropRow>
        {subCategoryName && (
          <PropRow label="Sub Category">
            <span className="text-xs text-foreground">{subCategoryName}</span>
          </PropRow>
        )}

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
