import { simpleParser } from 'mailparser'
import { supabase } from '../lib/supabase.js'
import { log } from '../lib/log.js'
import { readImapCredentials } from './credentials.js'
import { storeMessage } from './store.js'
import { classifyMessage } from './classify/orchestrator.js'

// Mint a fresh Gmail API access token from the stored refresh token.
async function getGmailAccessToken(credentialsRef: string): Promise<{ email: string; accessToken: string } | null> {
  const creds = await readImapCredentials(credentialsRef)
  if (!creds?.accessToken || !creds.user) return null
  return { email: creds.user, accessToken: creds.accessToken }
}

// Fetch Gmail history (messages added) since startHistoryId.
// Returns an array of Gmail message IDs.
async function listNewMessageIds(email: string, accessToken: string, startHistoryId: string): Promise<string[]> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(email)}/history`)
  url.searchParams.set('startHistoryId', startHistoryId)
  url.searchParams.set('historyTypes', 'messageAdded')
  url.searchParams.set('labelId', 'INBOX')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 404) {
    // historyId expired (Gmail purges after ~30 days) — caller should resync.
    log.warn(`Gmail history expired for ${email} (startHistoryId=${startHistoryId})`)
    return []
  }

  if (!res.ok) {
    log.warn(`Gmail history list failed for ${email}: ${res.status}`)
    return []
  }

  const data = await res.json() as {
    history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>
    historyId?: string
  }

  const ids: string[] = []
  for (const record of data.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      if (added.message?.id) ids.push(added.message.id)
    }
  }
  return [...new Set(ids)] // deduplicate
}

// Fetch a single Gmail message in RFC822 (raw MIME) format and return a Buffer.
async function fetchRawMessage(email: string, messageId: string, accessToken: string): Promise<Buffer | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(email)}/messages/${messageId}?format=raw`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    log.warn(`Gmail fetch message ${messageId} failed: ${res.status}`)
    return null
  }
  const data = await res.json() as { raw?: string; historyId?: string }
  if (!data.raw) return null
  return Buffer.from(data.raw, 'base64')
}

// Sync new Gmail messages for a channel since a given historyId.
// Called by the worker when a Pub/Sub push notification arrives or on manual resync.
export async function syncGmailChannel(channelId: string, startHistoryId: string): Promise<{
  fetched: number; stored: number; duplicates: number; newHistoryId: string | null
}> {
  log.info(`syncGmailChannel started`, { channelId, startHistoryId })
  const { data: channel, error: chErr } = await supabase
    .from('intake_channels')
    .select('id, org_id, credentials_ref, config')
    .eq('id', channelId)
    .maybeSingle()

  if (chErr || !channel?.credentials_ref) {
    log.warn(`gmail-sync: channel ${channelId} not found or missing credentials`, { chErr, hasCredentials: !!channel?.credentials_ref })
    return { fetched: 0, stored: 0, duplicates: 0, newHistoryId: null }
  }
  log.info(`syncGmailChannel: channel found`, { org_id: channel.org_id })

  const auth = await getGmailAccessToken(channel.credentials_ref)
  if (!auth) {
    log.warn(`gmail-sync: could not get access token for channel ${channelId}`)
    return { fetched: 0, stored: 0, duplicates: 0, newHistoryId: null }
  }

  const { email, accessToken } = auth
  log.info(`syncGmailChannel: got access token, fetching history`, { email })
  const messageIds = await listNewMessageIds(email, accessToken, startHistoryId)
  log.info(`syncGmailChannel: found message IDs`, { count: messageIds.length, ids: messageIds.slice(0, 5) })

  let stored = 0
  let duplicates = 0

  for (const msgId of messageIds) {
    log.info(`syncGmailChannel: processing message ${msgId}`)
    const raw = await fetchRawMessage(email, msgId, accessToken)
    if (!raw) continue

    let parsed
    try {
      parsed = await simpleParser(raw)
    } catch (err) {
      log.warn(`gmail-sync: parse error for message ${msgId}`, err instanceof Error ? err.message : err)
      continue
    }

    const outcome = await storeMessage({
      orgId: channel.org_id,
      channelId,
      parsed,
      channelEmail: email,
    })

    if (outcome.outcome === 'stored') {
      stored++
      if (outcome.messageId) {
        try {
          await classifyMessage(outcome.messageId)
          log.info(`gmail-sync: classified message ${outcome.messageId}`)
        } catch (err) {
          log.warn(`gmail-sync: classify failed for message ${outcome.messageId}`, err instanceof Error ? err.message : err)
        }
      }
    } else if (outcome.outcome === 'duplicate') {
      duplicates++
    }
  }

  // Persist the latest historyId (passed in from the push notification) so the
  // next webhook starts from where this one left off.
  const newHistoryId = startHistoryId
  if (stored > 0 || duplicates === 0) {
    await supabase
      .from('intake_channels')
      .update({
        last_polled_at: new Date().toISOString(),
        last_error: null,
        config: { ...(channel.config ?? {}), last_history_id: newHistoryId },
      })
      .eq('id', channelId)
  }

  log.info(`gmail-sync channel ${channelId}`, { fetched: messageIds.length, stored, duplicates })
  return { fetched: messageIds.length, stored, duplicates, newHistoryId }
}
