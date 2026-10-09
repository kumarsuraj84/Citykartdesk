// What goes into the "Download PDF" of one ticket, worked out from the ticket's data as the viewer is allowed to see it.
// Pure (no database, no PDF library) so the rules are easy to test:
//   - internal notes are never included, for anyone (and neither are internal attachments);
//   - a requester does not get fields marked technician-only;
//   - attachments are listed by name only (no file contents or pictures).

import { STATUS_LABELS, PRIORITY_LABELS } from '@/lib/constants/requests'
import { filterFlatFieldsForRequester, filterFieldsForRequester } from '@/lib/forms/sections'
import type { FormField, FormSection, RequestWithRelations, RequestCommentWithAuthor, RequestActivityWithActor, RequestAttachmentWithUploader } from '@/types'

const TIME_ZONE = 'Asia/Kolkata'

export const pdfDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '-'

const fileSize = (bytes: number | null | undefined) => {
  const n = bytes ?? 0
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export interface PdfApproval {
  title: string
  status: string
  decisions: { step: number; by: string; decision: string; at: string; comment: string }[]
  waitingOn: string
}

export interface TicketPdfModel {
  requestNo: string
  title: string
  status: string
  priority: string
  generatedAt: string
  generatedBy: string
  details: { label: string; value: string }[]
  /** the requester's answers to the request form (the description is shown separately) */
  submitted: { label: string; value: string }[]
  description: string
  conversation: { id: string; author: string; at: string; body: string; via: string }[]
  approvals: PdfApproval[]
  history: { at: string; text: string; by: string; note: string }[]
  attachments: { name: string; size: string; by: string; at: string }[]
  csat: { rating: number; comment: string } | null
}

export interface TicketPdfInput {
  request: RequestWithRelations
  comments: RequestCommentWithAuthor[]
  activity: RequestActivityWithActor[]
  attachments: RequestAttachmentWithUploader[]
  approvals: {
    status: string
    created_at: string
    workflow: { name: string } | null
    steps: { step_order: number; approver_type?: string | null; approver?: { full_name: string } | null }[]
    decisions: { step_order: number; decision: string; comment: string | null; decided_at: string; decider?: { full_name: string } | null }[]
  }[]
  csat: { rating: number | null; comment: string | null } | null
  viewer: { name: string; isAgent: boolean }
  now?: Date
}

function displayValue(field: FormField, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '-'
  if (field.type === 'checkbox') return raw ? 'Yes' : 'No'
  if (field.type === 'multiselect' && Array.isArray(raw)) {
    const labels = (raw as string[]).map((v) => field.options?.find((o) => o.value === v)?.label ?? v)
    return labels.length > 0 ? labels.join(', ') : '-'
  }
  if (field.type === 'select' || field.type === 'radio') return field.options?.find((o) => o.value === String(raw))?.label ?? String(raw)
  return String(raw)
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\r\n?/g, '\n').trim()

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const label = (map: Record<string, string>, k: string) => map[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** One line of the history for an activity row, or null for rows that are not part of it (comments are in the conversation). */
function historyLine(a: RequestActivityWithActor): { text: string; note: string } | null {
  const m = (a.metadata ?? {}) as Record<string, unknown>
  switch (a.action) {
    case 'comment_added': {
      // a comment is in the conversation already; only the line saying it was copied by e-mail belongs in the history
      const cc = Array.isArray(m.cc) ? (m.cc as { name?: string }[]).map((x) => x.name).filter(Boolean) : []
      return cc.length > 0 ? { text: `Comment copied by e-mail to ${cc.join(', ')}`, note: '' } : null
    }
    case 'attachment_added':
      return null
    case 'created': return { text: 'Request submitted', note: '' }
    case 'assigned': return { text: 'Assigned to a technician', note: str(m.reason) }
    case 'unassigned': return { text: 'Unassigned', note: str(m.reason) }
    case 'status_changed': return { text: `Status: ${label(STATUS_LABELS, str(m.from))} to ${label(STATUS_LABELS, str(m.to))}`, note: str(m.remark) }
    case 'priority_changed': return { text: `Priority: ${label(PRIORITY_LABELS, str(m.priority_from))} to ${label(PRIORITY_LABELS, str(m.priority_to))}`, note: '' }
    case 'resolved': return { text: 'Resolved', note: str(m.remark) }
    case 'closed': return { text: 'Closed', note: '' }
    case 'reopened': return { text: 'Reopened', note: str(m.reason) }
    case 'cancelled': return { text: 'Cancelled', note: '' }
    case 'approval_requested': return { text: 'Sent for approval', note: '' }
    case 'approved': return { text: 'Approved', note: '' }
    case 'rejected': return { text: 'Rejected', note: '' }
    case 'reclassified': return { text: 'Service classification corrected', note: '' }
    case 'form_data_updated': return { text: 'Submitted information updated', note: '' }
    case 'collaborator_added': return { text: 'Collaborator added', note: '' }
    case 'collaborator_removed': return { text: 'Collaborator removed', note: '' }
    default: return { text: label({}, String(a.action)), note: '' }
  }
}

export function buildTicketPdfModel(input: TicketPdfInput): TicketPdfModel {
  const { request: r, viewer } = input
  const now = input.now ?? new Date()

  // the form the requester filled in; a requester never sees technician-only fields
  const rawSections = Array.isArray(r.form_sections_snapshot) ? (r.form_sections_snapshot as unknown as FormSection[]) : []
  const rawSchema = Array.isArray(r.form_schema_snapshot) ? (r.form_schema_snapshot as unknown as FormField[]) : []
  const sections = viewer.isAgent ? rawSections : filterFieldsForRequester(rawSections)
  const schema = viewer.isAgent ? rawSchema : filterFlatFieldsForRequester(rawSchema)
  const fields: FormField[] = sections.length > 0
    ? [...sections].sort((a, b) => a.order - b.order).flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))
    : [...schema].sort((a, b) => a.order - b.order)
  const data = (r.form_data ?? {}) as Record<string, unknown>
  const descriptionField = fields.find((f) => f.type === 'textarea')
  const description = clean(descriptionField ? String(data[descriptionField.id] ?? '') : '') || clean(r.description)
  const submitted = fields
    .filter((f) => f.type !== 'file' && f.id !== descriptionField?.id)
    .map((f) => ({ label: f.label, value: displayValue(f, data[f.id]) }))

  const via = (r.source_metadata as { created_via?: string } | null)?.created_via
  const source = via ? via.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Portal'
  const details: { label: string; value: string }[] = [
    { label: 'Status', value: label(STATUS_LABELS, r.status) },
    { label: 'Priority', value: label(PRIORITY_LABELS, r.priority) },
    { label: 'Raised via', value: source },
    { label: 'Created', value: pdfDateTime(r.created_at) },
    { label: 'Requester', value: r.requester?.full_name ?? '-' },
    { label: 'Technician', value: r.assignee?.full_name ?? 'Unassigned' },
    { label: 'Technician group', value: r.team?.name ?? '-' },
    { label: 'Service', value: r.service?.name ?? '-' },
    { label: 'Category', value: [r.category?.name, r.sub_category?.name].filter(Boolean).join(' > ') || '-' },
    { label: 'First response due', value: pdfDateTime(r.response_due_at) },
    { label: 'First responded', value: pdfDateTime(r.responded_at) },
    { label: 'Resolution due', value: pdfDateTime(r.resolution_due_at) },
    { label: 'Resolved', value: pdfDateTime(r.resolved_at) },
    ...(r.closed_at ? [{ label: 'Closed', value: pdfDateTime(r.closed_at) }] : []),
    ...((r.reopen_count ?? 0) > 0 ? [{ label: 'Times reopened', value: String(r.reopen_count) }] : []),
  ]

  const conversation = input.comments
    .filter((c) => !c.is_internal)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((c) => ({
      id: c.id,
      author: c.author?.full_name ?? c.external_name ?? 'Unknown sender',
      at: pdfDateTime(c.created_at),
      body: clean(c.body),
      via: c.source && c.source !== 'portal' ? `via ${String(c.source).replace(/[_-]+/g, ' ')}` : '',
    }))

  const approvals: PdfApproval[] = input.approvals.map((a) => {
    const decided = new Set(a.decisions.map((d) => d.step_order))
    const next = [...a.steps].sort((x, y) => x.step_order - y.step_order).find((s) => !decided.has(s.step_order))
    return {
      title: a.workflow?.name ?? 'Approval',
      status: label({}, a.status),
      decisions: a.decisions.map((d) => ({ step: d.step_order, by: d.decider?.full_name ?? 'Approver', decision: label({}, d.decision), at: pdfDateTime(d.decided_at), comment: clean(d.comment) })),
      waitingOn: a.status === 'pending' ? (next?.approver?.full_name ?? (next?.approver_type ? label({}, next.approver_type) : '')) : '',
    }
  })

  const history = input.activity
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .flatMap((a) => { const l = historyLine(a); return l ? [{ at: pdfDateTime(a.created_at), text: l.text, by: a.actor?.full_name ?? 'System', note: l.note }] : [] })

  const attachments = input.attachments
    .filter((x) => !x.is_internal && !x.deleted_at)
    .map((x) => ({ name: x.file_name, size: fileSize(x.file_size), by: x.uploader?.full_name ?? '', at: pdfDateTime(x.uploaded_at) }))

  return {
    requestNo: r.request_no,
    title: r.title,
    status: label(STATUS_LABELS, r.status),
    priority: label(PRIORITY_LABELS, r.priority),
    generatedAt: pdfDateTime(now.toISOString()),
    generatedBy: viewer.name,
    details,
    submitted,
    description,
    conversation,
    approvals,
    history,
    attachments,
    csat: input.csat && input.csat.rating ? { rating: input.csat.rating, comment: clean(input.csat.comment) } : null,
  }
}

export function ticketPdfFileName(requestNo: string): string {
  return `${requestNo.replace(/[^A-Za-z0-9_-]/g, '') || 'ticket'}.pdf`
}
