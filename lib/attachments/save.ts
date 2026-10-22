import { createAdminClient } from '@/lib/supabase/admin'
import { ALLOWED_MIME_SET, ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@/lib/attachments/validate'
import { validateAttachmentServer } from '@/lib/attachments/validate-server'
import { logActivity } from '@/lib/activity'

// Stores one file on a ticket on behalf of a person whose right to do so was already checked by the caller (for example the PO approver adding the PO document).
// It applies the same file rules as the ordinary upload (size, type, and the real content of the file), then writes the file and its record with the server's key.

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')

export async function saveTicketFile(p: { requestId: string; file: File; uploadedBy: string; isInternal?: boolean }): Promise<{ attachmentId?: string; error?: string }> {
  const { file } = p
  if (!file || !(file instanceof File)) return { error: 'No file provided.' }
  if (file.size === 0) return { error: 'The file is empty.' }
  if (file.size > MAX_FILE_SIZE_BYTES) return { error: 'The file is too large (25 MB at most).' }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXTENSIONS.has(ext)) return { error: `File type .${ext} is not allowed.` }
  const mime = file.type || 'application/octet-stream'
  if (!ALLOWED_MIME_SET.has(mime)) return { error: `File content type "${mime}" is not allowed.` }
  const content = await validateAttachmentServer(file)
  if (!content.valid) return { error: content.error ?? 'The file content does not match its type.' }

  const admin = createAdminClient()
  const path = `${p.requestId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName(file.name)}`
  const { error: storageError } = await admin.storage.from('request-attachments').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: false })
  if (storageError) return { error: 'Upload failed. Please try again.' }

  const { data, error } = await admin.from('request_attachments').insert({
    request_id: p.requestId, comment_id: null, uploaded_by: p.uploadedBy, file_name: file.name, file_size: file.size, mime_type: mime, storage_path: path, is_internal: p.isInternal === true,
  }).select('id').single()
  if (error || !data) {
    await admin.storage.from('request-attachments').remove([path])
    return { error: 'Failed to record the file. It was not saved.' }
  }
  await logActivity({ requestId: p.requestId, actorId: p.uploadedBy, action: 'attachment_added', metadata: p.isInternal ? { internal: true } : { file_name: file.name, file_size: file.size } })
  return { attachmentId: data.id as string }
}
