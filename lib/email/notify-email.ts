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
} from './templates'

export async function sendNotificationEmail(opts: {
  type: string
  recipientEmail: string
  recipientName: string
  data: Record<string, string>
}): Promise<void> {
  try {
    const { type, recipientEmail, recipientName, data } = opts

    let template: { subject: string; html: string; text: string } | null = null

    switch (type) {
      case 'request_created':
        template = requestCreatedEmail({
          requesterName: recipientName || data.requesterName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          serviceName: data.serviceName || '',
        })
        break
      case 'status_changed':
      case 'request_reopened':
        template = requestStatusChangedEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          oldStatus: data.oldStatus || '',
          newStatus: data.newStatus || '',
        })
        break
      case 'comment_added':
      case 'internal_note_added':
        template = commentAddedEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
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
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          requesterName: data.requesterName || '',
        })
        break
      case 'sla_warning':
      case 'sla_breached':
        template = slaBreachEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          slaDeadline: data.slaDeadline || '',
          tier: data.tier || '',
        })
        break
      case 'request_assigned':
      case 'request_reassigned':
      case 'request_unassigned':
        template = requestAssignedEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          assignerName: data.assignerName || data.actorName || '',
        })
        break
      case 'approval_approved':
        template = approvalDecisionEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          decision: 'approved',
          reason: data.reason || undefined,
        })
        break
      case 'approval_rejected':
        template = approvalDecisionEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          decision: 'rejected',
          reason: data.reason || undefined,
        })
        break
      case 'collaborator_added':
      case 'collaborator_removed':
        template = requestStatusChangedEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          oldStatus: '',
          newStatus: type === 'collaborator_added' ? 'collaborator added' : 'collaborator removed',
        })
        break
      case 'mentioned':
        template = commentAddedEmail({
          recipientName: recipientName || '',
          requestTitle: data.requestTitle || data.title || '',
          requestUrl: data.requestUrl || data.link || '',
          commenterName: data.commenterName || data.actorName || '',
          commentBody: data.commentBody || data.body || '',
        })
        break
      default:
        return
    }

    if (!template) return

    await sendEmail({
      to: recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    })
  } catch {
    // never throw
  }
}
