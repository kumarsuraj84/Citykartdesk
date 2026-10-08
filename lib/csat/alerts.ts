// A low CSAT rating (1 or 2 stars) is told to the technician who handled the ticket and to the leads of its group, in the bell
// and by e-mail, so an unhappy requester is followed up while the issue is fresh. Used by both ways of rating (the portal and the e-mail link).

import { notify } from '@/lib/notifications'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export const LOW_CSAT_MAX = 2

export async function notifyLowRating(admin: AnyClient, p: { requestId: string; rating: number; comment: string | null; requesterId: string }): Promise<void> {
  if (p.rating > LOW_CSAT_MAX) return
  try {
    const { data: req } = await admin.from('requests').select('id, request_no, title, team_id, assigned_to').eq('id', p.requestId).maybeSingle()
    if (!req) return
    const { data: leads } = req.team_id
      ? await admin.from('team_members').select('user_id').eq('team_id', req.team_id).eq('is_lead', true)
      : { data: [] }
    const recipients = new Set<string>([...(leads ?? []).map((l: { user_id: string }) => l.user_id)])
    if (req.assigned_to) recipients.add(req.assigned_to)
    recipients.delete(p.requesterId)
    if (recipients.size === 0) return

    await notify([...recipients].map((recipientId) => ({
      recipientId,
      actorId: p.requesterId,
      type: 'csat_low_rating' as const,
      title: `Low rating (${p.rating}/5) on ${req.request_no}`,
      body: p.comment?.trim() ? `${req.title} — "${p.comment.trim().slice(0, 200)}"` : req.title,
      requestId: req.id,
      link: `/requests/${req.id}`,
    })))
  } catch (e) {
    console.error('[csat] low-rating alert failed', e)
  }
}
