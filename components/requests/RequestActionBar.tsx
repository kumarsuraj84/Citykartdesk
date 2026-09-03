'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Loader2, UserCheck, ChevronDown, GitMerge, CheckCircle2, Search, X } from 'lucide-react'
import { assignRequest, updateRequestStatus } from '@/lib/actions/requests'
import { sendAdHocApproval, searchManagersForApproval } from '@/lib/actions/approvals'
import { SLACountdownClocks } from './SLACountdownClocks'
import type { RequestStatus } from '@/types'
import { ROLE_LABELS } from '@/lib/constants/roles'

interface Props {
  requestId:          string
  viewerId:           string
  isAgent:            boolean
  isManager:          boolean
  isAssignedToViewer: boolean
  isTerminal:         boolean
  status:             RequestStatus
  activeTimer?:       { id: string; started_at: string } | null
  responseDueAt:      string | null
  resolutionDueAt:    string | null
  respondedAt:        string | null
  resolvedAt:         string | null
  waitingSince:       string | null
}

// ── Main component ────────────────────────────────────────────────────────────

export function RequestActionBar({
  requestId,
  viewerId,
  isAgent,
  isManager,
  isAssignedToViewer,
  isTerminal,
  status,
  activeTimer: initialTimer,
  responseDueAt,
  resolutionDueAt,
  respondedAt,
  resolvedAt,
  waitingSince,
}: Props) {
  const [isPending, startTransition]           = useTransition()
  const [isStartingWork, startWorkTransition]  = useTransition()
  const [isActing, actTransition]              = useTransition()
  const [showActions, setShowActions]          = useState(false)
  const [showApprovalPicker, setShowApprovalPicker] = useState(false)
  const [approvalSearch, setApprovalSearch]    = useState('')
  const [approvalResults, setApprovalResults]  = useState<{ id: string; full_name: string; role: string }[]>([])
  const [selectedApprovers, setSelectedApprovers] = useState<{ id: string; full_name: string }[]>([])
  const [pickUpError, setPickUpError]          = useState<string | null>(null)
  const [startWorkError, setStartWorkError]    = useState<string | null>(null)
  const [localStatus, setLocalStatus]          = useState(status)
  const [actionError, setActionError]          = useState<string | null>(null)
  const [actionSuccess, setActionSuccess]      = useState<string | null>(null)
  const [activeTimer, setActiveTimer]          = useState(initialTimer ?? null)
  const [showStartWorkModal, setShowStartWorkModal] = useState(false)
  const [startWorkMessage, setStartWorkMessage]     = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const approvalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const approvalSearchSeq = useRef(0)
  const flashErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep in sync if the server re-renders this component with fresh props
  // (e.g. another actor changed status, or a status change from elsewhere on the
  // page auto-started/stopped the timer) without discarding pending local edits.
  const [prevStatus, setPrevStatus] = useState(status)
  if (prevStatus !== status) { setPrevStatus(status); setLocalStatus(status) }
  const [prevActiveTimerId, setPrevActiveTimerId] = useState(initialTimer?.id ?? null)
  if (prevActiveTimerId !== (initialTimer?.id ?? null)) {
    setPrevActiveTimerId(initialTimer?.id ?? null)
    setActiveTimer(initialTimer ?? null)
  }

  const canStartWorking = localStatus === 'open' || localStatus === 'assigned'
  // Start Working is mandatory before a request can go for approval — it
  // can't be sent while it's still sitting unstarted in open/assigned.
  const canSendForApproval = !canStartWorking

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowActions(false)
      }
    }
    if (showActions) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showActions])

  function flash(msg: string, isError = false) {
    // Clear any timer from a previous flash() of the same kind — otherwise
    // two error flashes in quick succession race: the first one's timeout
    // still fires and clears the SECOND message early.
    if (isError) {
      if (flashErrorTimer.current) clearTimeout(flashErrorTimer.current)
      setActionError(msg)
      flashErrorTimer.current = setTimeout(() => setActionError(null), 4000)
    } else {
      if (flashSuccessTimer.current) clearTimeout(flashSuccessTimer.current)
      setActionSuccess(msg)
      flashSuccessTimer.current = setTimeout(() => setActionSuccess(null), 3000)
    }
  }

  useEffect(() => {
    return () => {
      if (flashErrorTimer.current) clearTimeout(flashErrorTimer.current)
      if (flashSuccessTimer.current) clearTimeout(flashSuccessTimer.current)
    }
  }, [])

  function handlePickUp() {
    setPickUpError(null)
    startTransition(async () => {
      const result = await assignRequest(requestId, viewerId)
      if (result?.error) setPickUpError(result.error)
    })
  }

  // Starting work is also the ticket's first response — the requester's
  // first real word from a technician, not just a status flip — so it opens
  // a modal requiring that message instead of firing immediately. The
  // message becomes the first conversation comment (server-enforced too,
  // see updateRequestStatus's in_progress + !responded_at guard).
  function openStartWorkModal() {
    setStartWorkError(null)
    setStartWorkMessage('')
    setShowStartWorkModal(true)
  }

  function confirmStartWorking() {
    if (!startWorkMessage.trim()) { setStartWorkError('Please add an initial response message before starting work.'); return }
    setStartWorkError(null)
    startWorkTransition(async () => {
      const result = await updateRequestStatus(requestId, 'in_progress', startWorkMessage)
      if (result?.error) { setStartWorkError(result.error); return }
      setLocalStatus('in_progress')
      // updateRequestStatus auto-starts a time entry server-side — reflect it
      // immediately rather than waiting for the next prop sync. The entry's real id
      // is unused client-side (nothing manually stops it anymore), so a placeholder
      // is fine here.
      setActiveTimer({ id: 'pending', started_at: new Date().toISOString() })
      setShowStartWorkModal(false)
      setStartWorkMessage('')
    })
  }

  // Debounced: searchManagersForApproval falls back to
  // admin.auth.admin.listUsers({ perPage: 1000 }) whenever the name search
  // doesn't turn up 8+ matches, so firing it on every keystroke would hit
  // that expensive path repeatedly while someone is mid-type. 300ms settle,
  // plus a request-sequence guard so a slow earlier lookup can't clobber a
  // faster later one's results.
  function handleApprovalSearch(q: string) {
    setApprovalSearch(q)
    if (approvalSearchTimer.current) clearTimeout(approvalSearchTimer.current)
    if (!q.trim()) { setApprovalResults([]); return }
    const seq = ++approvalSearchSeq.current
    approvalSearchTimer.current = setTimeout(async () => {
      const results = await searchManagersForApproval(q)
      if (seq !== approvalSearchSeq.current) return // a newer keystroke superseded this lookup
      // Filter out already-selected approvers
      setApprovalResults(results.filter((r) => !selectedApprovers.some((a) => a.id === r.id)))
    }, 300)
  }

  useEffect(() => {
    return () => { if (approvalSearchTimer.current) clearTimeout(approvalSearchTimer.current) }
  }, [])

  function addApprover(u: { id: string; full_name: string }) {
    if (selectedApprovers.some((a) => a.id === u.id)) return
    setSelectedApprovers((prev) => [...prev, u])
    setApprovalSearch('')
    setApprovalResults([])
  }

  function removeApprover(id: string) {
    setSelectedApprovers((prev) => prev.filter((a) => a.id !== id))
  }

  function handleSendForApproval() {
    if (!selectedApprovers.length) return
    setShowApprovalPicker(false)
    const names = selectedApprovers.map((a) => a.full_name).join(', ')
    actTransition(async () => {
      const result = await sendAdHocApproval(requestId, selectedApprovers.map((a) => a.id))
      if (result.error) { flash(result.error, true); return }
      flash(`Sent to ${names} for approval`)
      setApprovalSearch('')
      setApprovalResults([])
      setSelectedApprovers([])
    })
  }

  if (!isAgent && !isManager) return null
  if (isTerminal) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {/* Pick up */}
        {isAgent && !isAssignedToViewer && (
          <button
            onClick={handlePickUp}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5 text-primary" />}
            Pick up
          </button>
        )}

        {/* Start Working — hidden once the request has actually moved past open/assigned,
            not just while the transition is in flight, so it can't be clicked twice. */}
        {isAgent && isAssignedToViewer && canStartWorking && (
          <button
            onClick={openStartWorkModal}
            disabled={isStartingWork}
            className="btn-gradient disabled:opacity-50"
          >
            {isStartingWork && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Start Working →
          </button>
        )}

        {/* Response/Resolution SLA countdowns — what a technician actually
            needs to watch, replacing the old single work-elapsed badge. */}
        <SLACountdownClocks
          responseDueAt={responseDueAt}
          resolutionDueAt={resolutionDueAt}
          respondedAt={respondedAt}
          resolvedAt={resolvedAt}
          status={localStatus}
          waitingSince={waitingSince}
        />

        {/* Actions dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => { setShowActions((v) => !v); setShowApprovalPicker(false) }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
          >
            Actions
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showActions ? 'rotate-180' : ''}`} />
          </button>

          {showActions && (
            <div className="absolute right-0 top-full z-20 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              {/* Send for approval */}
              {(isAgent || isManager) && (
                <div className="p-1">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Approval</p>
                  <button
                    onClick={() => canSendForApproval && setShowApprovalPicker((v) => !v)}
                    disabled={isActing || !canSendForApproval}
                    title={!canSendForApproval ? 'Start working on this request before sending it for approval.' : undefined}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <GitMerge className="h-4 w-4 text-violet-500" />
                    Send for Approval
                    <ChevronDown className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${showApprovalPicker ? 'rotate-180' : ''}`} />
                  </button>
                  {!canSendForApproval && (
                    <p className="px-3 pb-1.5 text-[10px] text-muted-foreground">Start working first to send this for approval.</p>
                  )}

                  {/* Inline approval picker */}
                  {showApprovalPicker && canSendForApproval && (
                    <div className="mx-1 mb-1 mt-0.5 rounded-lg border border-border bg-muted/40 p-2 space-y-2">
                      <p className="text-[11px] text-muted-foreground">Add one or more people. All must approve before the request resumes.</p>

                      {/* Selected approver chips */}
                      {selectedApprovers.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedApprovers.map((a) => (
                            <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 pl-2 pr-1 py-0.5 text-[11px] font-medium text-violet-800">
                              {a.full_name}
                              <button type="button" onClick={() => removeApprover(a.id)} className="rounded-full hover:bg-violet-200 p-0.5">
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          value={approvalSearch}
                          onChange={(e) => handleApprovalSearch(e.target.value)}
                          placeholder="Search people to add…"
                          className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-ring"
                          autoFocus
                        />
                        {approvalSearch && (
                          <button type="button" onClick={() => { setApprovalSearch(''); setApprovalResults([]) }} className="absolute right-2 top-1/2 -translate-y-1/2">
                            <X className="h-3 w-3 text-muted-foreground" />
                          </button>
                        )}
                      </div>

                      {approvalResults.length > 0 && (
                        <ul className="rounded-md border border-border bg-card divide-y divide-border max-h-36 overflow-auto">
                          {approvalResults.map((u) => (
                            <li key={u.id}>
                              <button
                                type="button"
                                onClick={() => addApprover(u)}
                                className="w-full px-3 py-2 text-left text-xs hover:bg-muted flex items-center gap-2"
                              >
                                <span className="flex-1 font-medium">{u.full_name}</span>
                                <span className="text-[10px] text-muted-foreground">{(ROLE_LABELS as Record<string, string>)[u.role] ?? u.role}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <button
                        type="button"
                        onClick={handleSendForApproval}
                        disabled={!selectedApprovers.length || isActing}
                        className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                      >
                        {isActing
                          ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                          : `Send to ${selectedApprovers.length || ''} ${selectedApprovers.length === 1 ? 'person' : 'people'} →`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Feedback messages */}
      {pickUpError && <p className="text-xs text-red-600">{pickUpError}</p>}
      {startWorkError && <p className="text-xs text-red-600">{startWorkError}</p>}
      {actionError && <p className="text-xs text-red-600">{actionError}</p>}
      {actionSuccess && (
        <p className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> {actionSuccess}
        </p>
      )}

      {showStartWorkModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => !isStartingWork && setShowStartWorkModal(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground">Start working on this request</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This is your first response to the requester — it&apos;s required, posts to the conversation, and starts the clock on your resolution SLA.
              </p>
            </div>
            <textarea
              autoFocus
              value={startWorkMessage}
              onChange={(e) => { setStartWorkMessage(e.target.value); if (startWorkError) setStartWorkError(null) }}
              placeholder="e.g. Looking into this now, will update you shortly…"
              rows={4}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {startWorkError && <p className="text-xs text-destructive">{startWorkError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowStartWorkModal(false)}
                disabled={isStartingWork}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmStartWorking}
                disabled={isStartingWork}
                className="btn-gradient px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {isStartingWork ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Start Working →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
