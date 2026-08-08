'use client'

import { Fragment, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  CheckSquare,
  Square,
  MinusSquare,
  User,
  X,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { bulkAssignRequests, bulkUpdateStatus, bulkChangePriority } from '@/lib/actions/requests'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { SLABadge } from '@/components/requests/SLABadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { STATUS_LABELS } from '@/lib/constants/requests'
import { formatRelativeTime } from '@/lib/utils'
import type { RequestWithRelations, RequestStatus, RequestPriority } from '@/types'

// ── Group-by-status config — order + accent dot, consistent with the badge hues
// already used in StatusBadge/RequestBoardView. ─────────────────────────────────
const STATUS_GROUP_ORDER: RequestStatus[] = [
  'open', 'assigned', 'in_progress', 'waiting_user', 'pending_approval', 'resolved',
]

const STATUS_DOT: Record<RequestStatus, string> = {
  open:             'bg-blue-500',
  assigned:         'bg-sky-500',
  in_progress:      'bg-indigo-500',
  waiting_user:     'bg-orange-500',
  pending_approval: 'bg-violet-500',
  resolved:         'bg-emerald-500',
  closed:           'bg-slate-400',
  cancelled:        'bg-red-500',
}

// ── Agent-eligible bulk statuses ──────────────────────────────────────────────
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

// ── Request card (table row) ──────────────────────────────────────────────────

function WorkbenchRow({
  request,
  selected,
  onToggle,
}: {
  request: RequestWithRelations
  selected: boolean
  onToggle: (id: string) => void
}) {
  const age = formatRelativeTime(request.created_at)

  return (
    <div
      className={`group flex items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 ${
        selected ? 'bg-primary/[0.04]' : 'hover:bg-muted/30'
      }`}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => onToggle(request.id)}
        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
        aria-label={selected ? 'Deselect' : 'Select'}
      >
        {selected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </button>

      {/* Content — click navigates */}
      <Link
        href={`/requests/${request.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {/* Request No + Title */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground shrink-0">
              {request.request_no}
            </span>
            <span className="shrink-0">
              <StatusBadge status={request.status} size="sm" />
            </span>
            <span className="shrink-0">
              <PriorityBadge priority={request.priority} size="sm" />
            </span>
          </div>
          <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
            {request.title}
          </p>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span>{request.service.name}</span>
            <span className="opacity-40">·</span>
            <span>{request.requester?.full_name ?? '—'}</span>
            {request.assignee && (
              <>
                <span className="opacity-40">·</span>
                <span className="flex items-center gap-0.5">
                  <User className="h-3 w-3" />
                  {request.assignee.full_name.split(' ')[0]}
                </span>
              </>
            )}
            {!request.assignee && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-amber-600 font-medium">Unassigned</span>
              </>
            )}
          </div>
        </div>

        {/* SLA + Age */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <SLABadge
            resolutionDueAt={request.resolution_due_at}
            responseDueAt={request.response_due_at}
            status={request.status}
            showLabel
          />
          <span className="text-[10px] text-muted-foreground">{age}</span>
        </div>
      </Link>
    </div>
  )
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({
  status,
  count,
  sharePct,
  collapsed,
  onToggle,
}: {
  status: RequestStatus
  count: number
  sharePct: number
  collapsed: boolean
  onToggle: () => void
}) {
  const dot = STATUS_DOT[status]
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-left select-none hover:opacity-80 transition-opacity"
    >
      {collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span className="text-[11px] font-semibold text-foreground">{STATUS_LABELS[status]}</span>
      <span className="text-[11px] text-muted-foreground">{count}</span>
      <span className="ml-2 h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full rounded-full ${dot}`} style={{ width: `${sharePct}%` }} />
      </span>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface WorkbenchClientProps {
  requests: RequestWithRelations[]
  teamMembers: { id: string; full_name: string }[]
  viewerId: string
  emptyTitle: string
  emptyDescription: string
  /** Group rows by status with a collapsible header + share bar — only makes sense when the list spans multiple statuses (e.g. the "active" filter), mirrors TaskTable's grouping. */
  groupByStatus?: boolean
}

export function WorkbenchClient({
  requests,
  teamMembers,
  viewerId,
  emptyTitle,
  emptyDescription,
  groupByStatus = false,
}: WorkbenchClientProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<RequestStatus>>(new Set())

  function toggleGroup(status: RequestStatus) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const groups = groupByStatus
    ? STATUS_GROUP_ORDER.map((status) => ({ status, items: requests.filter((r) => r.status === status) })).filter((g) => g.items.length > 0)
    : []

  const allSelected = requests.length > 0 && selected.size === requests.length
  const someSelected = selected.size > 0 && !allSelected

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(requests.map((r) => r.id)))
    }
  }

  function clearSelection() {
    setSelected(new Set())
    setBulkError(null)
    setAssignOpen(false)
    setStatusOpen(false)
    setPriorityOpen(false)
  }

  function handleBulkAssign(assigneeId: string | null) {
    const ids = Array.from(selected)
    setAssignOpen(false)
    setBulkError(null)
    startTransition(async () => {
      const result = await bulkAssignRequests(ids, assigneeId)
      if (result.failed.length > 0) {
        setBulkError(`${result.failed.length} request(s) could not be updated.`)
      } else {
        clearSelection()
      }
    })
  }

  function handleBulkStatus(status: RequestStatus) {
    const ids = Array.from(selected)
    setStatusOpen(false)
    setBulkError(null)
    startTransition(async () => {
      const result = await bulkUpdateStatus(ids, status)
      if (result.failed.length > 0) {
        setBulkError(`${result.failed.length} request(s) could not be updated.`)
      } else {
        clearSelection()
      }
    })
  }

  function handleBulkPriority(priority: RequestPriority) {
    const ids = Array.from(selected)
    setPriorityOpen(false)
    setBulkError(null)
    startTransition(async () => {
      const result = await bulkChangePriority(ids, priority)
      if (result.failed.length > 0) {
        setBulkError(`${result.failed.length} request(s) could not be updated.`)
      } else {
        clearSelection()
      }
    })
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <EmptyState
          icon={CheckCircle2}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Table header */}
        <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
          {/* Select all */}
          <button
            type="button"
            onClick={toggleAll}
            className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
            aria-label="Select all"
          >
            {allSelected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : someSelected ? (
              <MinusSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>

          {selected.size > 0 ? (
            <span className="text-xs font-semibold text-foreground">
              {selected.size} selected
            </span>
          ) : (
            <>
              <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Request
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                SLA / Age
              </span>
            </>
          )}
        </div>

        {/* Rows */}
        <div className={isPending ? 'opacity-60 pointer-events-none' : ''}>
          {groupByStatus ? (
            groups.map(({ status, items }) => (
              <Fragment key={status}>
                <GroupHeader
                  status={status}
                  count={items.length}
                  sharePct={requests.length > 0 ? (items.length / requests.length) * 100 : 0}
                  collapsed={collapsedGroups.has(status)}
                  onToggle={() => toggleGroup(status)}
                />
                {!collapsedGroups.has(status) && items.map((req) => (
                  <WorkbenchRow
                    key={req.id}
                    request={req}
                    selected={selected.has(req.id)}
                    onToggle={toggleOne}
                  />
                ))}
              </Fragment>
            ))
          ) : (
            requests.map((req) => (
              <WorkbenchRow
                key={req.id}
                request={req}
                selected={selected.has(req.id)}
                onToggle={toggleOne}
              />
            ))
          )}
        </div>
      </div>

      {/* Bulk action bar — sticks to bottom when items selected */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mt-3">
          <div className="mx-auto flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-xl ring-1 ring-black/5">
            {/* Count */}
            <span className="px-2 text-xs font-semibold text-foreground">
              {selected.size} selected
            </span>

            <div className="h-4 w-px bg-border" />

            {/* Assign To */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setAssignOpen((v) => !v); setStatusOpen(false); setPriorityOpen(false) }}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                disabled={isPending}
              >
                Assign To
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {assignOpen && (
                <div className="absolute bottom-full left-0 mb-2 min-w-[180px] rounded-xl border border-border bg-card shadow-lg">
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => handleBulkAssign(null)}
                      className="w-full rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Unassign
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkAssign(viewerId)}
                      className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Assign to Me
                    </button>
                    {teamMembers.filter((m) => m.id !== viewerId).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleBulkAssign(m.id)}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-muted transition-colors"
                      >
                        {m.full_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Change Status */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setStatusOpen((v) => !v); setAssignOpen(false); setPriorityOpen(false) }}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                disabled={isPending}
              >
                Change Status
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {statusOpen && (
                <div className="absolute bottom-full left-0 mb-2 min-w-[160px] rounded-xl border border-border bg-card shadow-lg">
                  <div className="p-1">
                    {BULK_STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => handleBulkStatus(s.value)}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-muted transition-colors"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Change Priority */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setPriorityOpen((v) => !v); setAssignOpen(false); setStatusOpen(false) }}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                disabled={isPending}
              >
                Change Priority
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {priorityOpen && (
                <div className="absolute bottom-full left-0 mb-2 min-w-[140px] rounded-xl border border-border bg-card shadow-lg">
                  <div className="p-1">
                    {BULK_PRIORITIES.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => handleBulkPriority(p.value)}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-muted transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Resolve shortcut */}
            <button
              type="button"
              onClick={() => handleBulkStatus('resolved')}
              className="btn-success"
              disabled={isPending}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Resolve
            </button>

            <div className="flex-1" />

            {bulkError && (
              <span className="text-xs text-red-600">{bulkError}</span>
            )}

            {/* Clear */}
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
