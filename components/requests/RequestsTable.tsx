'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
  bulkAddCollaborators,
  bulkExportRequests,
  searchOrgMembers,
} from '@/lib/actions/requests'
import { downloadCSV } from '@/lib/export/csv'
import { StatusBadge, PriorityBadge, ReopenedBadge, SourceBadge } from '@/components/requests/RequestBadges'
import { SLABadge } from '@/components/requests/SLABadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelativeTime, formatDateTime } from '@/lib/utils'
import { useBusy } from '@/lib/ui/busy'
import { pruneSelection } from '@/lib/ui/bulk'
import { useModalA11y } from '@/components/ui/useModalA11y'
import { checkResolutionNote, RESOLUTION_NOTE_HINT, RESOLUTION_NOTE_PLACEHOLDER } from '@/lib/requests/resolution-note'
import type { RequestWithRelations, RequestStatus } from '@/types'

const BULK_STATUSES: { value: RequestStatus; label: string }[] = [
  { value: 'in_progress',  label: 'In Progress' },
  { value: 'waiting_user', label: 'Waiting on User' },
  { value: 'resolved',     label: 'Resolved' },
  { value: 'cancelled',    label: 'Cancelled' },
]

// These three need a written message (the same rule as changing one ticket): the message is posted on every ticket.
type RemarkStatus = 'waiting_user' | 'resolved' | 'cancelled'
const REMARK_STATUSES: RequestStatus[] = ['waiting_user', 'resolved', 'cancelled']
const plural = (n: number) => `${n} ticket${n === 1 ? '' : 's'}`
const REMARK_CONFIG: Record<RemarkStatus, { heading: (n: number) => string; placeholder: string; cta: string; hint?: string }> = {
  waiting_user: { heading: (n) => `Ask the requester for details (${plural(n)})`, placeholder: 'e.g. Please confirm your extension number…', cta: 'Set to Waiting on User' },
  resolved:     { heading: (n) => `Mark ${plural(n)} as resolved`, placeholder: RESOLUTION_NOTE_PLACEHOLDER, cta: 'Mark Resolved', hint: RESOLUTION_NOTE_HINT },
  cancelled:    { heading: (n) => `Cancel ${plural(n)}`, placeholder: 'Why are these tickets being cancelled?', cta: 'Cancel tickets' },
}

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
  useBusy(open)

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
      try {
        const found = await searchOrgMembers(q)
        if (!cancelled) { setResults(found); setSearching(false) }
      } catch {
        // a failed search just shows "No matches"; it must not become an unhandled error
        if (!cancelled) { setResults([]); setSearching(false) }
      }
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
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
              aria-label="Search people"
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

// ── Message box for bulk Resolved / Cancelled / Waiting on User ──────────────────

function BulkRemarkDialog({ status, count, busy, onConfirm, onCancel }: {
  status: RemarkStatus; count: number; busy: boolean; onConfirm: (remark: string) => void; onCancel: () => void
}) {
  const cfg = REMARK_CONFIG[status]
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dialog = useModalA11y({ onClose: () => { if (!busy) onCancel() }, label: cfg.heading(count) })

  function submit() {
    if (!text.trim()) { setError('This message is required.'); return }
    if (status === 'resolved') { const problem = checkResolutionNote(text); if (problem) { setError(problem); return } }
    onConfirm(text.trim())
  }

  return (
    <div {...dialog.props} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onCancel()}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-foreground">{cfg.heading(count)}</h3>
        <p className="text-xs text-muted-foreground">This message is added to the conversation of every selected ticket.</p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          placeholder={cfg.placeholder}
          aria-label="Message"
          rows={4}
          className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {cfg.hint && !error && <p className="text-[11px] leading-snug text-muted-foreground">{cfg.hint}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">Back</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-gradient px-3 py-1.5 text-xs disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : cfg.cta}
          </button>
        </div>
      </div>
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
  /** When set, the requester's name becomes a link that lists every ticket of that requester on this page. */
  requesterFilterPath?: string
}

export function RequestsTable({
  requests, emptyTitle, emptyDescription, viewerId, teamMembers,
  showAssignAction, sortCol, sortDir, pathname, currentSearch, requesterFilterPath,
}: RequestsTableProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [isExporting, startExport] = useTransition()
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [remarkFor, setRemarkFor] = useState<RemarkStatus | null>(null)
  // What happened to the last bulk action: kept on screen until the person closes it, with the ticket numbers and reasons that failed.
  const [bulkSummary, setBulkSummary] = useState<{ title: string; failures: { requestNo: string; error: string }[] } | null>(null)

  // The page re-reads its data in the background, which hands this component a new array every time.
  // Only drop ticked rows that are really gone from the screen (new page, filter or search) — a stale id pointing
  // at a row no longer shown would silently do nothing — but keep the selection when the same rows are still there.
  const idsKey = requests.map((r) => r.id).join(',')
  const [prevIdsKey, setPrevIdsKey] = useState(idsKey)
  if (prevIdsKey !== idsKey) {
    setPrevIdsKey(idsKey)
    setSelected((prev) => pruneSelection(prev, requests.map((r) => r.id)))
  }

  // While rows are ticked or a menu / message box is open, the background refresh waits (see lib/ui/busy).
  useBusy(selected.size > 0 || assignOpen || statusOpen || remarkFor !== null || bulkSummary !== null)

  const allSelected = requests.length > 0 && selected.size === requests.length
  const someSelected = selected.size > 0 && !allSelected

  // Preserve where the click came from (e.g. Agent Requests vs. My Requests)
  // so the ticket detail page's "Requests" breadcrumb can send them back to
  // the same tab/filters instead of always defaulting to My Requests.
  const backHref = `${pathname}${currentSearch ? `?${currentSearch}` : ''}`
  function rowHref(id: string) {
    return `/requests/${id}?from=${encodeURIComponent(backHref)}`
  }

  // The whole row is a click target for convenience, but links, buttons and boxes inside it do their own thing,
  // and Ctrl / Shift / middle click or selecting text must not navigate.
  function onRowClick(e: React.MouseEvent, id: string) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if ((e.target as Element).closest('a, button, input, select, textarea, label, [role="button"]')) return
    if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
    router.push(rowHref(id))
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
    setBulkSummary(null)
    setAssignOpen(false); setStatusOpen(false)
  }

  const numberOf = (id: string) => requests.find((r) => r.id === id)?.request_no ?? 'A ticket'

  // Shows what happened. Tickets that worked leave the selection; tickets that failed stay ticked so they can be tried again.
  function finishBulk(what: string, ok: number, failed: { id: string; error: string }[]) {
    if (failed.length === 0) {
      toast.success(`${ok} request${ok === 1 ? '' : 's'} updated.`)
      setBulkSummary(null)
      clearSelection()
      return
    }
    setBulkSummary({
      title: `${failed.length} of ${ok + failed.length} request${ok + failed.length === 1 ? '' : 's'} could not be updated (${what}).`,
      failures: failed.map((f) => ({ requestNo: f.id ? numberOf(f.id) : 'All selected', error: f.error })),
    })
    setSelected(new Set(failed.map((f) => f.id).filter(Boolean)))
    setAssignOpen(false); setStatusOpen(false)
  }

  // A thrown error (network drop, server restarted) must not escape: say so plainly and keep the selection.
  const BULK_NETWORK_ERROR = 'Could not reach the server. Check your internet and try again.'

  function handleBulkAssign(assigneeId: string | null) {
    const ids = Array.from(selected)
    setAssignOpen(false); setBulkError(null)
    startTransition(async () => {
      try {
        const result = await bulkAssignRequests(ids, assigneeId)
        finishBulk('assign', result.succeeded.length, result.failed)
      } catch { setBulkError(BULK_NETWORK_ERROR) }
    })
  }

  function handleBulkStatus(status: RequestStatus) {
    setStatusOpen(false); setBulkError(null)
    // Resolved / Cancelled / Waiting on User need a written message, exactly like changing one ticket: ask for it first.
    if (REMARK_STATUSES.includes(status)) { setRemarkFor(status as RemarkStatus); return }
    const ids = Array.from(selected)
    startTransition(async () => {
      try {
        const result = await bulkUpdateStatus(ids, status)
        finishBulk('change status', result.succeeded.length, result.failed)
      } catch { setBulkError(BULK_NETWORK_ERROR) }
    })
  }

  // One call for all the tickets: the server applies the message to each of them the way the single-ticket screen does.
  function handleBulkStatusWithRemark(status: RemarkStatus, remark: string) {
    const ids = Array.from(selected)
    setBulkError(null)
    startTransition(async () => {
      try {
        const result = await bulkUpdateStatus(ids, status, remark)
        setRemarkFor(null)
        finishBulk('change status', result.succeeded.length, result.failed)
      } catch { setBulkError(BULK_NETWORK_ERROR) }
    })
  }

  function handleBulkCollaborator(userId: string) {
    const ids = Array.from(selected)
    setBulkError(null)
    startTransition(async () => {
      try {
        const result = await bulkAddCollaborators(ids, userId)
        finishBulk('add collaborator', result.succeeded.length, result.failed)
      } catch { setBulkError(BULK_NETWORK_ERROR) }
    })
  }

  function handleExport() {
    const ids = Array.from(selected)
    setBulkError(null)
    startExport(async () => {
      try {
        const result = await bulkExportRequests(ids)
        if (result.error || !result.csv) { setBulkError(result.error ?? 'Export failed.'); return }
        downloadCSV(`requests-${ids.length}.csv`, result.csv)
      } catch { setBulkError('Export failed. Check your internet and try again.') }
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
        <table className="w-full min-w-[1000px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-8 px-3 py-2">
                <button type="button" onClick={toggleAll} className="text-muted-foreground hover:text-primary transition-colors" aria-label="Select all on this page" title="Select all on this page">
                  {allSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : someSelected ? <MinusSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                </button>
              </th>
              <SortableTh label="Request #" col="request_no" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Title</th>
              <SortableTh label="Status" col="status" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
              <SortableTh label="Priority" col="priority" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Source</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Requester</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Technician</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Category</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Sub Category</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Service</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">SLA</th>
              <SortableTh label="Created" col="created_at" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
              <SortableTh label="Updated" col="updated_at" sortCol={sortCol} sortDir={sortDir} pathname={pathname} currentSearch={currentSearch} />
            </tr>
          </thead>
          <tbody className={isPending ? 'opacity-60 pointer-events-none' : ''}>
            {requests.map((req) => {
              const isSelected = selected.has(req.id)
              return (
                <tr
                  key={req.id}
                  onClick={(e) => onRowClick(e, req.id)}
                  className={`cursor-pointer border-b border-border/60 last:border-0 transition-colors ${isSelected ? 'bg-primary/[0.04]' : 'hover:bg-muted/30'}`}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => toggleOne(req.id)} className="text-muted-foreground hover:text-primary transition-colors" aria-label={`${isSelected ? 'Deselect' : 'Select'} ${req.request_no}`} aria-pressed={isSelected}>
                      {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    <Link href={rowHref(req.id)} className="hover:text-primary hover:underline underline-offset-2">{req.request_no}</Link>
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2 font-medium text-foreground">
                    <Link href={rowHref(req.id)} className="hover:text-primary hover:underline underline-offset-2">{requestSubject(req)}</Link>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={req.status} size="sm" />
                      <ReopenedBadge count={req.reopen_count ?? 0} size="sm" />
                    </div>
                  </td>
                  <td className="px-3 py-2"><PriorityBadge priority={req.priority} size="sm" /></td>
                  <td className="px-3 py-2"><SourceBadge sourceMetadata={req.source_metadata} size="sm" /></td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground">
                    {req.requester && requesterFilterPath ? (
                      <Link
                        href={`${requesterFilterPath}?tab=team&status=all&requester=${req.requester.id}`}
                        onClick={(e) => e.stopPropagation()}
                        title={`Show all tickets of ${req.requester.full_name}`}
                        className="hover:text-primary hover:underline underline-offset-2"
                      >
                        {req.requester.full_name}
                      </Link>
                    ) : (req.requester?.full_name ?? '—')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {req.assignee ? <span className="text-foreground">{req.assignee.full_name}</span> : <span className="text-amber-600 font-medium">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{req.category?.name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{req.sub_category?.name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{req.service.name}</td>
                  <td className="px-3 py-2">
                    <SLABadge resolutionDueAt={req.resolution_due_at} responseDueAt={req.response_due_at} status={req.status} showLabel />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" suppressHydrationWarning>{formatDateTime(req.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" suppressHydrationWarning>{formatRelativeTime(req.updated_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {remarkFor && selected.size > 0 && (
        <BulkRemarkDialog
          status={remarkFor}
          count={selected.size}
          busy={isPending}
          onConfirm={(remark) => handleBulkStatusWithRemark(remarkFor, remark)}
          onCancel={() => setRemarkFor(null)}
        />
      )}

      {/* What happened to the last bulk action, kept until it is closed */}
      {bulkSummary && (
        <div role="alert" className="sticky bottom-20 z-20 mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 shadow-lg dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">{bulkSummary.title}</p>
            <button type="button" onClick={() => setBulkSummary(null)} aria-label="Close this message" className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50"><X className="h-3.5 w-3.5" /></button>
          </div>
          <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto">
            {bulkSummary.failures.map((f, i) => <li key={i}><span className="font-mono">{f.requestNo}</span>: {f.error}</li>)}
          </ul>
          <p className="mt-1.5 text-[11px] opacity-80">The tickets that failed are still ticked, so you can try again.</p>
        </div>
      )}

      {/* Bulk action bar — sticks to bottom when items selected */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mt-3">
          <div className="mx-auto flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-xl ring-1 ring-black/5">
            <span className="px-2 text-xs font-semibold text-foreground">{selected.size} selected</span>
            <div className="h-4 w-px bg-border" />

            {showAssignAction && (
              <div className="relative">
                <button type="button" onClick={() => { setAssignOpen((v) => !v); setStatusOpen(false) }} disabled={isPending} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
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
              <button type="button" onClick={() => { setStatusOpen((v) => !v); setAssignOpen(false) }} disabled={isPending} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
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
