'use client'

import { useState, useTransition, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, User, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateRequestStatus } from '@/lib/actions/requests'
import { AGENT_TRANSITIONS } from '@/lib/constants/request-transitions'
import { StatusBadge, PriorityBadge, ReopenedBadge } from '@/components/requests/RequestBadges'
import { SLABadge } from '@/components/requests/SLABadge'
import type { RequestWithRelations, RequestStatus } from '@/types'

// ── Column config — mirrors the status filter tabs already used on the list view ──

const COLUMNS: { status: RequestStatus; accent: string }[] = [
  { status: 'open',          accent: 'border-l-blue-400' },
  { status: 'in_progress',   accent: 'border-l-amber-400' },
  { status: 'waiting_user',  accent: 'border-l-violet-400' },
  { status: 'resolved',      accent: 'border-l-emerald-400' },
  { status: 'closed',        accent: 'border-l-slate-400' },
]

// ── Sortable card ─────────────────────────────────────────────────────────────

function SortableCard({
  request,
  backHref,
  isDragging = false,
}: {
  request: RequestWithRelations
  backHref: string
  isDragging?: boolean
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging: selfDragging } = useSortable({ id: request.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: selfDragging ? 0.35 : 1,
  }

  return (
    <a
      href={`/requests/${request.id}?from=${encodeURIComponent(backHref)}`}
      ref={setNodeRef as unknown as React.Ref<HTMLAnchorElement>}
      style={style}
      onClick={(e) => { if (isDragging) e.preventDefault() }}
      className={`group relative block cursor-pointer rounded-lg border bg-background p-3 shadow-sm transition-all ${
        isDragging
          ? 'border-primary/40 shadow-lg ring-1 ring-primary/20 rotate-[1deg] scale-[1.02]'
          : 'border-border hover:border-ring hover:shadow-md'
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => e.preventDefault()}
        className="absolute right-2 top-2.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity touch-none"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>

      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{request.request_no}</span>
        <PriorityBadge priority={request.priority} size="sm" />
        <ReopenedBadge count={request.reopen_count ?? 0} size="sm" />
      </div>

      <p className="pr-5 text-sm font-medium text-foreground leading-snug line-clamp-2 mb-2">
        {request.title}
      </p>

      <div className="flex items-center justify-between gap-2">
        <SLABadge
          resolutionDueAt={request.resolution_due_at}
          responseDueAt={request.response_due_at}
          status={request.status}
        />
        {request.assignee ? (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
            {request.assignee.full_name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <User className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        )}
      </div>
    </a>
  )
}

function OverlayCard({ request, backHref }: { request: RequestWithRelations; backHref: string }) {
  return <SortableCard request={request} backHref={backHref} isDragging />
}

// ── Column drop zone ──────────────────────────────────────────────────────────

function BoardColumn({
  status,
  accent,
  requests,
  isOver,
  isValidTarget,
  backHref,
}: {
  status: RequestStatus
  accent: string
  requests: RequestWithRelations[]
  isOver: boolean
  isValidTarget: boolean
  backHref: string
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id: status })

  return (
    <div
      className={`flex w-[calc(20%-13px)] min-w-[220px] shrink-0 flex-col gap-3 rounded-xl border bg-card border-l-4 ${accent} p-3 transition-colors ${
        isOver && isValidTarget ? 'bg-primary/5 border-primary/30' : isOver ? 'bg-red-50 border-red-200' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} size="sm" />
          <span className="text-xs font-semibold text-muted-foreground">{requests.length}</span>
        </div>
      </div>

      <SortableContext items={requests.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setDropRef}
          className={`flex flex-col gap-2 min-h-[60px] rounded-lg transition-colors ${isOver && isValidTarget ? 'bg-primary/5 ring-1 ring-primary/20' : ''}`}
        >
          {requests.map((request) => (
            <SortableCard key={request.id} request={request} backHref={backHref} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

// ── Board root ────────────────────────────────────────────────────────────────

export function RequestBoardView({
  requests: initialRequests,
  pathname,
  currentSearch,
}: {
  requests: RequestWithRelations[]
  pathname: string
  currentSearch: string
}) {
  const backHref = `${pathname}${currentSearch ? `?${currentSearch}` : ''}`
  const [requests, setRequests] = useState<RequestWithRelations[]>(initialRequests)
  const [activeRequest, setActiveRequest] = useState<RequestWithRelations | null>(null)
  const [overColumn, setOverColumn] = useState<RequestStatus | null>(null)
  const [, startTransition] = useTransition()
  // Waiting on User / Resolved / reopening a Resolved ticket all require a
  // message that gets posted to the conversation (enforced server-side in
  // updateRequestStatus) — a drag-and-drop has nowhere to type one, so these
  // three targets pause here for it instead of firing the transition blind.
  const [pendingDrop, setPendingDrop] = useState<{ requestId: string; fromCol: RequestStatus; toCol: RequestStatus; heading: string; placeholder: string; cta: string } | null>(null)
  const [pendingDropText, setPendingDropText] = useState('')
  const [pendingDropError, setPendingDropError] = useState<string | null>(null)
  const [pendingDropSaving, setPendingDropSaving] = useState(false)
  // Guards against a slow, now-superseded drag's error rollback clobbering a
  // status set by a later action on the same card (e.g. a second drag before
  // the first's request resolves) — keyed per request id.
  const dragSeqRef = useRef(new Map<string, number>())
  function nextDragSeq(requestId: string): number {
    const seq = (dragSeqRef.current.get(requestId) ?? 0) + 1
    dragSeqRef.current.set(requestId, seq)
    return seq
  }

  // Re-sync local board state whenever the server passes a new snapshot of requests.
  // Adjusting state during render (React's documented pattern) instead of an effect.
  const [prevInitialRequests, setPrevInitialRequests] = useState(initialRequests)
  if (prevInitialRequests !== initialRequests) {
    setPrevInitialRequests(initialRequests)
    setRequests(initialRequests)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const grouped = COLUMNS.reduce<Record<RequestStatus, RequestWithRelations[]>>(
    (acc, { status }) => { acc[status] = requests.filter((r) => r.status === status); return acc },
    { open: [], assigned: [], in_progress: [], waiting_user: [], pending_approval: [], resolved: [], closed: [], cancelled: [] }
  )

  function findColumnForRequest(id: string): RequestStatus | null {
    for (const { status } of COLUMNS) {
      if (grouped[status].some((r) => r.id === id)) return status
    }
    return null
  }

  function resolveColumn(overId: string): RequestStatus | null {
    const col = COLUMNS.find((c) => c.status === overId)
    if (col) return col.status
    const req = requests.find((r) => r.id === overId)
    return req?.status ?? null
  }

  function onDragStart({ active }: DragStartEvent) {
    const req = requests.find((r) => r.id === active.id)
    if (req) setActiveRequest(req)
  }

  function onDragOver({ over }: DragOverEvent) {
    setOverColumn(over ? resolveColumn(String(over.id)) : null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveRequest(null)
    setOverColumn(null)
    if (!over) return

    const fromCol = findColumnForRequest(String(active.id))
    const toCol = resolveColumn(String(over.id))

    if (!fromCol || !toCol || fromCol === toCol) return
    // Only allow drops that match the real agent transition matrix — e.g. Open can
    // move to In Progress but not straight to Resolved.
    if (!AGENT_TRANSITIONS[fromCol].includes(toCol)) return

    const requestId = String(active.id)

    if (toCol === 'waiting_user' || toCol === 'resolved' || (fromCol === 'resolved' && toCol === 'open')) {
      setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: toCol } : r)))
      setPendingDrop({
        requestId, fromCol, toCol,
        heading: toCol === 'waiting_user' ? 'What do you need from the requester?'
          : toCol === 'resolved' ? 'Resolution details'
          : 'Why are you reopening this?',
        placeholder: toCol === 'waiting_user' ? 'e.g. Please confirm your extension number…'
          : toCol === 'resolved' ? 'What did you do to resolve this?'
          : "Explain what's still wrong…",
        cta: toCol === 'waiting_user' ? 'Set to Waiting on User'
          : toCol === 'resolved' ? 'Mark Resolved'
          : 'Reopen',
      })
      return
    }

    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: toCol } : r)))
    const seq = nextDragSeq(requestId)
    startTransition(async () => {
      const result = await updateRequestStatus(requestId, toCol)
      if (result.error && dragSeqRef.current.get(requestId) === seq) {
        setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: fromCol } : r)))
        toast.error(result.error)
      }
    })
  }

  function cancelPendingDrop() {
    if (!pendingDrop) return
    setRequests((prev) => prev.map((r) => (r.id === pendingDrop.requestId ? { ...r, status: pendingDrop.fromCol } : r)))
    setPendingDrop(null); setPendingDropText(''); setPendingDropError(null)
  }

  function confirmPendingDrop() {
    if (!pendingDrop) return
    if (!pendingDropText.trim()) { setPendingDropError('This message is required.'); return }
    const { requestId, fromCol, toCol } = pendingDrop
    setPendingDropSaving(true)
    const seq = nextDragSeq(requestId)
    startTransition(async () => {
      const result = await updateRequestStatus(requestId, toCol, pendingDropText)
      setPendingDropSaving(false)
      if (result.error && dragSeqRef.current.get(requestId) === seq) {
        setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: fromCol } : r)))
        toast.error(result.error)
      }
      setPendingDrop(null); setPendingDropText(''); setPendingDropError(null)
    })
  }

  const activeValidTargets = activeRequest ? AGENT_TRANSITIONS[activeRequest.status] : []

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-[1100px] items-start gap-3">
            {COLUMNS.map(({ status, accent }) => (
              <BoardColumn
                key={status}
                status={status}
                accent={accent}
                requests={grouped[status]}
                isOver={overColumn === status}
                isValidTarget={activeValidTargets.includes(status)}
                backHref={backHref}
              />
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeRequest ? <OverlayCard request={activeRequest} backHref={backHref} /> : null}
        </DragOverlay>
      </DndContext>

      {pendingDrop && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => !pendingDropSaving && cancelPendingDrop()}>
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">{pendingDrop.heading}</h3>
            <textarea
              autoFocus
              value={pendingDropText}
              onChange={(e) => { setPendingDropText(e.target.value); setPendingDropError(null) }}
              placeholder={pendingDrop.placeholder}
              rows={4}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {pendingDropError && <p className="text-xs text-destructive">{pendingDropError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={cancelPendingDrop} disabled={pendingDropSaving} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirmPendingDrop} disabled={pendingDropSaving} className="btn-gradient px-3 py-1.5 text-xs disabled:opacity-50">
                {pendingDropSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pendingDrop.cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
