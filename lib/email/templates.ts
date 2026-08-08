function layout(body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;font-family:sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:32px;">
  <div style="font-size:24px;font-weight:bold;color:#2563eb;margin-bottom:16px;">Citykart Desk</div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
  <div style="font-size:16px;color:#374151;">${body}</div>
  <div style="font-size:12px;color:#9CA3AF;margin-top:32px;">You are receiving this email because you have an account on Citykart Desk. Please do not reply to this message.</div>
</div>
</body></html>`
}

function btn(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px;">${label}</a>`
}

export function requestCreatedEmail(d: {
  requesterName: string
  requestTitle: string
  requestUrl: string
  serviceName: string
}): { subject: string; html: string; text: string } {
  const subject = `Request created: ${d.requestTitle}`
  const html = layout(`
    <p>Hi ${d.requesterName},</p>
    <p>Your request <strong>${d.requestTitle}</strong> has been submitted successfully via the <strong>${d.serviceName}</strong> service.</p>
    <p>You will be notified as it progresses.</p>
    ${btn(d.requestUrl, 'View Request')}
  `)
  const text = `Hi ${d.requesterName},\n\nYour request "${d.requestTitle}" has been submitted via ${d.serviceName}.\n\nView it here: ${d.requestUrl}`
  return { subject, html, text }
}

export function requestStatusChangedEmail(d: {
  recipientName: string
  requestTitle: string
  requestUrl: string
  oldStatus: string
  newStatus: string
}): { subject: string; html: string; text: string } {
  const subject = `Request updated: ${d.requestTitle}`
  const html = layout(`
    <p>Hi ${d.recipientName},</p>
    <p>The status of request <strong>${d.requestTitle}</strong> has changed from <strong>${d.oldStatus}</strong> to <strong>${d.newStatus}</strong>.</p>
    ${btn(d.requestUrl, 'View Request')}
  `)
  const text = `Hi ${d.recipientName},\n\nRequest "${d.requestTitle}" status changed from ${d.oldStatus} to ${d.newStatus}.\n\nView it here: ${d.requestUrl}`
  return { subject, html, text }
}

export function commentAddedEmail(d: {
  recipientName: string
  requestTitle: string
  requestUrl: string
  commenterName: string
  commentBody: string
}): { subject: string; html: string; text: string } {
  const subject = `New comment on: ${d.requestTitle}`
  const html = layout(`
    <p>Hi ${d.recipientName},</p>
    <p><strong>${d.commenterName}</strong> left a comment on request <strong>${d.requestTitle}</strong>:</p>
    <blockquote style="border-left:3px solid #e5e7eb;margin:16px 0;padding:8px 16px;color:#6B7280;">${d.commentBody}</blockquote>
    ${btn(d.requestUrl, 'View Comment')}
  `)
  const text = `Hi ${d.recipientName},\n\n${d.commenterName} commented on "${d.requestTitle}":\n\n${d.commentBody}\n\nView it here: ${d.requestUrl}`
  return { subject, html, text }
}

export function taskAssignedEmail(d: {
  recipientName: string
  taskTitle: string
  taskUrl: string
  assignerName: string
  dueDate?: string
}): { subject: string; html: string; text: string } {
  const subject = `Task assigned: ${d.taskTitle}`
  const dueLine = d.dueDate ? `<p>Due: <strong>${d.dueDate}</strong></p>` : ''
  const html = layout(`
    <p>Hi ${d.recipientName},</p>
    <p><strong>${d.assignerName}</strong> assigned you a task: <strong>${d.taskTitle}</strong>.</p>
    ${dueLine}
    ${btn(d.taskUrl, 'View Task')}
  `)
  const text = `Hi ${d.recipientName},\n\n${d.assignerName} assigned you task "${d.taskTitle}"${d.dueDate ? ` (due ${d.dueDate})` : ''}.\n\nView it here: ${d.taskUrl}`
  return { subject, html, text }
}

export function approvalRequiredEmail(d: {
  approverName: string
  requestTitle: string
  requestUrl: string
  requesterName: string
}): { subject: string; html: string; text: string } {
  const subject = `Approval required: ${d.requestTitle}`
  const html = layout(`
    <p>Hi ${d.approverName},</p>
    <p><strong>${d.requesterName}</strong> has submitted a request that requires your approval: <strong>${d.requestTitle}</strong>.</p>
    ${btn(d.requestUrl, 'Review & Approve')}
  `)
  const text = `Hi ${d.approverName},\n\n${d.requesterName} submitted "${d.requestTitle}" and it needs your approval.\n\nReview it here: ${d.requestUrl}`
  return { subject, html, text }
}

export function requestAssignedEmail(d: {
  recipientName: string
  requestTitle: string
  requestUrl: string
  assignerName: string
}): { subject: string; html: string; text: string } {
  const subject = `Request assigned to you: ${d.requestTitle}`
  const html = layout(`
    <p>Hi ${d.recipientName},</p>
    <p><strong>${d.assignerName}</strong> assigned you to a request: <strong>${d.requestTitle}</strong>.</p>
    ${btn(d.requestUrl, 'View Request')}
  `)
  const text = `Hi ${d.recipientName},\n\n${d.assignerName} assigned you to "${d.requestTitle}".\n\nView it here: ${d.requestUrl}`
  return { subject, html, text }
}

export function approvalDecisionEmail(d: {
  recipientName: string
  requestTitle: string
  requestUrl: string
  decision: 'approved' | 'rejected'
  reason?: string
}): { subject: string; html: string; text: string } {
  const approved = d.decision === 'approved'
  const subject = approved
    ? `Your request was approved: ${d.requestTitle}`
    : `Your request was not approved: ${d.requestTitle}`
  const decisionLine = approved
    ? `<p>Great news — your request <strong>${d.requestTitle}</strong> has been <strong style="color:#16a34a;">approved</strong>.</p>`
    : `<p>Unfortunately, your request <strong>${d.requestTitle}</strong> was <strong style="color:#dc2626;">not approved</strong>.</p>`
  const reasonLine = d.reason ? `<p>Reason: ${d.reason}</p>` : ''
  const html = layout(`
    <p>Hi ${d.recipientName},</p>
    ${decisionLine}
    ${reasonLine}
    ${btn(d.requestUrl, 'View Request')}
  `)
  const textDecision = approved ? 'approved' : 'not approved'
  const textReason = d.reason ? `\n\nReason: ${d.reason}` : ''
  const text = `Hi ${d.recipientName},\n\nYour request "${d.requestTitle}" was ${textDecision}.${textReason}\n\nView it here: ${d.requestUrl}`
  return { subject, html, text }
}

export function slaBreachEmail(d: {
  recipientName: string
  requestTitle: string
  requestUrl: string
  slaDeadline: string
  tier: string
}): { subject: string; html: string; text: string } {
  const subject = `SLA alert: ${d.requestTitle}`
  const html = layout(`
    <p>Hi ${d.recipientName},</p>
    <p>The <strong>${d.tier}</strong> SLA for request <strong>${d.requestTitle}</strong> is at risk.</p>
    <p>Deadline: <strong>${d.slaDeadline}</strong></p>
    <p>Please take action to avoid a breach.</p>
    ${btn(d.requestUrl, 'View Request')}
  `)
  const text = `Hi ${d.recipientName},\n\nSLA alert for "${d.requestTitle}" (${d.tier} tier). Deadline: ${d.slaDeadline}.\n\nView it here: ${d.requestUrl}`
  return { subject, html, text }
}
