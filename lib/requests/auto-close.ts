// Finalizes tickets whose reopen window has passed: Resolved → Closed (and an approval-rejection cancellation after its fixed 48h).
// Used by the scheduled job (every organisation) and by the old "a manager opens Home" trigger (that manager's organisation).
// The requester is told in the bell only: closing needs nothing from them, so there is no e-mail.

import { notify } from '@/lib/notifications'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export async function autoCloseDueRequests(admin: AnyClient, orgId: string | null, limit = 100): Promise<number> {
  const nowIso = new Date().toISOString()
  let q = admin
    .from('requests')
    .select('id, requester_id, title, status, reopen_deadline_at')
    .in('status', ['resolved', 'cancelled'])
    .not('reopen_deadline_at', 'is', null)
    .lt('reopen_deadline_at', nowIso)
    .limit(limit)
  // The admin client bypasses RLS, so this filter is what keeps one organisation's sweep away from another's data.
  if (orgId) q = q.eq('org_id', orgId)
  const { data: toClose } = await q
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
      notify({
        recipientId: req.requester_id,
        actorId: req.requester_id, // system action — use requester as placeholder
        type: 'request_auto_closed',
        title: 'Your request was automatically closed',
        body: req.status === 'resolved'
          ? 'The reopen window has passed since this request was resolved.'
          : 'The reopen window has passed since this request was rejected.',
        requestId: req.id,
        link: `/requests/${req.id}`,
        skipEmail: true,
      }).catch(() => {})
    }
  }
  return closed
}
