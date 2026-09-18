import { createClient } from '@/lib/supabase/server'
import type { RequestAttachmentWithUploader } from '@/types'

/**
 * Fetch all non-deleted attachments for a request, with a URL for each.
 *
 * DESK-STORAGE-001: this used to generate real Supabase signed URLs here
 * (createSignedUrls, 1h expiry) and hand them straight to the browser. Two
 * problems: (1) a signed URL is absolute, rooted at NEXT_PUBLIC_SUPABASE_URL
 * — inlined at build time as Main's LAN-only address, unreachable from a
 * browser on the port-forwarded public IP (see the proxy route below for the
 * full writeup); (2) a signed URL that leaks stays valid for its full
 * lifetime regardless of whether the recipient's access is later revoked.
 * Now this just points at a same-origin proxy route
 * (app/api/storage/attachment/request/[id]/route.ts), keyed by the
 * attachment's own id, which re-checks the identical RLS predicate below on
 * every fetch instead of baking a decision into a signed URL once.
 *
 * RLS on request_attachments still enforces access control on this SELECT —
 * only rows the caller can see are ever returned here.
 */
export async function getRequestAttachments(
  requestId: string
): Promise<RequestAttachmentWithUploader[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('request_attachments')
    .select(`*, uploader:profiles!request_attachments_uploaded_by_fkey (id, full_name)`)
    .eq('request_id', requestId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: true })

  if (error || !data) return []

  return data.map((row) => ({
    ...row,
    signedUrl: `/api/storage/attachment/request/${row.id}`,
  })) as RequestAttachmentWithUploader[]
}
