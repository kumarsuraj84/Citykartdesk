'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckSquare,
  Square,
  MinusSquare,
  ChevronDown,
  X,
  Loader2,
  Download,
  UserPlus,
  Inbox,
} from 'lucide-react'
import {
  bulkAssignRequests,
  bulkUpdateStatus,
  bulkChangePriority,
  bulkAddCollaborators,
  bulkExportRequests,
  searchOrgMembers,
} from '@/lib/actions/requests'
import { downloadCSV } from '@/lib/export/csv'
import { StatusBadge, PriorityBadge, ReopenedBadge } from '@/components/requests/RequestBadges'
import { SLABadge } from '@/components/requests/SLABadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelativeTime } from '@/lib/utils'
import type { RequestWithRelations, RequestStatus, RequestPriority } from '@/types'

const BULK_STATUSES: { value: RequestStatus; label: string }[] = [
  { value: 'in_progress',  label: 'In Progress' },
  { value: 'waiting_user', label: 'Waiting on User' },
  { value: 'resolved',     label: 'Resolved' },
  { value: 'cancelled',    label: 'Cancelled' },
]

const BULK_PRIORITIES: { value: RequestPriority; label: string }[] = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

// createRequest() stores title as "ServiceName: Subject" (or just "ServiceName"
// when the form had no title-worthy field) — the Title column should read as a
// subject line, not repeat the Service column right next to it.
function requestSubject(req: RequestWithRelations): string {
  const prefix = `${req.service.name}: `
  return req.title.startsWith(prefix) ? req.title.slice(prefix.length) : req.title
}

// ── Sortable column header ──────────────────────────────────────────────────────

function SortableTh({ label, col, sortCol, sortDir, pathname, currentSearch }: {
  label: string; col: string; sortCol: string; sortDir: 'asc' | 'desc'; pathname: string; currentSearch: string
}) {
  const router = useRouter()
  const isActive = sortCol === col
  function handleSort() {
    const params = new URLSearchParams(currentSearch)
    params.set('sort', col)
    params.set('dir', isActive && sortDir === 'desc' ? 'asc' : 'desc')
    router.push(`${pathname}?${params.toString()}`)
  }
  return (
    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
      <button type="button" onClick={handleSort} className="flex items-center gap-1 hover:text-foreground transition-colors">
        {label}
        {isActive && <span className="text-[9px]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </th>
  )
}

// ── Bulk "add collaborator" picker ──────────────────────────────────────────────

function BulkCollaboratorPicker({ onPick, disabled }: { onPick: (userId: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; full_name: string }[]>([])
  const [searching, setSearching] = useState(false)
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
      const found = await searchOrgMembers(q)
      if (!cancelled) { setResults(found); setSearching(false) }
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Add Collaborator
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-border bg-card shadow-lg">
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {!query.trim() ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Type a name to search</p>
            ) : searching ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
            ) : (
              results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onPick(m.id); setOpen(false); setQuery('') }}
                  className="flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
                >
                  {m.full_name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main table ───────────────────────────────────────────────────────────────

interface RequestsTableProps {
  requests: RequestWithRelations[]
  emptyTitle: string
  emptyDescription: string
  viewerId: string
  teamMembers: { id: string; full_name: string }[]
  showAssignAction: boolean
  sortCol: string
  sortDir: 'asc' | 'desc'
  pathname: string
  currentSearch: string
}

export function RequestsTable({
  requests, emptyTitle, emptyDescription, viewerId, teamMembers,
  showAssignAction, sortCol, sortDir, pathname, currentSearch,
}: RequestsTableProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [isExporting, startExport] = useTransition()
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)

  // Selection doesn't survive a fresh set of rows (new page/filter/sort) — stale
  // ids pointing at rows no longer on screen would silently no-op on bulk actions.
  const [prevRequests, setPrevRequests] = useState(requests)
  if (prevRequests !== requests) { setPrevRequests(requests); setSelected(new Set()) }

  const allSelected = requests.length > 0 && selected.size === requests.length
  const someSelected = selected.size > 0 && !allSelected

  // Preserve where the click came from (e.g. Agent Requests vs. My Requests)
  // so the ticket detail page's "Requests" breadcrumb can send them back to
  // the same tab/filters instead of always defaulting to My Requests.
  const backHref = `${pathname}${currentSearch ? `?${currentSearch}` : ''}`
  function rowHref(id: string) {
    return `/requests/${id}?from=${encodeURIComponent(backHref)}`
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(requests.map((r) => r.id)))
  }

  function clearSelection() {
    setSelected(new Set())
    setBulkError(null)
    setAssignOpen(false); setStatusOpen(false); setPriorityOpen(false)
  }

  function handleBulkAssign(assigneeId: string | null) {
    const ids = Array.from(selected)
    setAssignOpen(false); setBulkError(null)
    startTransition(async () => {
      const result = await bulkAssignRequests(ids, assigneeId)
      if (result.failed.length > 0) setBulkError(`${result.failed.length} request(s) could not be updated.`)
      else clearSelection()
    })
  }

  function handleBulkStatus(status: RequestStatus) {
    const ids = Array.from(selected)
    setStatusOpen(false); setBulkError(null)
    startTransition(async () => {
      const result = await bulkUpdateStatus(ids, status)
      if (result.failed.length > 0) setBulkError(`${result.failed.length} request(s) could not be updated.`)
      else clearSelection()
    })
  }

  function handleBulkPriority(priority: RequestPriority) {
    const ids = Array.from(selected)
    setPriorityOpen(false); setBulkError(null)
    startTransition(async () => {
      const result = await bulkChangePriority(ids, priority)
      if (result.failed.length > 0) setBulkError(`${result.failed.length} request(s) could not be updated.`)
      else clearSelection()
    })
  }

  function handleBulkCollaborator(userId: string) {
    const ids = Array.from(selected)
    setBulkError(null)
    startTransition(async () => {
      const result = await bulkAddCollaborators(ids, userId)
      if (result.failed.length > 0) setBulkError(`${result.failed.length} request(s) could not be updated.`)
      else clearSelection()
    })
  }

  function handleExport() {
    const ids = Array.from(selected)
    setBulkError(null)
    startExport(async () => {
      const result = await bulkExportRequests(ids)
      if (result.error || !result.csv) { setBulkError(result.error ?? 'Export failed.'); return }
      downloadCSV(`requests-${ids.length}.csv`, result.csv)
    })
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[880px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-8 px-3 py-2">
                <button type="button" onClick={toggleAll} className="text-muted-foreground hover:text-primary transition-colors" aria-label="Select all">
                  {allSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : someSelected ? <MinusSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                </button>
              </th>
              <SortableTh label="Request #" col="request_no" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Title</th>
              <SortableTh label="Status" col="status" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
              <SortableTh label="Priority" col="priority" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Requester</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Technician</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Category</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Sub Category</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Service</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">SLA</th>
              <SortableTh label="Updated" col="updated_at" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
            </tr>
          </thead>
          <tbody className={isPending ? 'opacity-60 pointer-events-none' : ''}>
            {requests.map((req) => {
              const isSelected = selected.has(req.id)
              return (
                <tr
                  key={req.id}
                  onClick={() => router.push(rowHref(req.id))}
                  className={`cursor-pointer border-b border-border/60 last:border-0 transition-colors ${isSelected ? 'bg-primary/[0.04]' : 'hover:bg-muted/30'}`}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => toggleOne(req.id)} className="text-muted-foreground hover:text-primary transition-colors" aria-label={isSelected ? 'Deselect' : 'Select'}>
                      {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">{req.request_no}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 font-medium text-foreground">{requestSubject(req)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={req.status} size="sm" />
                      <ReopenedBadge count={req.reopen_count ?? 0} size="sm" />
                    </div>
                  </td>
                  <td className="px-3 py-2"><PriorityBadge priority={req.priority} size="sm" /></td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground">{req.requester?.full_name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {req.assignee ? <span className="text-foreground">{req.assignee.full_name}</span> : <span className="text-amber-600 font-medium">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{req.category?.name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{req.sub_category?.name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{req.service.name}</td>
                  <td className="px-3 py-2">
                    <SLABadge resolutionDueAt={req.resolution_due_at} responseDueAt={req.response_due_at} status={req.status} showLabel />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" suppressHydrationWarning>{formatRelativeTime(req.updated_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk action bar — sticks to bottom when items selected */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mt-3">
          <div className="mx-auto flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-xl ring-1 ring-black/5">
            <span className="px-2 text-xs font-semibold text-foreground">{selected.size} selected</span>
            <div className="h-4 w-px bg-border" />

            {showAssignAction && (
              <div className="relative">
                <button type="button" onClick={() => { setAssignOpen((v) => !v); setStatusOpen(false); setPriorityOpen(false) }} disabled={isPending} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                  Assign To
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {assignOpen && (
                  <div className="absolute bottom-full left-0 mb-2 min-w-[180px] rounded-xl border border-border bg-card shadow-lg">
                    <div className="p-1">
                      <button type="button" onClick={() => handleBulkAssign(null)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted transition-colors">Unassign</button>
                      <button type="button" onClick={() => handleBulkAssign(viewerId)} className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted transition-colors">Assign to Me</button>
                      {teamMembers.filter((m) => m.id !== viewerId).map((m) => (
                        <button key={m.id} type="button" onClick={() => handleBulkAssign(m.id)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-muted transition-colors">{m.full_name}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="relative">
              <button type="button" onClick={() => { setStatusOpen((v) => !v); setAssignOpen(false); setPriorityOpen(false) }} disabled={isPending} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                Change Status
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {statusOpen && (
                <div className="absolute bottom-full left-0 mb-2 min-w-[160px] rounded-xl border border-border bg-card shadow-lg">
                  <div className="p-1">
                    {BULK_STATUSES.map((s) => (
                      <button key={s.value} type="button" onClick={() => handleBulkStatus(s.value)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-muted transition-colors">{s.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button type="button" onClick={() => { setPriorityOpen((v) => !v); setAssignOpen(false); setStatusOpen(false) }} disabled={isPending} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                Change Priority
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {priorityOpen && (
                <div className="absolute bottom-full left-0 mb-2 min-w-[140px] rounded-xl border border-border bg-card shadow-lg">
                  <div className="p-1">
                    {BULK_PRIORITIES.map((p) => (
                      <button key={p.value} type="button" onClick={() => handleBulkPriority(p.value)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-muted transition-colors">{p.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <BulkCollaboratorPicker onPick={handleBulkCollaborator} disabled={isPending} />

            <button type="button" onClick={handleExport} disabled={isExporting} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export CSV
            </button>

            <div className="flex-1" />
            {bulkError && <span className="text-xs text-red-600">{bulkError}</span>}
            <button type="button" onClick={clearSelection} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Clear selection">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
