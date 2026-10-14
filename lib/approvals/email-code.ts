// The one-time code e-mailed to an approver (D-060). Random, stored only as a keyed hash, valid for CODE_MINUTES, usable once, and
// locked after CODE_MAX_ATTEMPTS wrong tries. Asking for a new code cancels the one before it. Server-side only (service role).

import { CODE_MAX_ATTEMPTS, CODE_MINUTES, codesEqual, hashApprovalCode, newApprovalCode, normaliseCode } from '@/lib/approvals/email-link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type CodeCheck = 'ok' | 'wrong' | 'locked' | 'none'

/** Makes a new code for this approver and approval, cancelling any earlier unused one. Returns the code to e-mail, or null if it could not be stored. */
export async function issueApprovalCode(admin: AnyClient, approvalId: string, approverId: string): Promise<string | null> {
  const now = new Date().toISOString()
  await admin.from('approval_email_codes').update({ used_at: now }).eq('approval_id', approvalId).eq('approver_id', approverId).is('used_at', null)
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
  await admin.from('approval_email_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('attempts', row.attempts)
  return row.attempts + 1 >= CODE_MAX_ATTEMPTS ? 'locked' : 'wrong'
}
