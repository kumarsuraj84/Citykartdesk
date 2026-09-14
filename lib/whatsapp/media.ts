import { findAttachmentsForConversation, updateAttachmentStatus, type ConversationAttachment } from '@/lib/conversations'
import type { WhatsAppGraphClient } from './graph-client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; storage: any }

// Same allowlist lib/actions/attachments.ts enforces for the normal web
// upload flow, so a WhatsApp-sourced attachment is held to the identical
// standard — deliberately excludes image/svg+xml even though the
// request-attachments bucket's own (broader, legacy) config permits it: an
// attachment opened via a direct signed-URL link renders rather than
// downloads, so an SVG's embedded <script> would execute (see
// lib/actions/attachments.ts's own comment for the same reasoning).
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav',
])

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024 // matches request_attachments' file_size CHECK

const MAGIC_BYTES: Map<string, number[][]> = new Map([
  ['image/jpeg', [[0xff, 0xd8, 0xff]]],
  ['image/png', [[0x89, 0x50, 0x4e, 0x47]]],
  ['image/gif', [[0x47, 0x49, 0x46, 0x38]]],
  ['image/webp', [[0x52, 0x49, 0x46, 0x46]]],
  ['application/pdf', [[0x25, 0x50, 0x44, 0x46]]],
  ['application/zip', [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]]],
  ['application/x-zip-compressed', [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]]],
  ['video/mp4', [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]]],
])
const ZIP_BASED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])
const ZIP_SIGNATURES = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]]

function signaturesMatch(bytes: Buffer, signatures: number[][], offset = 0): boolean {
  return signatures.some((sig) => sig.every((byte, i) => bytes[offset + i] === byte))
}

/** Buffer-based magic-byte check — the declared MIME type from Meta is
 *  attacker-influenced (it's whatever the sender's WhatsApp client claimed),
 *  so it is never trusted on its own (Step 10's explicit requirement). */
function contentMatchesDeclaredType(content: Buffer, mimeType: string): boolean {
  if (ZIP_BASED_MIME_TYPES.has(mimeType)) return signaturesMatch(content, ZIP_SIGNATURES)
  if (mimeType === 'video/mp4') return signaturesMatch(content, MAGIC_BYTES.get('video/mp4')!, 4)
  if (MAGIC_BYTES.has(mimeType)) return signaturesMatch(content, MAGIC_BYTES.get(mimeType)!)
  return true // no known signature for this type (e.g. plain text, audio) — allowlist membership is the only gate
}

export type RetrieveMediaResult =
  | { ok: true; buffer: Buffer; mimeType: string; size: number }
  | { ok: false; reason: 'lookup_failed' | 'disallowed_type' | 'too_large' | 'download_failed' | 'content_mismatch'; message: string }

/**
 * Step 10 — retrieves ONE piece of WhatsApp media and validates it before
 * it may ever be treated as satisfying a required attachment: media must
 * exist, download must succeed, MIME/type must be allowed, size must be
 * acceptable, and the actual bytes must match the declared type. Only if
 * every check passes does the caller move the reference from
 * 'received_reference' to 'persisted'.
 */
export async function retrieveAndValidateMedia(client: WhatsAppGraphClient, mediaId: string): Promise<RetrieveMediaResult> {
  const meta = await client.getMediaUrl(mediaId)
  if (!meta.ok) return { ok: false, reason: 'lookup_failed', message: meta.message }

  const declaredType = (meta.mimeType ?? '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(declaredType)) {
    return { ok: false, reason: 'disallowed_type', message: `Disallowed content type "${declaredType || '(none)'}"` }
  }
  if (meta.fileSize != null && meta.fileSize > MAX_ATTACHMENT_SIZE) {
    return { ok: false, reason: 'too_large', message: `File too large (${meta.fileSize} bytes)` }
  }

  const download = await client.downloadMedia(meta.url)
  if (!download.ok) return { ok: false, reason: 'download_failed', message: download.message }
  if (download.buffer.length > MAX_ATTACHMENT_SIZE) {
    return { ok: false, reason: 'too_large', message: `File too large (${download.buffer.length} bytes)` }
  }
  if (!contentMatchesDeclaredType(download.buffer, declaredType)) {
    return { ok: false, reason: 'content_mismatch', message: 'Content does not match declared type' }
  }

  return { ok: true, buffer: download.buffer, mimeType: declaredType, size: download.buffer.length }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')
}

const STAGING_BUCKET = 'request-attachments'

/** `staging/<org>/<conversation>/<field>_<ts>_<rand>_<name>` — reuses the
 *  existing request-attachments bucket (Part 3's "prefer existing storage
 *  infrastructure" instruction) under a prefix no promoted/final object
 *  ever uses, so a staged and a linked copy of the same file can never
 *  collide. Never publicly listable; access requires knowing the exact
 *  path (conversation/field ids are UUIDs — the same "unguessable path"
 *  model the bucket's existing objects already rely on) plus the
 *  service-role-only write policy already enforced on this bucket. */
function buildStagingPath(orgId: string, conversationId: string, fieldId: string, fileName: string): string {
  const safe = sanitizeFileName(fileName)
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `staging/${orgId}/${conversationId}/${fieldId}_${ts}_${rand}_${safe}`
}

function buildFinalPath(requestId: string, fileName: string): string {
  const safe = sanitizeFileName(fileName)
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `${requestId}/${ts}_${rand}_${safe}`
}

export type StageMediaResult =
  | { ok: true; storagePath: string; mimeType: string; size: number }
  | { ok: false; reason: string }

/**
 * Stage 5.1 (Part 3) — retrieves, validates, and durably stores ONE piece
 * of WhatsApp media at inbound-file-message time, BEFORE Review/Create can
 * ever be reached — this is the function wired as lib/conversations'
 * injected MediaStager (see webhook-handler.ts). Reuses
 * retrieveAndValidateMedia() (the same download+MIME+magic-byte+size
 * pipeline Stage 5 originally ran only at post-Create link time) so there
 * is exactly one validation implementation, run earlier.
 */
export async function stageMediaForConversation(params: {
  admin: AnyClient
  client: WhatsAppGraphClient
  orgId: string
  conversationId: string
  fieldId: string
  externalMediaId: string
  fileName: string | null
}): Promise<StageMediaResult> {
  const { admin, client, orgId, conversationId, fieldId, externalMediaId, fileName } = params
  const result = await retrieveAndValidateMedia(client, externalMediaId)
  if (!result.ok) return { ok: false, reason: result.message }

  const storagePath = buildStagingPath(orgId, conversationId, fieldId, fileName || `${fieldId}-file`)
  const { error: storageError } = await admin.storage
    .from(STAGING_BUCKET)
    .upload(storagePath, result.buffer, { contentType: result.mimeType, upsert: false })
  if (storageError) return { ok: false, reason: `storage upload failed: ${storageError.message}` }

  return { ok: true, storagePath, mimeType: result.mimeType, size: result.size }
}

export type LinkAttachmentsSummary = {
  linked: number
  failed: { fieldId: string; externalMediaId: string | null; reason: string }[]
}

/**
 * Step 11 / Stage 5.1 Part 3 — after createRequestCore() has already
 * produced a real request, PROMOTES every already-STAGED
 * conversation_attachments row into the SAME request_attachments model the
 * normal web UI uses (not a WhatsApp-only attachment system), by MOVING
 * (never re-downloading — Meta media URLs/references may be temporary,
 * and the binary was already retrieved/validated once at staging time) the
 * durable object from its staging path to the final
 * `<requestId>/...` path. Uses the admin/service-role client directly
 * (this runs from a webhook, with no browser session to satisfy
 * lib/actions/attachments.ts's uploadAttachment() auth check).
 *
 * A ticket has already been created by the time this runs; a failure here
 * NEVER creates a second ticket and never undoes the first — it only marks
 * the specific attachment 'failed' (the staged object is left exactly
 * where it is, never deleted on a link failure, so it remains available
 * for a later reconciliation) and logs enough to reconcile manually.
 */
export async function linkConversationAttachmentsToRequest(params: {
  admin: AnyClient
  conversationId: string
  requestId: string
  requesterId: string
}): Promise<LinkAttachmentsSummary> {
  const { admin, conversationId, requestId, requesterId } = params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachments = await findAttachmentsForConversation({ admin: admin as any, conversationId })
  const pending = attachments.filter((a: ConversationAttachment) => a.status === 'staged' && a.storagePath)

  const summary: LinkAttachmentsSummary = { linked: 0, failed: [] }

  for (const attachment of pending) {
    const fileName = attachment.fileName || `whatsapp-${attachment.fieldId}`
    const finalPath = buildFinalPath(requestId, fileName)

    const { error: moveError } = await admin.storage.from(STAGING_BUCKET).move(attachment.storagePath!, finalPath)
    if (moveError) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateAttachmentStatus({ admin: admin as any, attachmentId: attachment.id, status: 'failed', lastError: `storage move failed: ${moveError.message}` })
      summary.failed.push({ fieldId: attachment.fieldId, externalMediaId: attachment.externalMediaId, reason: `storage move failed: ${moveError.message}` })
      continue
    }

    const { error: insertError } = await admin.from('request_attachments').insert({
      request_id: requestId,
      uploaded_by: requesterId,
      file_name: fileName,
      file_size: attachment.stagedSize ?? attachment.size ?? 0,
      mime_type: attachment.stagedMimeType ?? attachment.mimeType ?? 'application/octet-stream',
      storage_path: finalPath,
      is_internal: false,
    })

    if (insertError) {
      // Move the object BACK to its staging path so it's still findable at
      // the path this row's own storage_path continues to record — never
      // left dangling at a `request_attachments`-less final path.
      await admin.storage.from(STAGING_BUCKET).move(finalPath, attachment.storagePath!)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateAttachmentStatus({ admin: admin as any, attachmentId: attachment.id, status: 'failed', lastError: `db insert failed: ${insertError.message}` })
      summary.failed.push({ fieldId: attachment.fieldId, externalMediaId: attachment.externalMediaId, reason: `db insert failed: ${insertError.message}` })
      continue
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateAttachmentStatus({ admin: admin as any, attachmentId: attachment.id, status: 'linked' })
    summary.linked += 1
  }

  return summary
}
