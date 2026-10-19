import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { getVisitSettings } from './settings'
import { resolveTicketForVisit } from './tickets'

type Admin = ReturnType<typeof createAdminClient>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (a: Admin) => a as unknown as { from: (t: string) => any }

type DueItem = { id: string; org_id: string; report_id: string; ckdesk_no: string; store_code: string; request_ids: string[]; created_at: string; auto_resolve_at: string | null; reminder_sent_at: string | null }

/**
 * Scheduled job (every few minutes):
 *  - an engineer's "resolved" that the store has not answered by its deadline (48 hours unless an administrator changed it) resolves the tickets by itself;
 *  - the store is reminded once, when the reminder time (24 hours unless changed) has passed.
 * Anything the engineer reported as NOT resolved is never touched here.
 */
export async function runVisitAutomation(admin: Admin, now: Date = new Date()): Promise<{ autoResolved: number; reminded: number }> {
  const db = loose(admin)
  const nowIso = now.toISOString()
  let autoResolved = 0
  let reminded = 0

  const { data: due } = await db.from('ac_visit_items').select('id, org_id, report_id, ckdesk_no, store_code, request_ids, created_at, auto_resolve_at, reminder_sent_at')
    .eq('outcome', 'pending_store').lte('auto_resolve_at', nowIso).limit(200)
  for (const it of (due ?? []) as DueItem[]) {
    const { data: rep } = await db.from('ac_visit_reports').select('engineer_name, visit_date, is_void').eq('id', it.report_id).maybeSingle()
    if (rep?.is_void) { await db.from('ac_visit_items').update({ outcome: 'void' }).eq('id', it.id); continue }
    const settings = await getVisitSettings(db, it.org_id)
    // claim it first so two runs never resolve the same report twice
    const { data: claimed } = await db.from('ac_visit_items').update({ outcome: 'resolved_auto', store_decided_at: nowIso }).eq('id', it.id).eq('outcome', 'pending_store').select('id').maybeSingle()
    if (!claimed) continue
    const { data: tickets } = await db.from('requests').select('id, requester_id').in('id', it.request_ids)
    const note = `Resolved automatically: engineer ${rep?.engineer_name ?? ''} reported AC ${it.ckdesk_no} resolved on ${rep?.visit_date ?? ''} and the store did not answer within ${settings.autoResolveHours} hours.`
    for (const t of (tickets ?? []) as { id: string; requester_id: string }[]) {
      if (await resolveTicketForVisit(admin, { requestId: t.id, actorId: t.requester_id, actorName: 'CK Desk', via: 'auto', note })) autoResolved++
    }
  }

  const { data: waiting } = await db.from('ac_visit_items').select('id, org_id, report_id, ckdesk_no, store_code, request_ids, created_at, auto_resolve_at, reminder_sent_at')
    .eq('outcome', 'pending_store').is('reminder_sent_at', null).gt('auto_resolve_at', nowIso).limit(200)
  for (const it of (waiting ?? []) as DueItem[]) {
    const settings = await getVisitSettings(db, it.org_id)
    if (new Date(it.created_at).getTime() + settings.reminderHours * 3_600_000 > now.getTime()) continue
    const { data: claimed } = await db.from('ac_visit_items').update({ reminder_sent_at: nowIso }).eq('id', it.id).is('reminder_sent_at', null).select('id').maybeSingle()
    if (!claimed) continue
    const { data: tickets } = await db.from('requests').select('id, requester_id').in('id', it.request_ids)
    for (const rid of [...new Set(((tickets ?? []) as { requester_id: string }[]).map((t) => t.requester_id))]) {
      notify({
        recipientId: rid, actorId: null, type: 'comment_added', requestId: it.request_ids[0], link: '/ac-visits',
        title: `Reminder: please confirm AC ${it.ckdesk_no}`,
        body: `The OEM engineer reported it resolved. If you do not answer by ${new Date(it.auto_resolve_at!).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} the ticket is resolved automatically.`,
      }).catch(() => {})
      reminded++
    }
  }
  return { autoResolved, reminded }
}
