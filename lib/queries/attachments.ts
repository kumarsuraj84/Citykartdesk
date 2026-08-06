import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { RequestAttachmentWithUploader } from '@/types'

const SIGNED_URL_EXPIRY_SECONDS = 3600 // 1 hour

/**
 * Fetch all non-deleted attachments for a request, with fresh signed URLs.
 *
 * Signed URLs are generated server-side via the admin client at render time.
 * They are never persisted. RLS on request_attachments enforces access control
 * before the admin client generates the URL.
 */
export async function getRequestAttachments(
  requestId: string
): Promise<RequestAttachmentWithUploader[]> {
  const supabase = await createClient()
  const admin = createAdminClient()

  // SELECT is gated by RLS — only returns rows the caller can see
  const { data, error } = await supabase
    .from('request_attachments')
    .select(`*, uploader:profiles!request_attachments_uploaded_by_fkey (id, full_name)`)
    .eq('request_id', requestId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: true })

  if (error || !data) return []

  // Generate signed URLs in a single storage request instead of one per attachment.
  const { data: urlList } = await admin.storage
    .from('request-attachments')
    .createSignedUrls(
      data.map((row) => row.storage_path),
      SIGNED_URL_EXPIRY_SECONDS
    )

  return data.map((row, i) => ({
    ...row,
    signedUrl: urlList?.[i]?.signedUrl ?? '',
  })) as RequestAttachmentWithUploader[]
}
