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

// ── Files an APPROVER may see ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A person asked to approve a ticket (who is not on the ticket's group and is not a manager) reads the ticket's public conversation, but the row-security rule of the
// file list never named approvers, so the files a technician sent WITH the approval (the quote, the screenshot) could not be opened. The same decision as for the comments
// is made here, on the server: the database function is_request_approver() (specific approvers of this ticket) says whether this person is one; if yes, the public
// (not internal) files of that ticket are listed, and each file is served by the proxy route only after the same check. Nothing else changes for anybody.

type AdminLike = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** True when the signed-in person is an approver of this ticket (the same database function the comment rule uses). */
export async function viewerIsRequestApprover(requestId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc('is_request_approver', { p_request_id: requestId })
  return data === true
}

/** The public files of a ticket for one of its approvers; an empty list for anybody else. */
export async function getApproverAttachments(requestId: string): Promise<RequestAttachmentWithUploader[]> {
  if (!(await viewerIsRequestApprover(requestId))) return []
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient() as unknown as AdminLike
  const { data } = await admin
    .from('request_attachments')
    .select('*, uploader:profiles!request_attachments_uploaded_by_fkey (id, full_name)')
    .eq('request_id', requestId)
    .eq('is_internal', false)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: true })
  return ((data ?? []) as { id: string }[]).map((row) => ({ ...row, signedUrl: `/api/storage/attachment/request/${row.id}` })) as unknown as RequestAttachmentWithUploader[]
}

/** One public file row, for an approver of its ticket (null when it is internal, deleted, or the person is not an approver of that ticket). */
export async function getApproverAttachmentRow(attachmentId: string): Promise<Record<string, unknown> | null> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient() as unknown as AdminLike
  const { data: row } = await admin.from('request_attachments').select('*').eq('id', attachmentId).eq('is_internal', false).is('deleted_at', null).maybeSingle()
  if (!row) return null
  return (await viewerIsRequestApprover((row as { request_id: string }).request_id)) ? (row as Record<string, unknown>) : null
}
