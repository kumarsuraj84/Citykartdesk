import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft,
  Lock,
  Clock,
} from 'lucide-react'
import { redirect } from 'next/navigation'
import { getCurrentProfile, getTeamMembers } from '@/lib/queries/profiles'
import { getRequestById, getRequestActivity, getRequestComments, getRequestCollaborators, getRelatedRequests, getCsatSurveyForRequest } from '@/lib/queries/requests'
import { getRequestAttachments } from '@/lib/queries/attachments'
import { getApprovalsForRequest } from '@/lib/queries/approvals'
import { ApprovalPanel } from '@/components/requests/ApprovalPanel'
import { RelatedRequestsPanel } from '@/components/requests/RelatedRequestsPanel'
import { CsatSurvey } from '@/components/requests/CsatSurvey'
import { SLABadge } from '@/components/requests/SLABadge'
import { StatusBadge, PriorityBadge, ReopenedBadge, SourceBadge } from '@/components/requests/RequestBadges'
import { RequestSidebarPanel } from '@/components/requests/RequestSidebarPanel'
import { SubmittedDataPanel } from '@/components/requests/SubmittedDataPanel'
import { getActiveServicesForReclassify, getAllowedSubCategoriesForService } from '@/lib/queries/services'
import { RequestTasksTab } from '@/components/requests/RequestTasksTab'
import { getTasksForRequest } from '@/lib/queries/tasks'
import { getAllProjectsMini } from '@/lib/queries/projects'
import { ProjectCell } from '@/components/requests/ProjectCell'
import { CommentForm } from '@/components/requests/CommentForm'
import { AttachmentChips } from '@/components/requests/AttachmentChips'
import { RequestDetailTabs } from '@/components/requests/RequestDetailTabs'
import { RequestActionBar } from '@/components/requests/RequestActionBar'
import { ApprovalRejectedReopenBanner } from '@/components/requests/ApprovalRejectedReopenBanner'
import { getActiveTimer } from '@/lib/actions/requests'
import { filterFieldsForRequester, filterFlatFieldsForRequester } from '@/lib/forms/sections'
import { formatRelativeTime, formatDateTime } from '@/lib/utils'
import { STATUS_LABELS, TERMINAL_STATUSES } from '@/lib/constants/requests'
import type {
  RequestStatus,
  ActivityAction,
  RequestActivityWithActor,
  RequestCommentWithAuthor,
  RequestAttachmentWithUploader,
  FormField,
  FormSection,
} from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

// ── Activity labels ────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<ActivityAction, string> = {
  created:            'submitted this request',
  assigned:           'assigned this request',
  unassigned:         'unassigned this request',
  status_changed:     'updated the status',
  priority_changed:   'updated the priority',
  resolved:           'resolved this request',
  closed:             'closed this request',
  reopened:           'reopened this request',
  cancelled:          'cancelled this request',
  approval_requested: 'requested approval',
  approved:           'approved this request',
  rejected:           'rejected this request',
  comment_added:      'left a comment',
  attachment_added:   'attached a file',
  collaborator_added:   'added a collaborator',
  collaborator_removed: 'removed a collaborator',
  reclassified:         'corrected the service classification',
  form_data_updated:    'updated the submitted information',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m'
  const days  = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const mins  = Math.floor((ms % 3_600_000)  / 60_000)
  if (days  > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TicketCell({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={['flex flex-col gap-0.5 px-4 py-2', className].filter(Boolean).join(' ')}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="text-xs font-medium text-foreground">{value}</div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub: string
  highlight?: 'red'
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-bold tabular-nums ${
          highlight === 'red' ? 'text-red-600' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}

function CommentBubble({
  comment,
  attachments,
  currentUserId,
  canManageAll,
}: {
  comment: RequestCommentWithAuthor
  attachments: RequestAttachmentWithUploader[]
  currentUserId: string
  canManageAll: boolean
}) {
  const initial = comment.author.full_name.charAt(0).toUpperCase()
  return (
    <div
      className={`rounded-xl p-4 ${
        comment.is_internal
          ? 'border border-amber-200 bg-amber-50/60'
          : 'border border-border bg-card'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            comment.is_internal
              ? 'bg-amber-100 text-amber-700'
              : 'bg-primary/10 text-primary'
          }`}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          {/* Row 1: author name + absolute timestamp */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">
              {comment.author.full_name}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/70">
              {formatDateTime(comment.created_at)}
            </span>
          </div>
          {/* Row 2: badge + relative timestamp */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {comment.is_internal ? (
              <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <Lock className="h-2.5 w-2.5" />
                Internal Note
              </span>
            ) : (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                Public
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(comment.created_at)}
            </span>
          </div>
          {comment.body.trim() && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {comment.body.split(/(@\w+)/g).map((part, i) =>
                /^@\w+$/.test(part) ? (
                  <span key={i} className="font-semibold text-primary">{part}</span>
                ) : part
              )}
            </p>
          )}
          {attachments.length > 0 && (
            <div className="mt-2">
              <AttachmentChips attachments={attachments} currentUserId={currentUserId} canManageAll={canManageAll} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Approval send/approve/reject events surfaced inline in the conversation
// thread (in addition to the full History tab) so requesters/technicians
// don't have to switch tabs to see who a ticket was sent to and what was
// decided.
function ApprovalEventCard({ item }: { item: RequestActivityWithActor }) {
  const actor = item.actor?.full_name ?? 'System'

  if (item.action === 'approval_requested') {
    const m = item.metadata as { approver_names?: string[] } | null
    const names = m?.approver_names?.length ? m.approver_names.join(', ') : 'the approver'
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-800">
        <Clock className="mt-px h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          <span className="font-semibold">{actor}</span> sent this request for approval to{' '}
          <span className="font-semibold">{names}</span>
        </span>
        <span className="ml-auto flex shrink-0 flex-col items-end text-[10px] text-amber-700/70">
          <span>{formatRelativeTime(item.created_at)}</span>
          <span className="text-amber-700/50">{formatDateTime(item.created_at)}</span>
        </span>
      </div>
    )
  }

  const approved = item.action === 'approved'
  const m = item.metadata as { comment?: string } | null
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-4 py-2.5 text-xs ${
        approved ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-red-200 bg-red-50/60 text-red-800'
      }`}
    >
      <span className="mt-px shrink-0">{approved ? '✓' : '✕'}</span>
      <div className="flex-1 min-w-0">
        <span>
          <span className="font-semibold">{actor}</span> {approved ? 'approved' : 'rejected'} this request
        </span>
        {m?.comment && <p className="mt-0.5 text-[11px] opacity-90">{m.comment}</p>}
      </div>
      <span className="ml-auto flex shrink-0 flex-col items-end text-[10px] opacity-70">
        <span>{formatRelativeTime(item.created_at)}</span>
        <span className="opacity-70">{formatDateTime(item.created_at)}</span>
      </span>
    </div>
  )
}

function HistoryRow({ item }: { item: RequestActivityWithActor }) {
  const actor = item.actor?.full_name ?? 'System'
  const label = ACTION_LABELS[item.action] ?? item.action

  let detail: string | null = null
  if (item.action === 'status_changed' && item.metadata) {
    const m = item.metadata as { from?: string; to?: string }
    if (m.from && m.to) {
      detail = `${STATUS_LABELS[m.from as RequestStatus] ?? m.from} → ${STATUS_LABELS[m.to as RequestStatus] ?? m.to}`
    }
  }
  if (item.action === 'priority_changed' && item.metadata) {
    const m = item.metadata as { priority_from?: string; priority_to?: string }
    if (m.priority_from && m.priority_to) {
      detail = `${m.priority_from} → ${m.priority_to}`
    }
  }
  if (item.action === 'attachment_added' && item.metadata) {
    const m = item.metadata as { file_name?: string }
    if (m.file_name) detail = m.file_name
  }
  if (item.action === 'approval_requested' && item.metadata) {
    const m = item.metadata as { approver_names?: string[] }
    if (m.approver_names?.length) detail = `Sent to ${m.approver_names.join(', ')}`
  }
  if ((item.action === 'approved' || item.action === 'rejected') && item.metadata) {
    const m = item.metadata as { comment?: string }
    if (m.comment) detail = m.comment
  }
  if (
    (item.action === 'collaborator_added' || item.action === 'collaborator_removed') &&
    item.metadata
  ) {
    const m = item.metadata as { collaborator_name?: string }
    if (m.collaborator_name) detail = m.collaborator_name
  }

  return (
    <div className="flex items-start gap-4 border-b border-border py-2 last:border-0">
      <div className="w-28 shrink-0 space-y-0.5">
        <p className="text-xs font-medium text-foreground">
          {new Date(item.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {new Date(item.created_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{actor}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {detail && (
          <span className="mt-1 inline-block rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function RequestDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { from } = await searchParams

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  // Sends the breadcrumb back to wherever the ticket was opened from (e.g.
  // Agent Requests vs. My Requests) instead of always defaulting to My
  // Requests — only trust an internal relative path, never an absolute/
  // protocol-relative URL a caller could smuggle in via the query string.
  const backHref = from && from.startsWith('/') && !from.startsWith('//') ? from : '/requests'
  const backLabel = backHref.startsWith('/requests/queue') ? 'Agent Requests' : 'Requests'

  // Phase 1: everything that only needs `id` runs in parallel.
  // teamMembers and csatSurvey are gated on request data so they stay in Phase 2.
  const [request, activity, comments, attachments, collaborators, approvals, linkedTasks, activeTimer, relatedRequests, allProjects] = await Promise.all([
    getRequestById(id),
    getRequestActivity(id),
    getRequestComments(id),
    getRequestAttachments(id),
    getRequestCollaborators(id),
    getApprovalsForRequest(id),
    getTasksForRequest(id),
    getActiveTimer(id),
    getRelatedRequests(id),
    getAllProjectsMini(),
  ])

  if (!request) notFound()

  const linkedProject = allProjects.find((p) => p.id === (request as { project_id?: string | null }).project_id) ?? null

  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))
  const isRequester = request.requester_id === profile.id
  const canManage   = isAgent
  const isManager   = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'
  // Tasks is Admin/Owner-only for now (see components/layout/Sidebar.tsx) — a
  // linked task here would otherwise deep-link to /tasks, which redirects any
  // other role straight back to /home.
  const isAdmin     = profile.role === 'admin' || profile.role === 'platform_owner'
  const isTerminal  = TERMINAL_STATUSES.includes(request.status)

  // Phase 2: only the queries that depend on request data (or are agent-only).
  const [teamMembers, csatSurvey, reclassifyOptions, allowedSubCategories] = await Promise.all([
    canManage ? getTeamMembers(request.team_id) : Promise.resolve([]),
    isRequester ? getCsatSurveyForRequest(id) : Promise.resolve(null),
    canManage ? getActiveServicesForReclassify() : Promise.resolve([]),
    canManage ? getAllowedSubCategoriesForService(request.service_id) : Promise.resolve([]),
  ])

  // Show Approvals tab if the service has a predefined workflow OR any ad-hoc approval was sent
  const hasApprovalWorkflow = Boolean(
    (request.service as { approval_workflow_id?: string | null }).approval_workflow_id
  ) || approvals.length > 0

  const formSchemaRaw = Array.isArray(request.form_schema_snapshot)
    ? (request.form_schema_snapshot as unknown as FormField[])
    : []
  const formSectionsRaw = Array.isArray(request.form_sections_snapshot)
    ? (request.form_sections_snapshot as unknown as FormSection[])
    : []
  // A requester never sees a technician-only (requester_can_view === false)
  // field, on the create form or here when revisiting their own request —
  // an agent viewer sees everything, including the fields the requester can't.
  const formSchema   = isAgent ? formSchemaRaw   : filterFlatFieldsForRequester(formSchemaRaw)
  const formSections = isAgent ? formSectionsRaw : filterFieldsForRequester(formSectionsRaw)
  const formData = (request.form_data ?? {}) as Record<string, unknown>

  // Server-side time calculations (server component — Date.now() is intentional)
  // eslint-disable-next-line react-hooks/purity
  const nowMs           = Date.now()
  const createdMs       = new Date(request.created_at).getTime()
  const updatedMs       = new Date(request.updated_at).getTime()
  const elapsedMs       = nowMs - createdMs
  const responseDueMs   = request.response_due_at
    ? new Date(request.response_due_at).getTime() - nowMs
    : null
  const resolutionDueMs = request.resolution_due_at
    ? new Date(request.resolution_due_at).getTime() - nowMs
    : null

  // ── Tab: Conversations ──────────────────────────────────────────────────────
  // Attachments live inside the conversation, grouped by the reply they were sent
  // with — no separate top-of-thread attachments block. Files with no comment_id
  // were uploaded at request-submission time (a file-type intake field, before any
  // comment existed) and render as part of a "request submitted" card at the very
  // end of the (now latest-first) list, since that's the oldest event in the thread.
  const attachmentsByComment = new Map<string, RequestAttachmentWithUploader[]>()
  const submissionAttachments: RequestAttachmentWithUploader[] = []
  for (const att of attachments) {
    const commentId = (att as RequestAttachmentWithUploader & { comment_id: string | null }).comment_id
    if (commentId) {
      const list = attachmentsByComment.get(commentId) ?? []
      list.push(att)
      attachmentsByComment.set(commentId, list)
    } else {
      submissionAttachments.push(att)
    }
  }

  // Approval send/decision events are interleaved into the conversation thread
  // (alongside the full record on the History tab) so the "sent for approval
  // to X" / "approved by X" / "rejected by X" moments show up where people are
  // already reading, not just in a separate tab.
  const approvalEvents = activity.filter(
    (item) => item.action === 'approval_requested' || item.action === 'approved' || item.action === 'rejected'
  )
  const conversationEvents: ({ kind: 'comment'; created_at: string; comment: RequestCommentWithAuthor } | { kind: 'approval'; created_at: string; item: RequestActivityWithActor })[] = [
    ...comments.map((comment) => ({ kind: 'comment' as const, created_at: comment.created_at, comment })),
    ...approvalEvents.map((item) => ({ kind: 'approval' as const, created_at: item.created_at, item })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at))

  const conversationsTab = (
    <div className="flex flex-col" style={{ minHeight: '480px', maxHeight: '70vh' }}>
      {/* Scrollable message thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {request.status === 'waiting_user' && isRequester && !isAgent && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
            <p className="text-sm font-semibold text-orange-900">Action needed</p>
            <p className="mt-0.5 text-xs text-orange-700">
              The team is waiting for your response. Add a reply below to continue.
            </p>
          </div>
        )}

        {conversationEvents.length === 0 && submissionAttachments.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No messages yet.</p>
            {!isTerminal && (
              <p className="mt-1 text-xs text-muted-foreground">
                Add a reply below to start the conversation.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {conversationEvents.map((event) =>
              event.kind === 'comment' ? (
                <CommentBubble
                  key={event.comment.id}
                  comment={event.comment}
                  attachments={attachmentsByComment.get(event.comment.id) ?? []}
                  currentUserId={profile.id}
                  canManageAll={isAgent}
                />
              ) : (
                <ApprovalEventCard key={event.item.id} item={event.item} />
              )
            )}
            {submissionAttachments.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  Attached when the request was submitted
                </p>
                <AttachmentChips
                  attachments={submissionAttachments}
                  currentUserId={profile.id}
                  canManageAll={isAgent}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pinned reply composer */}
      {!isTerminal ? (
        <div className="shrink-0 border-t border-border bg-card px-4 py-3 space-y-3">
          <CommentForm requestId={request.id} canPostInternal={isAgent} />
        </div>
      ) : (
        <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-2.5 text-center">
          <p className="text-xs text-muted-foreground">This request is closed — no further replies can be added.</p>
        </div>
      )}
    </div>
  )

  // ── Tab: Details ────────────────────────────────────────────────────────────
  const detailsTab = (
    <div className="space-y-4">
      {(formSections.length > 0 || formSchema.length > 0) && (
        <SubmittedDataPanel
          requestId={request.id}
          sections={formSections}
          legacySchema={formSchema}
          data={formData}
          canEdit={canManage}
        />
      )}

      {request.description && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {request.description}
          </p>
        </div>
      )}

      {/* ── Ticket Details ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ticket Details
        </h3>
        <div className="rounded-lg border border-border grid grid-cols-2 divide-x divide-border overflow-hidden">
          <TicketCell label="Service"     value={request.service.name} />
          <TicketCell label="Team"        value={request.team.name} />
          <TicketCell label="Requester"   value={request.requester.full_name} className="border-t border-border" />
          <TicketCell
            label="Status"
            value={<StatusBadge status={request.status} size="sm" />}
            className="border-t border-border"
          />
          <TicketCell
            label="Priority"
            value={<PriorityBadge priority={request.priority} size="sm" />}
            className="border-t border-border"
          />
          <TicketCell
            label="Source"
            value={<SourceBadge sourceMetadata={request.source_metadata} size="sm" />}
            className="border-t border-border"
          />
          {request.assignee && (
            <TicketCell label="Technician" value={request.assignee.full_name} className="border-t border-border" />
          )}
          <TicketCell
            label="Project"
            value={<ProjectCell requestId={request.id} value={linkedProject} allProjects={allProjects} />}
            className={`border-t border-border${request.assignee ? '' : ' col-span-2'}`}
          />
        </div>
      </div>

      {/* ── Ticket Cycle Status ── */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ticket Cycle Status
        </h3>
        <div className="rounded-lg border border-border grid grid-cols-2 divide-x divide-border overflow-hidden">
          <TicketCell
            label="Created"
            value={formatDateTime(request.created_at)}
          />
          <TicketCell label="Last Updated" value={formatRelativeTime(request.updated_at)} />
          <TicketCell
            label="Responded Time"
            className="border-t border-border"
            value={request.responded_at ? formatDateTime(request.responded_at) : 'Not yet responded'}
          />
          <TicketCell
            label="Completed Time"
            className="border-t border-border"
            value={
              request.resolved_at ?? request.closed_at
                ? formatDateTime((request.resolved_at ?? request.closed_at)!)
                : 'Not yet completed'
            }
          />
          {request.resolution_due_at && (
            <TicketCell
              label="Resolution Due"
              className="border-t border-border"
              value={
                <SLABadge
                  resolutionDueAt={request.resolution_due_at}
                  responseDueAt={request.response_due_at}
                  status={request.status}
                />
              }
            />
          )}
          {request.response_due_at && (
            <TicketCell
              label="Response Due"
              className="border-t border-border"
              value={formatDateTime(request.response_due_at)}
            />
          )}
        </div>
      </div>
    </div>
  )

  // ── Tab: Approvals ──────────────────────────────────────────────────────────
  const approvalsTab = approvals.length > 0 ? (
    <div className="space-y-4">
      {approvals.map((a, idx) => (
        <div key={a.id}>
          {approvals.length > 1 && (
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Round {approvals.length - idx}
              {idx === 0 && ' · Latest'}
            </p>
          )}
          <ApprovalPanel
            approval={a}
            viewerId={profile.id}
            viewerRole={profile.role}
          />
        </div>
      ))}
    </div>
  ) : (
    <div className="rounded-xl border border-border bg-muted/10 py-14 text-center">
      <p className="text-sm text-muted-foreground">No approval workflow attached to this request.</p>
    </div>
  )

  // ── Tab: Time Elapsed ───────────────────────────────────────────────────────
  const timeElapsedTab = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Life of Request"
          value={formatDuration(elapsedMs)}
          sub="Total elapsed"
        />
        <MetricCard
          label="Last Updated"
          value={formatDuration(nowMs - updatedMs)}
          sub="ago"
        />
        <MetricCard
          label="Response Time"
          value={
            responseDueMs == null
              ? '—'
              : responseDueMs > 0
              ? formatDuration(responseDueMs)
              : 'Overdue'
          }
          sub={
            request.response_due_at
              ? responseDueMs != null && responseDueMs > 0
                ? 'remaining'
                : new Date(request.response_due_at).toLocaleDateString()
              : 'Not set'
          }
          highlight={responseDueMs != null && responseDueMs < 0 ? 'red' : undefined}
        />
        <MetricCard
          label="Resolution Time"
          value={
            resolutionDueMs == null
              ? '—'
              : resolutionDueMs > 0
              ? formatDuration(resolutionDueMs)
              : 'Overdue'
          }
          sub={
            request.resolution_due_at
              ? resolutionDueMs != null && resolutionDueMs > 0
                ? 'remaining'
                : new Date(request.resolution_due_at).toLocaleDateString()
              : 'Not set'
          }
          highlight={resolutionDueMs != null && resolutionDueMs < 0 ? 'red' : undefined}
        />
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          SLA Status
        </h3>
        <div className="rounded-lg border border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <SLABadge
                resolutionDueAt={request.resolution_due_at}
                responseDueAt={request.response_due_at}
                status={request.status}
                showLabel
              />
            </div>
            {request.resolution_due_at && (
              <span className="text-xs text-muted-foreground">
                Due{' '}
                {new Date(request.resolution_due_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {request.resolution_due_at && (() => {
        const dueMs = new Date(request.resolution_due_at).getTime()
        const total = dueMs - createdMs
        const pct   = total > 0 ? Math.min(100, Math.round((elapsedMs / total) * 100)) : 100
        return (
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Progress
            </h3>
            <div className="rounded-lg border border-border px-4 py-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {new Date(request.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className="font-semibold text-foreground">{pct}% elapsed</span>
                <span>
                  {new Date(request.resolution_due_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )

  // ── Tab: History ────────────────────────────────────────────────────────────
  const historyTab = (
    <div>
      {activity.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No history yet.</p>
        </div>
      ) : (
        <div>
          {[...activity]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
        </div>
      )}
    </div>
  )

  // ── Right sidebar ───────────────────────────────────────────────────────────
  const sidebar = (
    <div className="space-y-3">
      <RequestSidebarPanel
        requestId={request.id}
        requestNo={request.request_no}
        status={request.status}
        priority={request.priority}
        assigneeId={request.assigned_to}
        assigneeName={request.assignee?.full_name ?? null}
        teamName={request.team.name}
        serviceId={request.service_id}
        serviceName={request.service.name}
        categoryName={request.category?.name ?? null}
        subCategoryId={request.sub_category?.id ?? null}
        subCategoryName={request.sub_category?.name ?? null}
        reclassifyOptions={reclassifyOptions}
        allowedSubCategories={allowedSubCategories}
        requesterId={request.requester_id}
        requesterName={request.requester.full_name}
        resolutionDueAt={request.resolution_due_at}
        responseDueAt={request.response_due_at}
        createdAt={request.created_at}
        updatedAt={request.updated_at}
        teamId={request.team_id}
        viewerId={profile.id}
        isAgent={isAgent}
        isManager={isManager}
        isRequester={isRequester}
        isTerminal={isTerminal}
        teamMembers={teamMembers}
        initialCollaborators={collaborators}
        formSections={formSections}
        formSchema={formSchema}
        formData={formData}
      />
      <RelatedRequestsPanel
        requestId={request.id}
        initialRelated={relatedRequests}
        canManage={canManage}
      />
      {csatSurvey && isRequester && (
        <CsatSurvey
          surveyId={csatSurvey.id}
          initialRating={csatSurvey.rating}
          initialComment={csatSurvey.comment}
          submitted={csatSurvey.submitted_at !== null}
        />
      )}
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link
          href={backHref}
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground">{request.request_no}</span>
      </nav>

      {isRequester && request.status === 'cancelled' && request.cancellation_reason === 'approval_rejected' && request.reopen_deadline_at && (
        <ApprovalRejectedReopenBanner requestId={request.id} reopenDeadlineAt={request.reopen_deadline_at} />
      )}

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        {/* Action bar row */}
        <div className="mb-3 flex items-center justify-between gap-3">
          {/* Left: title meta */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={request.status} />
            <ReopenedBadge count={request.reopen_count ?? 0} />
            <PriorityBadge priority={request.priority} />
            <SourceBadge sourceMetadata={request.source_metadata} />
            <SLABadge
              resolutionDueAt={request.resolution_due_at}
              responseDueAt={request.response_due_at}
              status={request.status}
              showLabel
            />
          </div>
          {/* Right: action buttons */}
          <RequestActionBar
            requestId={request.id}
            viewerId={profile.id}
            isAgent={isAgent}
            isManager={isManager}
            isAssignedToViewer={request.assigned_to === profile.id}
            isTerminal={isTerminal}
            status={request.status}
            activeTimer={activeTimer}
            responseDueAt={request.response_due_at}
            resolutionDueAt={request.resolution_due_at}
            respondedAt={request.responded_at}
            resolvedAt={request.resolved_at}
            waitingSince={request.waiting_since}
          />
        </div>

        <h1 className="text-xl font-bold tracking-tight text-foreground">
          {request.title}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono">{request.request_no}</span>
          <span className="mx-1.5 opacity-40">·</span>
          Requested by{' '}
          <span className="font-medium text-foreground">
            {request.requester.full_name}
          </span>
          <span className="mx-1.5 opacity-40">·</span>
          {formatRelativeTime(request.created_at)}
        </p>

        {/* Task progress bar — only shown when tasks are linked */}
        {linkedTasks.length > 0 && (() => {
          const activeTasks = linkedTasks.filter((t) => t.status !== 'cancelled')
          const doneTasks   = linkedTasks.filter((t) => t.status === 'done').length
          const pct         = activeTasks.length > 0 ? Math.round((doneTasks / activeTasks.length) * 100) : 0
          return (
            <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
              <span className="shrink-0 text-xs text-muted-foreground">Tasks</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{doneTasks}/{activeTasks.length}</span>
            </div>
          )
        })()}
      </div>

      {/* Tabs + sidebar */}
      <RequestDetailTabs
        conversations={conversationsTab}
        details={detailsTab}
        tasks={
          <RequestTasksTab
            requestId={request.id}
            requestNo={request.request_no}
            requestTitle={request.title}
            teamId={request.team_id}
            initialTasks={linkedTasks}
            canManage={canManage}
            canOpenTask={isAdmin}
          />
        }
        approvals={approvalsTab}
        timeElapsed={timeElapsedTab}
        history={historyTab}
        sidebar={sidebar}
        commentCount={comments.length}
        activityCount={activity.length}
        taskCount={linkedTasks.length}
        showApprovals={hasApprovalWorkflow}
      />
    </div>
  )
}
