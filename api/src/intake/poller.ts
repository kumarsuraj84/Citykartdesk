import { supabase } from '../lib/supabase.js'
import { log } from '../lib/log.js'
import { readImapCredentials } from './credentials.js'
import { pollMailbox, formatImapError } from './imap.js'

interface ChannelRow {
  id: string
  org_id: string
  type: string
  provider: string | null
  config: { folder?: string; last_uid?: number } | null
  credentials_ref: string | null
}

// Per-channel poll outcome — surfaced so a manual "Poll now" can report exactly
// what each mailbox did (or why it failed) instead of a silent aggregate.
export interface ChannelPollDetail {
  id: string
  fetched: number
  stored: number
  duplicates: number
  error: string | null
}

// Polls every active email channel once. Per-channel failures are isolated:
// one bad mailbox sets only its own status to 'error' and never blocks others.
export async function pollAllChannels(): Promise<{ channels: number; stored: number; details: ChannelPollDetail[] }> {
  const { data: channels, error } = await supabase
    .from('intake_channels')
    .select('id, org_id, type, provider, config, credentials_ref')
    .eq('type', 'email')
    .eq('status', 'active')

  if (error) {
    log.error('failed to list channels', error.message)
    return { channels: 0, stored: 0, details: [] }
  }

  let totalStored = 0
  const rows = (channels ?? []) as ChannelRow[]
  const details: ChannelPollDetail[] = []

  for (const ch of rows) {
    // Gmail and M365 channels in push mode receive mail via webhooks — no polling needed.
    if ((ch.provider === 'gmail' || ch.provider === 'm365') && (ch.config as Record<string, unknown> | null)?.push_mode) {
      log.info(`channel ${ch.id} is in push mode — skipping IMAP poll`)
      continue
    }

    if (!ch.credentials_ref) {
      log.warn(`channel ${ch.id} active but has no credentials_ref — skipping`)
      details.push({ id: ch.id, fetched: 0, stored: 0, duplicates: 0, error: 'no credentials connected' })
      continue
    }
    try {
      const creds = await readImapCredentials(ch.credentials_ref)
      if (!creds) {
        await markChannelError(ch.id, 'credentials missing or unreadable from Vault')
        details.push({ id: ch.id, fetched: 0, stored: 0, duplicates: 0, error: 'credentials unreadable from Vault' })
        continue
      }

      const folder = ch.config?.folder ?? 'INBOX'
      const sinceUid = ch.config?.last_uid ?? 0

      const res = await pollMailbox({
        orgId: ch.org_id, channelId: ch.id, creds, folder, sinceUid,
      })
      totalStored += res.stored

      await supabase
        .from('intake_channels')
        .update({
          status: 'active',
          last_polled_at: new Date().toISOString(),
          last_error: null,
          config: { ...(ch.config ?? {}), folder, last_uid: res.highestUid },
        })
        .eq('id', ch.id)

      details.push({ id: ch.id, fetched: res.fetched, stored: res.stored, duplicates: res.duplicates, error: null })
      log.info(`polled channel ${ch.id}`, res)
    } catch (err) {
      const message = formatImapError(err)
      await markChannelError(ch.id, message)
      details.push({ id: ch.id, fetched: 0, stored: 0, duplicates: 0, error: message })
    }
  }

  return { channels: rows.length, stored: totalStored, details }
}

async function markChannelError(channelId: string, message: string) {
  log.warn(`channel ${channelId} error: ${message}`)
  await supabase
    .from('intake_channels')
    .update({ status: 'error', last_error: message, last_polled_at: new Date().toISOString() })
    .eq('id', channelId)
}
