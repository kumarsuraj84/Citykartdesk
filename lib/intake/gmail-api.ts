// Gmail REST API helpers — used by the OAuth callback (watch setup) and the
// webhook handler (finding channels). The worker handles actual message fetching
// via its own gmail-sync route (keeps mailparser / supabase writes in one place).

export interface GmailWatchResult {
  historyId: string
  expiration: string // ms since epoch as string from Google
}

// Register Gmail push notifications for a mailbox. Must be called with a fresh
// access_token from the code exchange. topicName is the Pub/Sub topic ARN:
//   "projects/{google_cloud_project}/topics/{topic_name}"
// The Gmail service account must have pubsub.topics.publish on the topic (one-time
// Cloud Console setup). Returns the starting historyId stored in the channel config.
export async function setupGmailWatch(
  email: string,
  accessToken: string,
  topicName: string,
): Promise<GmailWatchResult | { error: string }> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(email)}/watch`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ topicName, labelIds: ['INBOX'] }),
    },
  )
  const data = await res.json() as {
    historyId?: string; expiration?: string; error?: { message: string }
  }
  if (!res.ok || !data.historyId) {
    return { error: data.error?.message ?? `Gmail watch failed (${res.status})` }
  }
  return { historyId: data.historyId, expiration: data.expiration ?? '' }
}

// Tear down Gmail push for a mailbox (called on channel disconnect/delete).
export async function stopGmailWatch(email: string, accessToken: string): Promise<void> {
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(email)}/stop`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
  ).catch(() => null)
}
