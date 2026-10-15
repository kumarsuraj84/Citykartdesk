'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logActivity } from '@/lib/activity'
import { validateAttachment, ALLOWED_MIME_SET as ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES as MAX_FILE_SIZE } from '@/lib/attachments/validate'

// ── Constants ─────────────────────────────────────────────────────────────────



type UploadResult =
  | { attachmentId: string; error?: never }
  | { error: string; attachmentId?: never }

type ActionResult = { error?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function sanitizeFileName(name: string): string {
  // Keep only safe characters; collapse runs of unsafe chars to underscore
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')
}

function buildStoragePath(requestId: string, fileName: string): string {
  const safe = sanitizeFileName(fileName)
  const ts = Date.now()
  // Math.random is acceptable here — this is a path suffix for uniqueness,
  // not a security-critical token. The storage bucket is private.
  const rand = Math.random().toString(36).slice(2, 8)
  return `${requestId}/${ts}_${rand}_${safe}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── uploadAttachment ──────────────────────────────────────────────────────────

export async function uploadAttachment(
  requestId: string,
  formData: FormData,
  commentId?: string | null
): Promise<UploadResult> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'You must be signed in to upload files.' }

  // ── File extraction ───────────────────────────────────────────────────────
  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return { error: 'No file provided.' }
  }

  // ── Client-supplied validations (fast rejection) ──────────────────────────
  if (file.size === 0) return { error: 'The file is empty.' }

  if (file.size > MAX_FILE_SIZE) {
    return {
      error: `File too large. Maximum size is 25 MB (this file is ${formatBytes(file.size)}).`,
    }
  }

  const ext = getExtension(file.name)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      error: `File type .${ext} is not allowed. Allowed: PNG, JPG, GIF, WEBP, PDF, DOC, DOCX, XLS, XLSX, TXT, CSV.`,
    }
  }

  // Content-type check against allowlist (client-supplied)
  const mimeType = file.type || 'application/octet-stream'
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      error: `File content type "${mimeType}" is not allowed.`,
    }
  }

  // Buffer-level check: confirms the file's actual bytes match the declared
  // MIME type instead of trusting the client-supplied Content-Type alone —
  // this runs server-side, so it can't be bypassed the way the identical
  // client-side check in CommentForm/PendingFileField can (a direct call to
  // this action skips the browser entirely).
  const magicByteCheck = await validateAttachment(file)
  if (!magicByteCheck.valid) {
    return { error: magicByteCheck.error ?? 'File content does not match its declared type.' }
  }

  // ── Request access check ──────────────────────────────────────────────────
  const { data: request } = await supabase
    .from('requests')
    .select('id, team_id, requester_id')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found.' }

  const isRequester = request.requester_id === profile.id
  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  if (!isRequester && !isAgent) {
    return { error: 'You do not have permission to attach files to this request.' }
  }

  // ── Comment association check ─────────────────────────────────────────────
  // Files are attached inline to the reply they were sent with — confirm the given
  // comment actually belongs to this request so a caller can't graft a file onto
  // an unrelated request's comment.
  // A file sent with an internal note is internal too (VAPT VA-INT-01): the row says so, and row security then keeps it from the requester.
  let attachmentIsInternal = false
  if (commentId) {
    const { data: comment } = await supabase
      .from('request_comments')
      .select('id, is_internal')
      .eq('id', commentId)
      .eq('request_id', requestId)
      .maybeSingle()
    if (!comment) return { error: 'Comment not found on this request.' }
    attachmentIsInternal = comment.is_internal === true
  }

  // ── Storage upload ────────────────────────────────────────────────────────
  // VIRUS_SCAN_HOOK: insert quarantine/scan step here before moving to final bucket
  const admin = createAdminClient()
  const storagePath = buildStoragePath(requestId, file.name)
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: storageError } = await admin.storage
    .from('request-attachments')
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    })

  if (storageError) {
    console.error('[uploadAttachment] Storage upload failed', storageError.message)
    return { error: 'Upload failed. Please try again.' }
  }

  // ── DB insert ─────────────────────────────────────────────────────────────
  const { data: attachment, error: insertError } = await supabase
    .from('request_attachments')
    .insert({
      request_id: requestId,
      comment_id: commentId ?? null,
      uploaded_by: profile.id,
      file_name: file.name,
      file_size: file.size,
      mime_type: mimeType,
      storage_path: storagePath,
      is_internal: attachmentIsInternal,
    })
    .select('id')
    .single()

  if (insertError || !attachment) {
    // DB insert failed — remove the orphaned storage object
    await admin.storage.from('request-attachments').remove([storagePath])
    console.error('[uploadAttachment] DB insert failed', insertError?.message)
    return { error: 'Failed to record attachment. The file was not saved.' }
  }

  // ── Activity log ──────────────────────────────────────────────────────────
  await logActivity({
    requestId,
    actorId: profile.id,
    action: 'attachment_added',
    // the history is readable by the requester, so the name and size of a staff-only file are not written to it
    metadata: attachmentIsInternal ? { internal: true } : { file_name: file.name, file_size: file.size },
  })

  revalidatePath(`/requests/${requestId}`)

  return { attachmentId: attachment.id }
}

// ── deleteAttachment ──────────────────────────────────────────────────────────

export async function deleteAttachment(
  attachmentId: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }

  // Fetch with authorization — RLS ensures caller can see this row
  const { data: attachment } = await supabase
    .from('request_attachments')
    .select('id, storage_path, request_id, uploaded_by')
    .eq('id', attachmentId)
    .is('deleted_at', null)
    .single()

  if (!attachment) return { error: 'Attachment not found.' }

  // Additional authorization: only uploader or agent/manager may delete
  const { data: request } = await supabase
    .from('requests')
    .select('team_id')
    .eq('id', attachment.request_id)
    .single()

  const isUploader = attachment.uploaded_by === profile.id
  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (request ? profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id) : false)

  if (!isUploader && !isAgent) {
    return { error: 'You do not have permission to delete this attachment.' }
  }

  // ── Soft delete the DB row first ──────────────────────────────────────────
  // The permission check above decides who may delete. The update itself is made with the server's client: with the user's own client the
  // row-security rules reject it, because a deleted row is no longer visible to the user's SELECT rule (D-068).
  const admin = createAdminClient()
  const { error: updateError } = await admin
    .from('request_attachments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', attachmentId)
    .is('deleted_at', null)

  if (updateError) {
    return { error: 'Failed to delete attachment.' }
  }

  // ── Remove from storage (best-effort; DB row is already soft-deleted) ─────
  const { error: storageError } = await admin.storage
    .from('request-attachments')
    .remove([attachment.storage_path])

  if (storageError) {
    // Log but don't surface — the row is already soft-deleted so it won't appear
    console.error('[deleteAttachment] Storage remove failed', storageError.message)
  }

  revalidatePath(`/requests/${attachment.request_id}`)

  return {}
}
