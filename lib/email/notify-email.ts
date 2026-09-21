import { sendEmail } from './send'
import {
  requestCreatedEmail,
  requestStatusChangedEmail,
  commentAddedEmail,
  taskAssignedEmail,
  approvalRequiredEmail,
  slaBreachEmail,
  requestAssignedEmail,
  approvalDecisionEmail,
  requestEventEmail,
} from './templates'

/** Links inside a notification are app-relative ("/requests/123"); an email needs the full address. */
export function absoluteAppUrl(link: string | undefined): string {
  if (!link) return ''
  if (/^https?:\/\//i.test(link)) return link
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  return link.startsWith('/') ? `${base}${link}` : link
}

// Events whose only email is the generic "your request ..." message.
const SIMPLE_REQUEST_EVENTS: Record<string, string> = {
  request_resolved: 'Request resolved',
  request_closed: 'Request closed',
  request_cancelled: 'Request cancelled',
  request_auto_closed: 'Request closed automatically',
  priority_changed: 'Priority changed',
}

export async function sendNotificationEmail(opts: {
  type: string
  recipientEmail: string
  recipientName: string
  data: Record<string, string>
}): Promise<{ error?: string; skipped?: boolean }> {
  try {
    const { type, recipientEmail, data: rawData } = opts
    const recipientName = opts.recipientName || 'there'
    // Show the ticket number ("CKSD-000123 — title") whenever the caller supplied it.
    const withNo = (t: string) => (rawData.requestNo ? `${rawData.requestNo} — ${t}` : t)
    const link = absoluteAppUrl(rawData.requestUrl || rawData.taskUrl || rawData.link)
    const data: Record<string, string> = { ...rawData, requestUrl: link, taskUrl: rawData.taskUrl ? absoluteAppUrl(rawData.taskUrl) : link, link }

    let template: { subject: string; html: string; text: string } | null = null

    switch (type) {
      case 'request_created':
        template = requestCreatedEmail({
          requesterName: recipientName || data.requesterName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          serviceName: data.serviceName || '',
        })
        break
      case 'status_changed':
      case 'request_reopened':
        template = requestStatusChangedEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          oldStatus: data.oldStatus || '',
          newStatus: data.newStatus || '',
        })
        break
      case 'comment_added':
      case 'internal_note_added':
        template = commentAddedEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          commenterName: data.commenterName || '',
          commentBody: data.commentBody || data.body || '',
        })
        break
      case 'task_assigned':
      case 'task_completed':
        template = taskAssignedEmail({
          recipientName: recipientName || '',
          taskTitle: data.taskTitle || data.title || '',
          taskUrl: data.taskUrl || data.link || '',
          assignerName: data.assignerName || '',
          dueDate: data.dueDate,
        })
        break
      // Every call site sends 'approval_requested' (see lib/actions/approvals.ts
      // and requests.ts) — this case used to read 'approval_required' and so
      // never matched, silently dropping every approval-request email.
      case 'approval_requested':
        template = approvalRequiredEmail({
          approverName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          requesterName: data.requesterName || '',
        })
        break
      case 'sla_warning':
      case 'sla_breached':
        template = slaBreachEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          slaDeadline: data.slaDeadline || '',
          tier: data.tier || '',
        })
        break
      case 'request_assigned':
      case 'request_reassigned':
      case 'request_unassigned':
        // The requester's copy says who is handling their ticket; the technician's says it is theirs.
        if (data.audience === 'requester' && data.assigneeName) {
          template = requestEventEmail({
            recipientName,
            requestTitle: withNo(data.requestTitle || data.title || ''),
            requestUrl: data.requestUrl || data.link || '',
            headline: type === 'request_reassigned' ? 'Your request was reassigned' : 'Your request has been assigned',
            detail: `${data.assigneeName} is now handling your request.`,
          })
          break
        }
        template = requestAssignedEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          assignerName: data.assignerName || data.actorName || '',
        })
        break
      case 'approval_approved':
        template = approvalDecisionEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          decision: 'approved',
          reason: data.reason || undefined,
        })
        break
      case 'approval_rejected':
        template = approvalDecisionEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          decision: 'rejected',
          reason: data.reason || undefined,
        })
        break
      case 'collaborator_added':
      case 'collaborator_removed':
        template = requestStatusChangedEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          oldStatus: '',
          newStatus: type === 'collaborator_added' ? 'collaborator added' : 'collaborator removed',
        })
        break
      case 'mentioned':
        template = commentAddedEmail({
          recipientName: recipientName || '',
          requestTitle: withNo(data.requestTitle || data.title || ''),
          requestUrl: data.requestUrl || data.link || '',
          commenterName: data.commenterName || data.actorName || '',
          commentBody: data.commentBody || data.body || '',
        })
        break
      default:
        if (type in SIMPLE_REQUEST_EVENTS) {
          template = requestEventEmail({
            recipientName,
            requestTitle: withNo(data.requestTitle || data.title || ''),
            requestUrl: data.requestUrl || data.link || '',
            headline: SIMPLE_REQUEST_EVENTS[type],
            detail: data.body || undefined,
          })
          break
        }
        return { skipped: true }
    }

    if (!template) return { skipped: true }

    const res = await sendEmail({
      to: recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    })
    return res.error ? { error: res.error } : {}
  } catch (e) {
    // never throw — but tell the caller, so failures are counted and logged
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
