// "Nudge": a manager (or any technician who can see the ticket) asks the person handling it to take a look. It is a
// reminder in the bell and by e-mail, not a change to the ticket. Not a server action: the screen's action checks who
// is asking and that they may see the ticket, then calls this.
//
// It reuses the existing 'sla_warning' notification type (marked with metadata.nudge) so no database change is needed.

import { notify } from '@/lib/notifications'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** Statuses where the ball is with the technician. Waiting on the requester, on approval or on a purchase is not theirs to hurry. */
export const NUDGEABLE_STATUSES = ['open', 'assigned', 'in_progress'] as const
/** The same ticket can be nudged once in this time, so a reminder never turns into spam. */
export const NUDGE_COOLDOWN_MS = 4 * 3_600_000
export const NUDGE_NOTE_MAX = 300

export type NudgeResult = { error: string } | { sent: number; names: string[] }

export async function nudgeRequest(admin: AnyClient, p: { requestId: string; orgId: string; actorId: string; actorName: string; message?: string }): Promise<NudgeResult> {
  const note = (p.message ?? '').trim().slice(0, NUDGE_NOTE_MAX)
  const { data: req } = await admin.from('requests').select('id, request_no, title, status, team_id, assigned_to').eq('id', p.requestId).eq('org_id', p.orgId).maybeSingle()
  if (!req) return { error: 'This ticket is not available to you.' }
  if (!(NUDGEABLE_STATUSES as readonly string[]).includes(req.status)) {
    return { error: 'This ticket is not waiting on a technician right now (it is resolved, closed, on hold or waiting for someone else), so there is no one to nudge.' }
  }

  const since = new Date(Date.now() - NUDGE_COOLDOWN_MS).toISOString()
  const { data: recent } = await admin.from('notifications').select('created_at, metadata')
    .eq('request_id', req.id).eq('type', 'sla_warning').contains('metadata', { nudge: '1' }).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(1)
  if (recent?.length) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(recent[0].created_at).getTime()) / 60_000))
    const by = (recent[0].metadata as { nudgedBy?: string } | null)?.nudgedBy
    const when = mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'} ago` : `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'} ago`
    return { error: `This ticket was already nudged ${when}${by ? ` by ${by}` : ''}. You can nudge it again after ${Math.round(NUDGE_COOLDOWN_MS / 3_600_000)} hours.` }
  }

  // The technician handling it; if nobody has picked it up yet, the leads of its group.
  let recipients: string[] = req.assigned_to ? [req.assigned_to] : []
  if (recipients.length === 0 && req.team_id) {
    const { data: leads } = await admin.from('team_members').select('user_id').eq('team_id', req.team_id).eq('is_lead', true)
    recipients = (leads ?? []).map((l: { user_id: string }) => l.user_id)
  }
  recipients = [...new Set(recipients)].filter((id) => id !== p.actorId)
  if (recipients.length === 0) return { error: req.assigned_to ? 'You are the technician handling this ticket, so there is no one else to nudge.' : 'No technician or group lead is set for this ticket, so there is no one to nudge.' }

  const { data: people } = await admin.from('profiles').select('id, full_name').in('id', recipients)
  const names = (people ?? []).map((x: { full_name: string }) => x.full_name)

  await notify(recipients.map((recipientId) => ({
    recipientId,
    actorId: p.actorId,
    type: 'sla_warning' as const,
    title: `Reminder from ${p.actorName}: ${req.request_no}`,
    body: note ? `${req.title} — "${note}"` : `${req.title} — please take a look and update the ticket.`,
    requestId: req.id,
    link: `/requests/${req.id}`,
    metadata: { nudge: '1', nudgedBy: p.actorName, note },
  })))
  return { sent: recipients.length, names }
}
