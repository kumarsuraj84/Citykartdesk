import type { ParsedMail, AddressObject } from 'mailparser'
import { supabase } from '../lib/supabase.js'
import { log } from '../lib/log.js'
import { normalizeBody, computeDedupHash } from './normalize.js'

function addressList(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return []
  const arr = Array.isArray(a) ? a : [a]
  return arr.flatMap((obj) => obj.value.map((v) => v.address ?? '').filter(Boolean))
}

function firstAddress(a: AddressObject | AddressObject[] | undefined): string | null {
  return addressList(a)[0] ?? null
}

// Determine whether the intake inbox was a direct TO recipient or only CC'd.
// Case-insensitive; falls back to 'to' when the channel email is unknown.
function detectRecipientType(channelEmail: string | undefined, toList: string[], ccList: string[]): 'to' | 'cc' {
  if (!channelEmail) return 'to'
  const addr = channelEmail.toLowerCase()
  if (toList.some((a) => a.toLowerCase() === addr)) return 'to'
  if (ccList.some((a) => a.toLowerCase() === addr)) return 'cc'
  return 'to' // inbox might have an alias — default to direct
}

// Strip Re:/Fwd: prefixes so replies group into one thread.
function threadKeyFromSubject(subject: string | undefined): string {
  return (subject ?? '(no subject)')
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()
    .slice(0, 500)
}

// Upserts the thread for a message and returns its id.
async function upsertThread(opts: {
  orgId: string
  channelId: string
  subject: string | undefined
  participants: string[]
  receivedAt: string | null
}): Promise<string | null> {
  const externalThreadKey = threadKeyFromSubject(opts.subject)

  // Idempotent on (org_id, channel_id, external_thread_key).
  const { data: existing } = await supabase
    .from('intake_threads')
    .select('id, message_count')
    .eq('org_id', opts.orgId)
    .eq('channel_id', opts.channelId)
    .eq('external_thread_key', externalThreadKey)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('intake_threads')
      .update({
        message_count: (existing.message_count ?? 0) + 1,
        last_message_at: opts.receivedAt,
      })
      .eq('id', existing.id)
    return existing.id
  }

  const { data: created, error } = await supabase
    .from('intake_threads')
    .insert({
      org_id: opts.orgId,
      channel_id: opts.channelId,
      external_thread_key: externalThreadKey,
      subject: opts.subject ?? null,
      participant_emails: opts.participants,
      message_count: 1,
      first_message_at: opts.receivedAt,
      last_message_at: opts.receivedAt,
    })
    .select('id')
    .single()

  if (error) {
    log.warn('thread upsert failed', error.message)
    return null
  }
  return created.id
}

// Stores one parsed email idempotently. Returns 'stored' | 'duplicate' | 'error'.
export interface StoreOutcome {
  outcome: 'stored' | 'duplicate' | 'error'
  messageId?: string
}

export async function storeMessage(opts: {
  orgId: string
  channelId: string
  parsed: ParsedMail
  channelEmail?: string  // inbox address — used to detect TO vs CC
}): Promise<StoreOutcome> {
  const { orgId, channelId, parsed, channelEmail } = opts

  const externalMessageId = parsed.messageId ?? null
  const fromAddress = firstAddress(parsed.from)
  const subject = parsed.subject
  const receivedAt = (parsed.date ?? new Date()).toISOString()
  const bodyText = parsed.text ?? ''
  const normalizedText = normalizeBody(bodyText)
  const dedupHash = computeDedupHash({ fromAddress, subject: subject ?? null, normalizedText })

  // Idempotency guard #1: same provider message id already captured.
  if (externalMessageId) {
    const { data: dup } = await supabase
      .from('intake_messages')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel_id', channelId)
      .eq('external_message_id', externalMessageId)
      .maybeSingle()
    if (dup) return { outcome: 'duplicate' }
  }

  const threadId = await upsertThread({
    orgId, channelId, subject,
    participants: [...new Set([fromAddress, ...addressList(parsed.to)].filter(Boolean) as string[])],
    receivedAt,
  })

  const { data: message, error } = await supabase
    .from('intake_messages')
    .insert({
      org_id: orgId,
      channel_id: channelId,
      thread_id: threadId,
      external_message_id: externalMessageId,
      direction: 'inbound',
      from_address: fromAddress,
      to_addresses: addressList(parsed.to),
      cc_addresses: addressList(parsed.cc),
      recipient_type: detectRecipientType(channelEmail, addressList(parsed.to), addressList(parsed.cc)),
      subject: subject ?? null,
      body_text: bodyText,
      body_html: typeof parsed.html === 'string' ? parsed.html : null,
      headers: {},
      received_at: receivedAt,
      normalized: { text: normalizedText },
      status: 'normalized',
      dedup_hash: dedupHash,
    })
    .select('id')
    .single()

  if (error) {
    // Unique violation = a concurrent poll already stored it.
    if (error.code === '23505') return { outcome: 'duplicate' }
    log.warn('message insert failed', error.message)
    return { outcome: 'error' }
  }

  await storeAttachments(orgId, message.id, parsed)
  return { outcome: 'stored', messageId: message.id }
}

async function storeAttachments(orgId: string, messageId: string, parsed: ParsedMail) {
  if (!parsed.attachments?.length) return

  for (const att of parsed.attachments) {
    const fileName = att.filename ?? `attachment-${att.checksum ?? Date.now()}`
    const size = att.size ?? att.content?.length ?? 0
    if (size > 26214400) {
      log.warn(`skipping oversized attachment ${fileName} (${size} bytes)`)
      continue
    }
    const storagePath = `${orgId}/${messageId}/${fileName}`

    const { error: upErr } = await supabase.storage
      .from('intake-attachments')
      .upload(storagePath, att.content, {
        contentType: att.contentType ?? 'application/octet-stream',
        upsert: true,
      })
    if (upErr) {
      log.warn(`attachment upload failed (${fileName})`, upErr.message)
      continue
    }

    await supabase.from('intake_attachments').insert({
      org_id: orgId,
      message_id: messageId,
      file_name: fileName,
      file_size: size,
      mime_type: att.contentType ?? null,
      storage_path: storagePath,
      scan_status: 'pending',
    })
  }
}
