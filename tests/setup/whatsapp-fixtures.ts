import { createHmac } from 'crypto'
import { getAdmin } from './fixtures-d03'

export type WhatsAppChannelFixture = {
  channelId: string
  orgId: string
  phoneNumberId: string
  accessToken: string
  appSecret: string
  verifyToken: string
  cleanup: () => Promise<void>
}

/**
 * Creates a real, active WhatsApp intake_channel with a real Supabase Vault
 * secret (via the actual intake_store_credential RPC — the same one
 * production code path uses), so Stage 5 integration tests exercise the
 * genuine channel-resolution + credential-decryption path rather than a
 * mock. Never sends a real Graph API request itself.
 */
export async function setupWhatsAppChannelFixture(params: {
  runTag: string
  orgId?: string
  phoneNumberId: string
}): Promise<WhatsAppChannelFixture> {
  const admin = getAdmin()
  const orgId = params.orgId ?? '00000000-0000-0000-0000-000000000001'
  const accessToken = `test-access-token-${params.runTag}`
  const appSecret = `test-app-secret-${params.runTag}`
  const verifyToken = `test-verify-token-${params.runTag}`

  const { data: channel, error } = await admin
    .from('intake_channels')
    .insert({
      org_id: orgId,
      type: 'whatsapp',
      name: `WhatsApp ${params.runTag}`,
      config: { phone_number_id: params.phoneNumberId },
      status: 'active',
    })
    .select('id')
    .single()
  if (error || !channel) throw new Error(`[whatsapp-fixtures] failed to create channel: ${error?.message}`)

  const secret = JSON.stringify({ type: 'whatsapp', access_token: accessToken, app_secret: appSecret, verify_token: verifyToken })
  const { error: vaultErr } = await admin.rpc('intake_store_credential', { p_channel_id: channel.id, p_secret: secret })
  if (vaultErr) throw new Error(`[whatsapp-fixtures] failed to store credential: ${vaultErr.message}`)

  return {
    channelId: channel.id,
    orgId,
    phoneNumberId: params.phoneNumberId,
    accessToken,
    appSecret,
    verifyToken,
    cleanup: async () => {
      await admin.from('intake_channels').delete().eq('id', channel.id)
    },
  }
}

export function signPayload(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
}

let nextWamid = 1
export function nextMessageId(runTag: string): string {
  return `wamid.${runTag}.${nextWamid++}`
}

export function buildTextMessagePayload(params: {
  phoneNumberId: string
  from: string
  body: string
  messageId?: string
  runTag?: string
}): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: params.phoneNumberId, display_phone_number: params.phoneNumberId },
          contacts: [{ wa_id: params.from, profile: { name: 'Test User' } }],
          messages: [{
            from: params.from,
            id: params.messageId ?? nextMessageId(params.runTag ?? 'wa'),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: params.body },
          }],
        },
      }],
    }],
  })
}

export function buildInteractivePayload(params: {
  phoneNumberId: string
  from: string
  replyId: string
  replyTitle?: string
  kind?: 'list_reply' | 'button_reply'
  messageId?: string
  runTag?: string
}): string {
  const kind = params.kind ?? 'list_reply'
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: params.phoneNumberId, display_phone_number: params.phoneNumberId },
          messages: [{
            from: params.from,
            id: params.messageId ?? nextMessageId(params.runTag ?? 'wa'),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: {
              type: kind,
              [kind]: { id: params.replyId, title: params.replyTitle ?? params.replyId },
            },
          }],
        },
      }],
    }],
  })
}

export function buildMediaMessagePayload(params: {
  phoneNumberId: string
  from: string
  mediaType: 'image' | 'document' | 'audio' | 'video'
  mediaId: string
  mimeType?: string
  fileName?: string
  messageId?: string
  runTag?: string
}): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: params.phoneNumberId, display_phone_number: params.phoneNumberId },
          messages: [{
            from: params.from,
            id: params.messageId ?? nextMessageId(params.runTag ?? 'wa'),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: params.mediaType,
            [params.mediaType]: { id: params.mediaId, mime_type: params.mimeType, filename: params.fileName },
          }],
        },
      }],
    }],
  })
}

export function buildStatusEventPayload(params: {
  phoneNumberId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  recipientId: string
  statusId?: string
}): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: params.phoneNumberId, display_phone_number: params.phoneNumberId },
          statuses: [{ id: params.statusId ?? `wamid.status.${Date.now()}`, status: params.status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: params.recipientId }],
        },
      }],
    }],
  })
}

export type MockFetchCall = { url: string; init?: RequestInit }

/**
 * A minimal, injectable mock of the global `fetch` used by
 * WhatsAppGraphClient (Step 25 test mode) — real Stage 4/5 code runs
 * unmocked; only this one outbound HTTP boundary is faked. Tracks every
 * call so a test can assert on Authorization headers, URLs, etc., and lets
 * a test register fake media (id -> {mimeType, buffer, fileSize}) that a
 * "GET /{media-id}" + subsequent "GET <url>" pair will resolve to, mirroring
 * Meta's real two-step media download.
 */
export function createMockGraphFetch() {
  const calls: MockFetchCall[] = []
  const media = new Map<string, { mimeType: string; buffer: Buffer; fileSize?: number }>()
  let sendShouldFail: { status: number; body?: unknown } | null = null
  // Stage 5.1 (Part 4) — lets a test simulate "fails N times, then
  // recovers" to exercise sendAll()'s bounded retry, rather than only a
  // permanent failure.
  let sendFailuresRemaining = 0

  function setMediaFixture(mediaId: string, fixture: { mimeType: string; buffer: Buffer; fileSize?: number }) {
    media.set(mediaId, fixture)
  }
  function setSendFailure(failure: { status: number; body?: unknown } | null, count = Infinity) {
    sendShouldFail = failure
    sendFailuresRemaining = failure ? count : 0
  }

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString()
    calls.push({ url: u, init })

    // Outbound send: POST .../messages
    if (u.includes('/messages') && init?.method === 'POST') {
      if (sendShouldFail && sendFailuresRemaining > 0) {
        sendFailuresRemaining -= 1
        return new Response(JSON.stringify(sendShouldFail.body ?? { error: { message: 'Simulated failure' } }), { status: sendShouldFail.status })
      }
      return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${calls.length}` }] }), { status: 200 })
    }

    // Media content download: GET https://mock-media.example/{media-id} — checked
    // BEFORE the metadata-lookup endsWith() below, since that download URL also
    // (deliberately) ends with "/{media-id}" and would otherwise shadow it.
    for (const [mediaId, fixture] of media) {
      if (u === `https://mock-media.example/${mediaId}`) {
        return new Response(new Uint8Array(fixture.buffer), { status: 200, headers: { 'content-type': fixture.mimeType } })
      }
    }

    // Media metadata lookup: GET .../{media-id}
    for (const [mediaId, fixture] of media) {
      if (u.endsWith(`/${mediaId}`)) {
        return new Response(JSON.stringify({
          url: `https://mock-media.example/${mediaId}`,
          mime_type: fixture.mimeType,
          sha256: 'mock-sha256',
          file_size: fixture.fileSize ?? fixture.buffer.length,
          id: mediaId,
        }), { status: 200 })
      }
    }

    // Connection test: GET .../{phone_number_id}?fields=...
    if (u.includes('?fields=')) {
      return new Response(JSON.stringify({ display_phone_number: '+911234567890' }), { status: 200 })
    }

    return new Response(JSON.stringify({ error: { message: `Unhandled mock URL: ${u}` } }), { status: 404 })
  }) as typeof fetch

  return { fetchImpl, calls, setMediaFixture, setSendFailure }
}

export function buildUnsupportedMessagePayload(params: {
  phoneNumberId: string
  from: string
  type: 'sticker' | 'reaction' | 'location' | 'contacts'
  messageId?: string
  runTag?: string
}): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: params.phoneNumberId, display_phone_number: params.phoneNumberId },
          messages: [{
            from: params.from,
            id: params.messageId ?? nextMessageId(params.runTag ?? 'wa'),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: params.type,
          }],
        },
      }],
    }],
  })
}
