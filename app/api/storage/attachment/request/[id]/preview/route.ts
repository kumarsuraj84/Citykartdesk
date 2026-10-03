import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { previewXlsx, PreviewError, MAX_PREVIEW_FILE_BYTES } from '@/lib/attachments/xlsx-preview'

export const dynamic = 'force-dynamic'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Spreadsheet preview data for the attachment popup. Same access rule as the file route next to
// it (the caller's own RLS-scoped session must be able to see the attachment), then the workbook is
// read on the server and only a bounded set of rows is returned — never the file itself.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: attachment, error } = await supabase
    .from('request_attachments')
    .select('storage_path, file_name, mime_type, file_size, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !attachment || attachment.deleted_at) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (attachment.mime_type !== XLSX_MIME) {
    return NextResponse.json({ error: 'unsupported' }, { status: 415 })
  }
  if (attachment.file_size > MAX_PREVIEW_FILE_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { data, error: downloadError } = await admin.storage.from('request-attachments').download(attachment.storage_path)
  if (downloadError || !data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const preview = await previewXlsx(Buffer.from(await data.arrayBuffer()))
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    const code = e instanceof PreviewError ? e.code : 'unreadable'
    return NextResponse.json({ error: code }, { status: 422 })
  }
}
