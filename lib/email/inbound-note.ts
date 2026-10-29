// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/**
 * A reply that was NOT added to the conversation leaves a short internal note on the ticket (staff only), so a technician can see that an answer
 * arrived and why it is not shown, instead of it vanishing silently. Only for senders at a company we actually deal with.
 * request_comments needs an author or an external e-mail address (request_comments_author_check): without one this note was refused and never appeared.
 */
export async function noteUnaddedReply(admin: AnyClient, requestId: string, fromAddress: string, reason: string): Promise<boolean> {
  try {
    const { error } = await admin.from('request_comments').insert({
      request_id: requestId, author_id: null, external_name: 'Citykart Desk', external_email: fromAddress, is_internal: true,
      body: `An e-mail reply to this ticket from ${fromAddress} was not added to the conversation: ${reason}. If it is genuine, copy the message in by hand.`,
    })
    if (error) { console.error('[inbound] could not leave the "reply not added" note', error.message); return false }
    return true
  } catch { return false /* a note must never break the sync */ }
}
