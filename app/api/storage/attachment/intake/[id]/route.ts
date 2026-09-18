import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// See app/api/storage/public/[bucket]/[...path]/route.ts for the full
// DESK-STORAGE-001 background, and the sibling .../attachment/request/[id]
// route for the equivalent request_attachments version of this same fix.
//
// intake_attachments has its own RLS policy (org_id = current_org_id() AND
// role in agent/manager/admin/platform_owner — see migration history), so
// the session-client SELECT below is the real access check, evaluated fresh
// on every fetch instead of baked into a signed URL at generation time.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: attachment, error } = await supabase
    .from('intake_attachments')
    .select('storage_path, file_name, mime_type')
    .eq('id', id)
    .maybeSingle()

  if (error || !attachment || !attachment.storage_path) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data, error: downloadError } = await admin.storage
    .from('intake-attachments')
    .download(attachment.storage_path)
  if (downloadError || !data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  return new NextResponse(data, {
    headers: {
      'Content-Type': attachment.mime_type || data.type || 'application/octet-stream',
      // Forced download, not inline — defense in depth beyond the upload-time
      // allowlist/magic-byte check, so an inbound attachment can never render
      // inline (and execute, for an HTML/SVG part) in the reviewer's browser
      // even if it slipped through. Matches the { download: ... } option the
      // old createSignedUrl() call used (lib/actions/intake/detail.ts).
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.file_name)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
