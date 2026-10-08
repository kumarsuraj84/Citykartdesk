// The one reminder: a requester who got the "resolved + how did we do?" e-mail, has not rated and has not reopened the ticket,
// gets a short nudge N days after it was resolved (Request Configuration → General). Run by the scheduled job.

import { getCsatSettings } from './settings'
import { sendCsatReminder } from './issue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }

const DAY = 86_400_000

export async function sendDueCsatReminders(admin: AnyClient, limit = 100): Promise<number> {
  const settings = await getCsatSettings()
  if (!settings.enabled || settings.reminderDays <= 0) return 0

  const dueBefore = new Date(Date.now() - settings.reminderDays * DAY).toISOString()
  const { data: surveys, error } = await admin
    .from('csat_surveys')
    .select('id, request_id, requester_id, sent_at')
    .is('submitted_at', null)
    .is('reminder_sent_at', null)
    .lt('sent_at', dueBefore)
    .order('sent_at', { ascending: true })
    .limit(limit)
  // the reminder column arrives with a migration; until it exists there is simply nothing to send
  if (error || !surveys?.length) return 0

  let sent = 0
  for (const s of surveys as { id: string; request_id: string; requester_id: string; sent_at: string }[]) {
    const { data: req } = await admin
      .from('requests')
      .select('id, request_no, title, status, reopen_deadline_at, resolved_at')
      .eq('id', s.request_id)
      .maybeSingle()
    // only while the ticket is still waiting on the requester's verdict (not reopened, not closed)
    if (!req || req.status !== 'resolved') {
      await admin.from('csat_surveys').update({ reminder_sent_at: new Date().toISOString() }).eq('id', s.id)
      continue
    }
    const ok = await sendCsatReminder(admin, {
      surveyId: s.id, requestId: req.id, requestNo: req.request_no, title: req.title, requesterId: s.requester_id,
      resolvedAtMs: new Date(req.resolved_at ?? s.sent_at).getTime(), reopenDeadlineIso: req.reopen_deadline_at,
    })
    if (ok) {
      await admin.from('csat_surveys').update({ reminder_sent_at: new Date().toISOString() }).eq('id', s.id)
      sent++
    }
  }
  return sent
}
