import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { contentDisposition, contentTypeForFileName, pathBelongsToRequest } from '@/lib/attachments/serve'

export const dynamic = 'force-dynamic'

// See app/api/storage/public/[bucket]/[...path]/route.ts for the full
// DESK-STORAGE-001 background. This route replaces the signed URLs
// getRequestAttachments() (lib/queries/attachments.ts) used to hand the
// browser directly — those are also absolute NEXT_PUBLIC_SUPABASE_URL-rooted
// URLs, unreachable from a client on the public IP, and they were never the
// right access-control primitive here anyway: a signed URL that leaks (a
// forwarded email, a browser history entry, a proxy log) stays valid for
// its full 1h regardless of whether the recipient's access is later revoked.
//
// This route checks access at REQUEST TIME instead: identical RLS predicate
// as before (SELECT via the caller's own session client — see that file's
// own comment), just evaluated on every fetch instead of once at signing
// time, then streamed from the admin client so the browser never sees a
// Supabase-hosted URL at all.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  // RLS-gated: only returns the row if the caller can see this attachment's
  // request (same predicate getRequestAttachments() relied on).
  const { data: attachment, error } = await supabase
    .from('request_attachments')
    .select('storage_path, file_name, mime_type, deleted_at, request_id')
    .eq('id', id)
    .maybeSingle()

  if (error || !attachment || attachment.deleted_at) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  // D-054: the file must be in its own request's folder; a row pointing anywhere else is never served
  if (!pathBelongsToRequest(attachment.storage_path, attachment.request_id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data, error: downloadError } = await admin.storage
    .from('request-attachments')
    .download(attachment.storage_path)
  if (downloadError || !data) {
    // the storage service itself did not answer (down, unreachable, 5xx): the file is not missing, so say so (QA-D017)
    const e = downloadError as { name?: string; status?: number } | null
    if (e && (e.name === 'StorageUnknownError' || (typeof e.status === 'number' && e.status >= 500))) {
      return NextResponse.json({ error: 'file storage is temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '30' } })
    }
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  return new NextResponse(data, {
    headers: {
      // D-053: the type comes from the file's own extension (a fixed table), never from the stored column or the stored object's claim
      'Content-Type': contentTypeForFileName(attachment.file_name),
      'Content-Disposition': contentDisposition(attachment.file_name, contentTypeForFileName(attachment.file_name)),
      'X-Content-Type-Options': 'nosniff',
      // Access can be revoked (deleted_at, RLS) at any time — never cache.
      'Cache-Control': 'private, no-store',
    },
  })
}
