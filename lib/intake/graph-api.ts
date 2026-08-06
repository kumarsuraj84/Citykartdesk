// Microsoft Graph change-notification subscription helpers — used by the OAuth
// callback to register webhooks so M365 mailboxes use push instead of IMAP polling.

export interface GraphSubscription {
  id: string
  expirationDateTime: string
}

// Max allowed by Graph for mail change notifications is 4230 minutes (~3 days).
const EXPIRY_MINUTES = 4200

function expirationIso(): string {
  const d = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000)
  return d.toISOString()
}

// Create a Graph change-notification subscription so new inbox messages trigger
// a push to our webhook. clientState is sent back verbatim in every notification
// so we can verify the request came from Microsoft.
export async function createGraphSubscription(opts: {
  accessToken: string
  notificationUrl: string // full URL including ?token=SECRET
  clientState: string
}): Promise<GraphSubscription | { error: string }> {
  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl: opts.notificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime: expirationIso(),
      clientState: opts.clientState,
    }),
  })
  const data = await res.json() as {
    id?: string; expirationDateTime?: string; error?: { message: string }
  }
  if (!res.ok || !data.id) {
    return { error: data.error?.message ?? `Graph subscription failed (${res.status})` }
  }
  return { id: data.id, expirationDateTime: data.expirationDateTime ?? '' }
}

// Renew an existing subscription before it expires.
export async function renewGraphSubscription(
  subscriptionId: string,
  accessToken: string,
): Promise<{ expirationDateTime: string } | { error: string }> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expirationDateTime: expirationIso() }),
    },
  )
  const data = await res.json() as { expirationDateTime?: string; error?: { message: string } }
  if (!res.ok) {
    return { error: data.error?.message ?? `Subscription renewal failed (${res.status})` }
  }
  return { expirationDateTime: data.expirationDateTime ?? '' }
}

// Delete a subscription (on channel disconnect).
export async function deleteGraphSubscription(
  subscriptionId: string,
  accessToken: string,
): Promise<void> {
  await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null)
}
