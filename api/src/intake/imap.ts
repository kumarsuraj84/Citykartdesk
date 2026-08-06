import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { ImapCredentials } from './credentials.js'
import { storeMessage } from './store.js'
import { classifyMessage } from './classify/orchestrator.js'
import { log } from '../lib/log.js'

// Build the ImapFlow auth block: XOAUTH2 when an access token is present
// (Gmail / M365 OAuth), otherwise basic password auth.
function imapAuth(creds: ImapCredentials) {
  return creds.accessToken
    ? { user: creds.user, accessToken: creds.accessToken }
    : { user: creds.user, pass: creds.password ?? '' }
}

// imapflow throws a terse "Command failed"; the useful detail lives in extra
// fields. Surface them so channel.last_error is actionable.
export function formatImapError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err)
  const e = err as {
    message?: string
    responseText?: string
    serverResponseCode?: string
    authenticationFailed?: boolean
    code?: string
  }
  const parts: string[] = []
  if (e.authenticationFailed) parts.push('Authentication failed')
  if (e.responseText) parts.push(e.responseText)
  if (e.serverResponseCode) parts.push(`[${e.serverResponseCode}]`)
  if (e.code && !parts.length) parts.push(e.code)
  if (!parts.length && e.message) parts.push(e.message)
  return parts.join(' ') || 'IMAP error'
}

export interface PollResult {
  fetched: number
  stored: number
  duplicates: number
  errors: number
  highestUid: number
}

// Connects to a mailbox and fetches messages with UID greater than `sinceUid`.
// Each new message is parsed and stored idempotently. Returns the highest UID
// seen so the caller can persist it for incremental polling.
export async function pollMailbox(opts: {
  orgId: string
  channelId: string
  creds: ImapCredentials
  folder: string
  sinceUid: number
}): Promise<PollResult> {
  const client = new ImapFlow({
    host: opts.creds.host,
    port: opts.creds.port,
    secure: opts.creds.secure,
    auth: imapAuth(opts.creds),
    logger: false,
  })

  const result: PollResult = { fetched: 0, stored: 0, duplicates: 0, errors: 0, highestUid: opts.sinceUid }
  // Stored message ids to classify AFTER the mailbox connection closes. Running
  // the (slow, rate-limited) classifier inside the fetch loop holds the IMAP
  // stream open long enough that Gmail drops the connection mid-download — which
  // capped ingestion to a few messages per poll. Decouple fetch from classify.
  const toClassify: string[] = []

  await client.connect()
  const lock = await client.getMailboxLock(opts.folder || 'INBOX')
  try {
    const range = `${opts.sinceUid + 1}:*`
    for await (const msg of client.fetch({ uid: range }, { uid: true, source: true })) {
      // UID '*' can re-return the boundary message; skip anything not strictly newer.
      if (msg.uid <= opts.sinceUid) continue
      result.fetched++
      result.highestUid = Math.max(result.highestUid, msg.uid)

      try {
        const parsed = await simpleParser(msg.source as Buffer)
        const { outcome, messageId } = await storeMessage({ orgId: opts.orgId, channelId: opts.channelId, parsed, channelEmail: opts.creds.user })
        if (outcome === 'stored') {
          result.stored++
          if (messageId) toClassify.push(messageId)
        } else if (outcome === 'duplicate') result.duplicates++
        else result.errors++
      } catch (err) {
        result.errors++
        log.warn('parse/store failed for one message', err instanceof Error ? err.message : err)
      }
    }
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }

  // Classify once the IMAP connection is released — failures here are isolated
  // and don't affect what's already downloaded (the scheduler can also retry).
  for (const messageId of toClassify) {
    try {
      await classifyMessage(messageId)
    } catch (err) {
      log.warn('classify failed for stored message', err instanceof Error ? err.message : err)
    }
  }

  return result
}

// Lightweight credential validation — connects, opens INBOX, disconnects.
export async function testConnection(creds: ImapCredentials, folder = 'INBOX'): Promise<{ ok: boolean; error?: string }> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: imapAuth(creds),
    logger: false,
  })
  try {
    await client.connect()
    const lock = await client.getMailboxLock(folder || 'INBOX')
    lock.release()
    await client.logout()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: formatImapError(err) }
  }
}
