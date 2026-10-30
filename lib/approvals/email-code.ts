// The one-time code e-mailed to an approver (D-060). Random, stored only as a keyed hash, valid for CODE_MINUTES, usable once, and
// locked after CODE_MAX_ATTEMPTS wrong tries. Asking for a new code cancels the one before it. Server-side only (service role).

import { CODE_MAX_ATTEMPTS, CODE_MINUTES, codesEqual, hashApprovalCode, newApprovalCode, normaliseCode } from '@/lib/approvals/email-link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type CodeCheck = 'ok' | 'wrong' | 'locked' | 'none'

/**
 * Is there a code for this approver that is still usable (not used, not expired, not locked)? Anyone holding the approval link can ask for a new code; if a
 * usable one exists a new one is NOT made, so a stranger cannot keep cancelling the real approver's code (VAPT-044 / VA-API-13).
 */
export async function hasUsableApprovalCode(admin: AnyClient, approvalId: string, approverId: string): Promise<boolean> {
  const { data } = await admin.from('approval_email_codes')
    .select('id, attempts')
    .eq('approval_id', approvalId).eq('approver_id', approverId)
    .is('used_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return !!data && data.attempts < CODE_MAX_ATTEMPTS
}

/** Makes a new code for this approver and approval (the caller has already checked that no usable code exists; a locked or expired one is cancelled). Returns the code to e-mail, or null if it could not be stored. */
export async function issueApprovalCode(admin: AnyClient, approvalId: string, approverId: string): Promise<string | null> {
  const now = new Date().toISOString()
  const { error: cancelError } = await admin.from('approval_email_codes').update({ used_at: now }).eq('approval_id', approvalId).eq('approver_id', approverId).is('used_at', null)
  // If the earlier code could not be cancelled it would stay usable next to the new one (after the new one is used, the older one becomes the newest unused
  // code). No new code is issued then; the caller says the code could not be created and the approver tries again.
  if (cancelError) return null
  const code = newApprovalCode()
  const { error } = await admin.from('approval_email_codes').insert({
    approval_id: approvalId, approver_id: approverId, code_hash: hashApprovalCode(approvalId, approverId, code),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  })
  return error ? null : code
}

/** Checks a typed code. A right code is used up in the same step, so it cannot be used twice; a wrong one counts against the limit. */
export async function consumeApprovalCode(admin: AnyClient, approvalId: string, approverId: string, typed: string): Promise<CodeCheck> {
  const code = normaliseCode(typed)
  if (!code) return 'wrong'
  const { data: row } = await admin.from('approval_email_codes')
    .select('id, code_hash, attempts')
    .eq('approval_id', approvalId).eq('approver_id', approverId)
    .is('used_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!row) return 'none'
  if (row.attempts >= CODE_MAX_ATTEMPTS) return 'locked'

  if (codesEqual(row.code_hash, hashApprovalCode(approvalId, approverId, code))) {
    // claim it: only one caller can flip used_at from null, so two simultaneous uses cannot both succeed
    const { data: claimed } = await admin.from('approval_email_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id').maybeSingle()
    return claimed ? 'ok' : 'none'
  }
  // Count the wrong guess for certain (VAPT VA-DB-11 / VA-TKT-13): a burst of parallel guesses used to read the same counter and be counted as one try.
  // A guess that keeps losing the race to the counter is treated as a lock-out instead of a free try.
  for (let i = 0; i < 6; i++) {
    const { data: cur } = await admin.from('approval_email_codes').select('attempts').eq('id', row.id).maybeSingle()
    if (!cur || cur.attempts >= CODE_MAX_ATTEMPTS) return 'locked'
    const { data: bumped } = await admin.from('approval_email_codes').update({ attempts: cur.attempts + 1 }).eq('id', row.id).eq('attempts', cur.attempts).select('attempts').maybeSingle()
    if (bumped) return bumped.attempts >= CODE_MAX_ATTEMPTS ? 'locked' : 'wrong'
  }
  return 'locked'
}
