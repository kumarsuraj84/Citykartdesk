'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { validateAttachment, ALLOWED_MIME_SET as ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES as MAX_FILE_SIZE } from '@/lib/attachments/validate'




function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
}

export async function uploadTaskAttachment(
  taskId: string,
  formData: FormData
): Promise<{ attachmentId?: string; error?: string }> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'You must be signed in to upload files.' }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) return { error: 'No file provided.' }

  if (file.size === 0) return { error: 'The file is empty.' }
  if (file.size > MAX_FILE_SIZE) return { error: 'File too large. Maximum size is 25 MB.' }

  const ext = getExtension(file.name)
  if (!ALLOWED_EXTENSIONS.has(ext)) return { error: `File type .${ext} is not allowed.` }

  const mimeType = file.type || 'application/octet-stream'
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return { error: `File content type "${mimeType}" is not allowed.` }

  // Buffer-level check: confirms the file's actual bytes match the declared
  // MIME type instead of trusting the client-supplied Content-Type alone.
  const magicByteCheck = await validateAttachment(file)
  if (!magicByteCheck.valid) return { error: magicByteCheck.error ?? 'File content does not match its declared type.' }

  // Verify access to the task
  const { data: task } = await supabase
    .from('tasks')
    .select('id, team_id, created_by, assignee_id')
    .eq('id', taskId)
    .single()

  if (!task) return { error: 'Task not found.' }

  const canAttach =
    task.created_by === profile.id ||
    task.assignee_id === profile.id ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    profile.team_members.some((m) => m.team_id === task.team_id)

  if (!canAttach) return { error: 'You do not have permission to attach files to this task.' }

  const admin = createAdminClient()
  const safeName = sanitizeName(file.name)
  const storagePath = `${taskId}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: storageError } = await admin.storage
    .from('task-attachments')
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false })

  if (storageError) {
    console.error('[uploadTaskAttachment] Storage upload failed', storageError.message)
    return { error: 'Upload failed. Please try again.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: attachment, error: insertError } = await (admin as any)
    .from('task_attachments')
    .insert({
      task_id: taskId,
      uploaded_by: profile.id,
      file_name: file.name,
      file_size: file.size,
      mime_type: mimeType,
      storage_path: storagePath,
    })
    .select('id')
    .single()

  if (insertError || !attachment) {
    await admin.storage.from('task-attachments').remove([storagePath])
    console.error('[uploadTaskAttachment] DB insert failed', insertError?.message)
    return { error: 'Failed to record attachment.' }
  }

  return { attachmentId: attachment.id }
}
