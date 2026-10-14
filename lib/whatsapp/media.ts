import { findAttachmentsForConversation, updateAttachmentStatus, type ConversationAttachment } from '@/lib/conversations'
import type { WhatsAppGraphClient } from './graph-client'
import { ALLOWED_MIME_SET as ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES as MAX_ATTACHMENT_SIZE, contentMatchesDeclaredType } from '@/lib/attachments/validate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; storage: any }

// The allow-list, size limit and magic-byte check are the web upload's own (lib/attachments/validate.ts), so a WhatsApp attachment is held to
// the identical standard and the two cannot drift apart (D-055). SVG is excluded there on purpose: opened from a direct link it would run its script.

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
