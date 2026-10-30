// Finalizes tickets whose reopen window has passed: Resolved → Closed.
// Used by the scheduled job (every organisation) and by the old "a manager opens Home" trigger (that manager's organisation).
// The requester is told in the bell only: closing needs nothing from them, so there is no e-mail.
//
// A ticket cancelled because an approval was rejected stays "cancelled" for good (B-13): it used to be turned into "closed" once its 48-hour reopen window passed,
// which rewrote a cancellation as a closure (and made it look like finished work in the reports). Its window simply ends; nothing changes.

import { notify } from '@/lib/notifications'
import { logActivity } from '@/lib/activity'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export async function autoCloseDueRequests(admin: AnyClient, orgId: string | null, limit = 100): Promise<number> {
  const nowIso = new Date().toISOString()
  let q = admin
    .from('requests')
    .select('id, requester_id, title, status, reopen_deadline_at')
    .eq('status', 'resolved')
    .not('reopen_deadline_at', 'is', null)
    .lt('reopen_deadline_at', nowIso)
    .limit(limit)
  // The admin client bypasses RLS, so this filter is what keeps one organisation's sweep away from another's data.
  if (orgId) q = q.eq('org_id', orgId)
  const { data: toClose, error: readError } = await q
  // a failed read is an error, not "nothing to close" (the callers log it)
  if (readError) throw new Error(`Could not read the resolved tickets to close: ${readError.message ?? 'unknown error'}`)
  if (!toClose || toClose.length === 0) return 0

  let closed = 0
  for (const req of toClose as { id: string; requester_id: string; status: string; reopen_deadline_at: string }[]) {
    // Guard against a reopen landing between the SELECT above and this UPDATE: if the request was reopened in
    // that window its status and/or reopen_deadline_at have already changed, so this matches zero rows.
    const { data: updated, error } = await admin
      .from('requests')
      .update({ status: 'closed', closed_at: nowIso, reopen_deadline_at: null })
      .eq('id', req.id)
      .eq('status', req.status)
      .eq('reopen_deadline_at', req.reopen_deadline_at)
      .select('id')
      .maybeSingle()

    if (!error && updated) {
      closed++
      // every automatic close is recorded in the ticket's history, like a person's close is (it was silent before)
      await logActivity({ requestId: req.id, actorId: null, action: 'status_changed', metadata: { from: req.status, to: 'closed', via: 'auto_close' } })
      notify({
        recipientId: req.requester_id,
        actorId: req.requester_id, // system action — use requester as placeholder
        type: 'request_auto_closed',
        title: 'Your request was automatically closed',
        body: 'The reopen window has passed since this request was resolved.',
        requestId: req.id,
        link: `/requests/${req.id}`,
        skipEmail: true,
      }).catch(() => {})
    }
  }
  return closed
}
