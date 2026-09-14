import type { ConversationInbound } from '@/lib/conversations'
import { mapFriendlyGreetingToNew } from './intent'
import { parseCommandButtonId, SUPPORTED_MEDIA_TYPES, type MetaMessage, type SupportedMetaMediaType } from './types'

export type InboundMapResult =
  | { ok: true; inbound: ConversationInbound }
  | { ok: false; reason: 'unsupported_type' | 'empty_interactive' }

/**
 * Step 7 — the thin, business-logic-free adapter from a single Meta message
 * object to Stage 4's generic ConversationInbound. This function makes no
 * decision about which service/sub-category/field is valid, what's
 * mandatory, or whether a ticket can be created — it only maps transport
 * shapes. Every business decision happens inside processConversationInbound().
 */
export function mapMetaMessageToInbound(params: {
  message: MetaMessage
  orgId: string
  requesterId: string
  channelIdentity: string
}): InboundMapResult {
  const { message, orgId, requesterId, channelIdentity } = params
  const base = {
    externalMessageId: message.id,
    orgId,
    requesterId,
    channelType: 'whatsapp' as const,
    channelIdentity,
    receivedAt: new Date(Number(message.timestamp) * 1000 || Date.now()).toISOString(),
  }

  if (message.type === 'text' && message.text) {
    const greeting = mapFriendlyGreetingToNew(message.text.body)
    if (greeting) return { ok: true, inbound: { ...base, kind: 'command', text: greeting } }
    return { ok: true, inbound: { ...base, kind: 'text', text: message.text.body } }
  }

  if (message.type === 'interactive' && message.interactive) {
    const reply = message.interactive.list_reply ?? message.interactive.button_reply
    if (!reply) return { ok: false, reason: 'empty_interactive' }
    const command = parseCommandButtonId(reply.id)
    if (command) return { ok: true, inbound: { ...base, kind: 'command', text: command } }
    return { ok: true, inbound: { ...base, kind: 'selection', selectionId: reply.id } }
  }

  // A reply tapped on an approved message TEMPLATE's quick-reply button
  // (distinct from an interactive list/button message) — payload carries
  // the same kind of canonical id our own templates would define. Not used
  // by the Phase-1 ticket-creation flow (Step 21: no templates required
  // inside it) but handled safely rather than falling into "unsupported".
  if (message.type === 'button' && message.button) {
    const command = parseCommandButtonId(message.button.payload)
    if (command) return { ok: true, inbound: { ...base, kind: 'command', text: command } }
    return { ok: true, inbound: { ...base, kind: 'selection', selectionId: message.button.payload } }
  }

  if (SUPPORTED_MEDIA_TYPES.includes(message.type as SupportedMetaMediaType)) {
    const media = message[message.type as SupportedMetaMediaType]
    if (!media) return { ok: false, reason: 'unsupported_type' }
    return {
      ok: true,
      inbound: {
        ...base,
        kind: 'file',
        attachment: {
          externalMediaId: media.id,
          fileName: media.filename,
          mimeType: media.mime_type,
        },
      },
    }
  }

  // Step 18 — audio/location/contacts/sticker/reaction/unknown interactive
  // subtypes and anything else Meta might send: handled safely, never
  // crashes, never misread as text.
  return { ok: false, reason: 'unsupported_type' }
}
