import { processConversationInbound, findConversationById, type ConversationResult, type MediaStager } from '@/lib/conversations'
import { resolveUserByWhatsAppNumber } from '@/lib/users/resolveWhatsAppUser'
import { rateLimit } from '@/lib/rate-limit'
import {
  findActiveWhatsAppChannelByPhoneNumberId,
  loadWhatsAppSecret,
  resolveGraphApiVersion,
  type WhatsAppChannelRow,
} from './config'
import { verifyMetaSignature } from './signature'
import { mapMetaMessageToInbound } from './inbound-adapter'
import { renderConversationResult } from './render'
import { WhatsAppGraphClient, type FetchLike } from './graph-client'
import { linkConversationAttachmentsToRequest, stageMediaForConversation } from './media'
import { MetaWebhookPayloadSchema, SUPPORTED_MEDIA_TYPES, type MetaMessage, type MetaStatus, type SupportedMetaMediaType } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any; storage: any }

const UNREGISTERED_NUMBER_MESSAGE =
  'This mobile number is not registered for Citykart DESK WhatsApp access.\n\n' +
  'Please contact your administrator to update your registered mobile number in Citykart DESK.'

const UNSUPPORTED_MESSAGE = 'Sorry, this type of message is not supported yet. Please reply with text, or use the buttons/list provided.'

export type WebhookProcessOutcome =
  | { kind: 'processed'; conversationId: string; state: string; deliveryFailed?: boolean }
  | { kind: 'rejected_sender'; reason: string }
  | { kind: 'unsupported' }
  | { kind: 'rate_limited' }
  | { kind: 'status_event' }
  | { kind: 'channel_not_found' }
  | { kind: 'channel_conflict' }
  | { kind: 'invalid_signature' }

// Step 20 — audit logging, reusing the existing append-only intake_audit_log
// table/pattern (lib/actions/intake/channels.ts's own logIntakeAudit) rather
// than a new table. Never logs the access token, the raw webhook payload, or
// attachment binaries — only ids, types, and outcomes.
//
// Stage 5.1 bug found during Part 4's own testing: intake_audit_log.entity_id
// is a genuine `UUID` column (not text) — Stage 5's original calls passed
// Meta's own identifiers (a wamid like "wamid.HBgL...", a phone_number_id)
// straight through as `entityId`, which is NOT a UUID. Every such INSERT
// failed with a Postgres type-cast error, silently swallowed by this
// function's own try/catch — meaning most WhatsApp audit trail entries
// (whatsapp_message_processed, _rate_limited, _sender_rejected,
// _unsupported_message, _status_event, _channel_not_found/_conflict) were
// NEVER actually written, undetected because nothing had asserted on their
// presence before. Fixed by only ever passing a REAL UUID (an actual
// channel id / request id) as `entityId`, and moving every Meta-native
// identifier (wamid, phone_number_id) into `metadata` instead, which is
// JSONB and accepts any string.
async function logWhatsAppAudit(admin: AnyClient, entry: {
  orgId: string | null
  entityId?: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    // Stage 6 Part 22 bug found during audit-log-coverage testing:
    // intake_audit_log.org_id is NOT NULL, but a phone_number_id that
    // matches no channel (or matches more than one) is BY DEFINITION
    // org-less — there is no org to attribute the event to. Every such
    // insert was failing the NOT NULL constraint and being silently
    // swallowed by this function's own try/catch, so
    // whatsapp_channel_not_found/whatsapp_channel_conflict events were
    // never actually persisted anywhere — the same class of bug as the
    // entity_id fix above, just on a different column. Routed instead to
    // owner_audit_log, the one audit table that already models a nullable
    // org_id for exactly this kind of platform-level, pre-org event.
    if (entry.orgId === null) {
      await admin.from('owner_audit_log').insert({
        org_id: null,
        actor_id: null,
        action: entry.action,
        metadata: entry.metadata ?? {},
      })
      return
    }
    await admin.from('intake_audit_log').insert({
      org_id: entry.orgId,
      actor_id: null,
      entity_type: 'whatsapp_message',
      entity_id: entry.entityId ?? null,
      action: entry.action,
      metadata: entry.metadata ?? {},
    })
  } catch {
    // best-effort — never let audit logging break message processing
  }
}

const SEND_RETRY_DELAYS_MS = [300, 900]

/**
 * Stage 5.1 (Part 4) — audit finding: Stage 5's original sendAll() awaited
 * every send but never checked the result. If Stage 4 successfully
 * advanced the conversation (already committed) and the outbound send then
 * failed, the requester silently never saw the next prompt — their
 * following message would be evaluated against a state they never
 * actually observed. Documented in full in STAGE_5_1_REPORT.md ("Outbound
 * Send Failure Audit" / "Outbound Recovery Behavior").
 *
 * Minimum hardening (deliberately NOT a durable outbound queue — Part 4's
 * explicit instruction): a bounded, synchronous, in-request retry for any
 * `retryable`-classified failure (429/5xx/network — see
 * graph-client.ts:GraphErrorClass), which resolves the overwhelming
 * majority of real Meta API hiccups within the same webhook request. Only
 * an `auth`/`non_retryable` failure, or a `retryable` one that still fails
 * after every retry, is left undelivered — returned to the caller so it
 * can be audited (never silently dropped).
 */
async function sendAll(client: WhatsAppGraphClient, to: string, result: ConversationResult): Promise<{ allDelivered: boolean }> {
  const messages = renderConversationResult(result)
  let allDelivered = true
  for (const message of messages) {
    let delivered = false
    for (let attempt = 0; attempt <= SEND_RETRY_DELAYS_MS.length; attempt++) {
      const sendResult = await client.sendMessage(to, message)
      if (sendResult.ok) { delivered = true; break }
      if (sendResult.errorClass !== 'retryable' || attempt === SEND_RETRY_DELAYS_MS.length) break
      await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_DELAYS_MS[attempt]))
    }
    if (!delivered) allDelivered = false
  }
  return { allDelivered }
}

/** Stage 5.1 (Part 3) — the MediaStager Stage 4's orchestrator calls
 *  synchronously, inline, before deciding whether a mandatory file field is
 *  satisfied. Thin closure over the already-resolved admin client and
 *  per-message WhatsAppGraphClient; all the actual retrieve/validate/store
 *  logic lives in lib/whatsapp/media.ts (stageMediaForConversation), kept
 *  out of lib/conversations entirely. */
function buildMediaStager(admin: AnyClient, client: WhatsAppGraphClient): MediaStager {
  return async ({ orgId, conversationId, fieldId, externalMediaId, fileName }) => {
    const result = await stageMediaForConversation({ admin, client, orgId, conversationId, fieldId, externalMediaId, fileName })
    return result.ok
      ? { ok: true, storagePath: result.storagePath, mimeType: result.mimeType, size: result.size }
      : { ok: false, reason: result.reason }
  }
}

/** One real inbound WhatsApp message, already known to belong to a
 *  resolved, active channel with a verified signature. Handles rate
 *  limiting, sender identity, mapping, Stage 4 processing, attachment
 *  linking, and rendering the response back out. */
export async function handleWhatsAppInboundMessage(params: {
  admin: AnyClient
  message: MetaMessage
  channel: WhatsAppChannelRow
  client: WhatsAppGraphClient
}): Promise<WebhookProcessOutcome> {
  const { admin, message, channel, client } = params

  // Step 19 — per-sender rate limiting. Generous enough that a real,
  // multi-message ticket-creation conversation is never throttled (a full
  // flow is well under a dozen messages); tight enough to blunt a single
  // number flooding the webhook.
  const senderLimit = await rateLimit(`whatsapp:msg:${channel.orgId}:${message.from}`, 30, 60_000)
  if (senderLimit.limited) {
    await logWhatsAppAudit(admin, { orgId: channel.orgId, action: 'whatsapp_rate_limited', metadata: { from: message.from, externalMessageId: message.id } })
    return { kind: 'rate_limited' }
  }

  const resolved = await resolveUserByWhatsAppNumber({ orgId: channel.orgId, phoneNumber: message.from, client: admin })
  if (!resolved.ok) {
    // Step 19 — a second, tighter limiter specifically for repeated
    // invalid/unregistered numbers against this channel, to blunt number
    // enumeration without touching the generous per-sender message limiter
    // above (a legitimate but not-yet-registered employee retrying a few
    // times must not be mistaken for an attack).
    const invalidLimit = await rateLimit(`whatsapp:invalid:${channel.orgId}:${message.from}`, 5, 300_000)
    await logWhatsAppAudit(admin, { orgId: channel.orgId, action: 'whatsapp_sender_rejected', metadata: { reason: resolved.reason, externalMessageId: message.id } })
    if (!invalidLimit.limited) {
      await client.sendMessage(message.from, { type: 'text', text: { body: UNREGISTERED_NUMBER_MESSAGE } })
    }
    return { kind: 'rejected_sender', reason: resolved.reason }
  }

  const mapped = mapMetaMessageToInbound({
    message,
    orgId: channel.orgId,
    requesterId: resolved.profile.profileId,
    channelIdentity: message.from,
  })
  if (!mapped.ok) {
    await logWhatsAppAudit(admin, { orgId: channel.orgId, action: 'whatsapp_unsupported_message', metadata: { reason: mapped.reason, type: message.type, externalMessageId: message.id } })
    await client.sendMessage(message.from, { type: 'text', text: { body: UNSUPPORTED_MESSAGE } })
    return { kind: 'unsupported' }
  }

  const result = await processConversationInbound(mapped.inbound, { mediaStager: buildMediaStager(admin, client) })

  await logWhatsAppAudit(admin, {
    orgId: channel.orgId,
    action: 'whatsapp_message_processed',
    metadata: { conversationId: result.conversationId, state: result.state, duplicate: !!result.duplicate, type: message.type, externalMessageId: message.id },
  })

  // Step 11 — link durable attachment references into the normal
  // request_attachments model exactly once, the first time this
  // conversation is genuinely (not a replayed duplicate) observed
  // 'completed' with a real request id.
  if (result.state === 'completed' && !result.duplicate) {
    const conversation = await findConversationById({ admin, orgId: channel.orgId, id: result.conversationId })
    if (conversation?.requestId) {
      const summary = await linkConversationAttachmentsToRequest({
        admin,
        conversationId: conversation.id,
        requestId: conversation.requestId,
        requesterId: conversation.requesterId,
      })
      if (summary.failed.length > 0) {
        await logWhatsAppAudit(admin, {
          orgId: channel.orgId,
          entityId: conversation.requestId,
          action: 'whatsapp_attachment_link_failed',
          metadata: { conversationId: conversation.id, failures: summary.failed },
        })
      }
    }
  }

  const { allDelivered } = await sendAll(client, message.from, result)
  if (!allDelivered) {
    // Step 20 / Part 4 — the requester's state HAS already advanced
    // (committed by Stage 4 above) but they never received confirmation of
    // it. No durable retry queue exists to recover this automatically
    // (Part 4's explicit scope boundary); this audit entry is what makes a
    // persistent delivery failure visible for manual follow-up rather than
    // silently lost. See STAGE_5_1_REPORT.md "Outbound Recovery Behavior"
    // for why this is deliberately the stopping point for Stage 5.1.
    await logWhatsAppAudit(admin, {
      orgId: channel.orgId,
      action: 'whatsapp_send_failed',
      metadata: { conversationId: result.conversationId, state: result.state, externalMessageId: message.id },
    })
  }

  return { kind: 'processed', conversationId: result.conversationId, state: result.state, deliveryFailed: !allDelivered }
}

async function handleStatusEvent(admin: AnyClient, orgId: string, status: MetaStatus): Promise<void> {
  // Step 17 — recorded for debugging/audit only, NEVER fed into
  // processConversationInbound as a user message. Reuses intake_audit_log
  // rather than a new dedicated status table (Step 16 "do not overbuild").
  await logWhatsAppAudit(admin, {
    orgId,
    action: 'whatsapp_status_event',
    metadata: { status: status.status, recipientId: status.recipient_id, errors: status.errors, externalStatusId: status.id },
  })
}

export type WebhookRunResult = { outcomes: WebhookProcessOutcome[] }

/**
 * Step 4/5/16 — the full POST processing pipeline: verifies the signature
 * against the channel resolved from the payload's own phone_number_id
 * (never the sender), then fans out every message/status in the payload.
 * Returns quickly per-message (no long-running work is awaited beyond a
 * single message's own processing) since there is no background queue in
 * this deployment (Step 16 — documented Phase-1 synchronous design).
 */
export async function processWhatsAppWebhookPayload(params: {
  admin: AnyClient
  rawBody: string
  signatureHeader: string | null
  fetchImpl?: FetchLike
}): Promise<{ outcome: WebhookProcessOutcome } & Partial<WebhookRunResult>> {
  const { admin, rawBody, signatureHeader, fetchImpl } = params

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { outcome: { kind: 'unsupported' } }
  }
  const payload = MetaWebhookPayloadSchema.safeParse(parsed)
  if (!payload.success) return { outcome: { kind: 'unsupported' } }

  const firstValue = payload.data.entry[0]?.changes[0]?.value
  const phoneNumberId = firstValue?.metadata.phone_number_id
  if (!phoneNumberId) return { outcome: { kind: 'unsupported' } }

  const channelResult = await findActiveWhatsAppChannelByPhoneNumberId(admin, phoneNumberId)
  if (!channelResult.ok) {
    await logWhatsAppAudit(admin, { orgId: null, action: `whatsapp_channel_${channelResult.reason}`, metadata: { phoneNumberId } })
    return { outcome: channelResult.reason === 'conflict' ? { kind: 'channel_conflict' } : { kind: 'channel_not_found' } }
  }
  const { channel } = channelResult

  const secret = await loadWhatsAppSecret(admin, channel)
  if (!secret || !verifyMetaSignature(rawBody, signatureHeader, secret.app_secret)) {
    await logWhatsAppAudit(admin, { orgId: channel.orgId, entityId: channel.id, action: 'whatsapp_invalid_signature' })
    return { outcome: { kind: 'invalid_signature' } }
  }

  const client = new WhatsAppGraphClient(phoneNumberId, secret.access_token, resolveGraphApiVersion(channel), fetchImpl)
  const outcomes: WebhookProcessOutcome[] = []

  for (const entry of payload.data.entry) {
    for (const change of entry.changes) {
      for (const status of change.value.statuses ?? []) {
        await handleStatusEvent(admin, channel.orgId, status)
        outcomes.push({ kind: 'status_event' })
      }
      for (const message of change.value.messages ?? []) {
        outcomes.push(await handleWhatsAppInboundMessage({ admin, message, channel, client }))
      }
    }
  }

  return { outcome: outcomes[0] ?? { kind: 'unsupported' }, outcomes }
}

// Re-exported for the media types union check in the route/tests without a
// second import path.
export type { SupportedMetaMediaType }
export { SUPPORTED_MEDIA_TYPES }
