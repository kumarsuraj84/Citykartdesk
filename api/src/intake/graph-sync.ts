import { simpleParser } from 'mailparser'
import { supabase } from '../lib/supabase.js'
import { log } from '../lib/log.js'
import { readImapCredentials } from './credentials.js'
import { storeMessage } from './store.js'
import { classifyMessage } from './classify/orchestrator.js'

// Fetch a Microsoft Graph message in MIME format (RFC822) and return as Buffer.
// Graph exposes this via the /$value endpoint with Accept: message/rfc822.
async function fetchGraphMimeMessage(
  email: string,
  graphMessageId: string,
  accessToken: string,
): Promise<Buffer | null> {
  // Graph requires the user to be addressed by email or object-id.
  // Using 'me' doesn't work with app-level tokens, so we use the email.
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/messages/${encodeURIComponent(graphMessageId)}/$value`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'message/rfc822',
      },
    },
  )

  if (!res.ok) {
    log.warn(`graph-sync: fetch message ${graphMessageId} failed: ${res.status}`)
    return null
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// Sync a single M365 message by its Graph message ID.
// Called by the worker when a Graph change notification arrives.
export async function syncGraphMessage(channelId: string, graphMessageId: string): Promise<{
  stored: boolean; duplicate: boolean; error: string | null
}> {
  const { data: channel, error: chErr } = await supabase
    .from('intake_channels')
    .select('id, org_id, credentials_ref, config')
    .eq('id', channelId)
    .maybeSingle()

  if (chErr || !channel?.credentials_ref) {
    log.warn(`graph-sync: channel ${channelId} not found or missing credentials`)
    return { stored: false, duplicate: false, error: 'channel not found' }
  }

  const creds = await readImapCredentials(channel.credentials_ref)
  if (!creds?.accessToken || !creds.user) {
    log.warn(`graph-sync: could not get access token for channel ${channelId}`)
    return { stored: false, duplicate: false, error: 'credentials unreadable' }
  }

  const mimeBuffer = await fetchGraphMimeMessage(creds.user, graphMessageId, creds.accessToken)
  if (!mimeBuffer) {
    return { stored: false, duplicate: false, error: 'fetch failed' }
  }

  let parsed
  try {
    parsed = await simpleParser(mimeBuffer)
  } catch (err) {
    log.warn(`graph-sync: parse error for message ${graphMessageId}`, err instanceof Error ? err.message : err)
    return { stored: false, duplicate: false, error: 'parse failed' }
  }

  const outcome = await storeMessage({
    orgId: channel.org_id,
    channelId,
    parsed,
    channelEmail: creds.user,
  })

  if (outcome.outcome === 'stored') {
    await supabase
      .from('intake_channels')
      .update({ last_polled_at: new Date().toISOString(), last_error: null })
      .eq('id', channelId)

    if (outcome.messageId) {
      try {
        await classifyMessage(outcome.messageId)
        log.info(`graph-sync: classified message ${outcome.messageId}`)
      } catch (err) {
        log.warn(`graph-sync: classify failed for message ${outcome.messageId}`, err instanceof Error ? err.message : err)
      }
    }
    return { stored: true, duplicate: false, error: null }
  }

  if (outcome.outcome === 'duplicate') {
    return { stored: false, duplicate: true, error: null }
  }

  return { stored: false, duplicate: false, error: 'store failed' }
}
