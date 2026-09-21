import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'

/**
 * "Your ticket has been logged" — the confirmation the requester gets with the ticket number.
 * Governed by the Notification Rules row for "New request submitted" (request_created).
 */
export async function notifyRequesterTicketLogged(p: {
  requesterId: string
  actorId: string
  requestId: string
  requestNo: string | null
  title: string
  serviceName?: string | null
}): Promise<void> {
  await notify({
    recipientId: p.requesterId,
    actorId: p.actorId,
    type: 'request_created',
    title: `Your request${p.requestNo ? ` ${p.requestNo}` : ''} has been logged`,
    body: p.title,
    requestId: p.requestId,
    link: `/requests/${p.requestId}`,
    metadata: { audience: 'requester', requestNo: p.requestNo ?? '', requestTitle: p.title, serviceName: p.serviceName ?? '' },
  })
}

/**
 * "Your ticket was assigned to <technician>" — sent to the requester whenever a ticket gets an
 * owner, whether a business rule or a person assigned it. Governed by "Ticket assigned" /
 * "Ticket reassigned" in Notification Rules. Never throws.
 */
export async function notifyRequesterOfAssignment(p: {
  requestId: string
  assigneeId: string
  actorId: string
  reassigned?: boolean
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const [{ data: req }, { data: assignee }] = await Promise.all([
      admin.from('requests').select('request_no, title, requester_id').eq('id', p.requestId).single(),
      admin.from('profiles').select('full_name').eq('id', p.assigneeId).single(),
    ])
    if (!req?.requester_id || req.requester_id === p.assigneeId) return

    const assigneeName = assignee?.full_name || 'a technician'
    const no = req.request_no ? ` ${req.request_no}` : ''
    await notify({
      recipientId: req.requester_id,
      actorId: p.actorId,
      type: p.reassigned ? 'request_reassigned' : 'request_assigned',
      title: `Your request${no} has been ${p.reassigned ? 'reassigned' : 'assigned'} to ${assigneeName}`,
      body: req.title,
      requestId: p.requestId,
      link: `/requests/${p.requestId}`,
      metadata: { audience: 'requester', assigneeName, requestNo: req.request_no ?? '', requestTitle: req.title },
    })
  } catch {
    /* a failed courtesy notification must never break the assignment itself */
  }
}
