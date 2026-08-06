'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logActivity } from '@/lib/activity'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
])

const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'pdf',
  'doc', 'docx',
  'xls', 'xlsx',
  'ppt', 'pptx',
  'txt', 'csv',
  'zip',
  'mp4', 'webm',
  'mp3', 'wav',
])

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
  formData: FormData
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

  // Content-type check against allowlist (client-supplied, not buffer-inspected per spec)
  const mimeType = file.type || 'application/octet-stream'
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      error: `File content type "${mimeType}" is not allowed.`,
    }
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
    profile.team_members.some((m) => m.team_id === request.team_id)

  if (!isRequester && !isAgent) {
    return { error: 'You do not have permission to attach files to this request.' }
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
      uploaded_by: profile.id,
      file_name: file.name,
      file_size: file.size,
      mime_type: mimeType,
      storage_path: storagePath,
      is_internal: false,
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
    metadata: { file_name: file.name, file_size: file.size },
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
    (request ? profile.team_members.some((m) => m.team_id === request.team_id) : false)

  if (!isUploader && !isAgent) {
    return { error: 'You do not have permission to delete this attachment.' }
  }

  // ── Soft delete the DB row first ──────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('request_attachments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', attachmentId)

  if (updateError) {
    return { error: 'Failed to delete attachment.' }
  }

  // ── Remove from storage (best-effort; DB row is already soft-deleted) ─────
  const admin = createAdminClient()
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
