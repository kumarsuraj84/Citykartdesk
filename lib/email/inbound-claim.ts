// Posting an inbound e-mail reply exactly once. Audit finding D-020: the "this e-mail has been handled" record used to be written AFTER the
// comment was posted, and written as "matched" even when posting had failed. A temporary database error therefore lost the reply for good
// (it was marked handled and never tried again), and two overlapping runs could both post it.
//
// Now the record is written FIRST, as a claim: the first run to write it posts the reply, any other run sees the existing record and skips.
// If posting fails (an error result or an exception) the claim is removed again, so the next run tries again.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type InboundClaimRow = { message_id: string; request_id: string; from_address: string }
export type AppendOutcome = 'posted' | 'duplicate' | 'failed'

export async function postReplyOnce(
  admin: AnyClient,
  row: InboundClaimRow,
  post: () => Promise<{ error?: string }>,
): Promise<{ outcome: AppendOutcome; error?: string }> {
  const { error: claimError } = await admin.from('processed_inbound_emails').insert({ ...row, outcome: 'matched' })
  if (claimError) {
    // 23505 = the unique record for this Message-ID already exists: another run is handling it, or already handled it
    if (claimError.code === '23505') return { outcome: 'duplicate' }
    return { outcome: 'failed', error: `Could not record the e-mail as handled: ${claimError.message ?? 'unknown error'}` }
  }
  const release = () => admin.from('processed_inbound_emails').delete().eq('message_id', row.message_id)
  try {
    const result = await post()
    if (result.error) {
      await release()
      return { outcome: 'failed', error: result.error }
    }
    return { outcome: 'posted' }
  } catch (e) {
    await release()
    throw e
  }
}
