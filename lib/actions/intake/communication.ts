'use server'

import { fetchWithTimeout } from '@/lib/http/fetch-timeout'
import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReview, logIntakeAudit } from './_shared'
import { requireModuleEnabled } from '@/lib/actions/moduleGuard'
import { getSecret } from '@/lib/secrets'
import { sanitizeError } from '@/lib/observability/sanitize-error'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// ── Read / Archive state ──────────────────────────────────────────────────────

export async function markMessageRead(
  messageId: string,
  isRead: boolean,
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  // Written by the server after the caller is known to be a reviewer of this organisation. .select().maybeSingle() tells "updated" from "no such message".
  const supabase = createAdminClient() as unknown as AnyClient
  const { data, error } = await supabase
    .from('intake_messages')
    .update({ is_read: isRead })
    .eq('id', messageId)
    .eq('org_id', profile.org_id)
    .select('id')
    .maybeSingle()
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/intake/communication.ts' }) }
  if (!data) return { error: 'Message not found.' }
  return {}
}

export async function archiveMessage(
  messageId: string,
  archived: boolean,
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const supabase = createAdminClient() as unknown as AnyClient
  const { data, error } = await supabase
    .from('intake_messages')
    .update({ is_archived: archived })
    .eq('id', messageId)
    .eq('org_id', profile.org_id)
    .select('id')
    .maybeSingle()
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/intake/communication.ts' }) }
  if (!data) return { error: 'Message not found.' }
  return {}
}

// ── Internal notes ────────────────────────────────────────────────────────────

export async function addNote(
  messageId: string,
  body: string,
): Promise<{ id?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }   // VAPT VA-ADM-11: a requester cannot write notes on staff mail threads
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!body.trim()) return { error: 'Note body cannot be empty.' }

  const supabase = createAdminClient() as unknown as AnyClient
  // the message must belong to the caller's organisation
  const { data: msg } = await supabase.from('intake_messages').select('id').eq('id', messageId).eq('org_id', profile.org_id).maybeSingle()
  if (!msg) return { error: 'Message not found.' }
  const { data, error } = await supabase
    .from('intake_notes')
    .insert({
      org_id:    profile.org_id,
      message_id: messageId,
      author_id:  profile.id,
      body:       body.trim(),
    })
    .select('id')
    .single()

  return { id: data?.id, error: error ? sanitizeError(error, { route: 'lib/actions/intake/communication.ts' }) : undefined }
}

export async function deleteNote(noteId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient
  // Scope to the caller's org (admin client bypasses RLS) — a note only carries
  // its own org_id, not the message's, so this is the note's own org, not a join.
  const { data: note } = await admin
    .from('intake_notes')
    .select('id')
    .eq('id', noteId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!note) return { error: 'Note not found.' }

  const { error } = await admin.from('intake_notes').delete().eq('id', noteId)
  return { error: error?.message }
}

// ── Reply / Reply-All / Forward ───────────────────────────────────────────────

export type SendAction = 'reply' | 'reply_all' | 'forward'

export interface SendPayload {
  action: SendAction
  toAddresses: string[]
  ccAddresses?: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
}

// Closes a message without creating work (handled, no action needed).
// Marks is_read=true; if a review is still open, approves it as 'informational'
// (handled, not junk — keep it distinct from spam in the metrics).
export async function closeWithoutWork(messageId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient

  // Scope the message to the caller's org (admin client bypasses RLS).
  const { data: msg } = await admin
    .from('intake_messages')
    .select('id, org_id')
    .eq('id', messageId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!msg) return { error: 'Message not found.' }

  await admin.from('intake_messages').update({ is_read: true, status: 'actioned' }).eq('id', messageId)

  // Approve any still-open review as 'informational' (handled, no work needed).
  const { data: review } = await admin
    .from('intake_reviews')
    .select('id, state')
    .eq('message_id', messageId)
    .maybeSingle()

  if (review && (review.state === 'pending' || review.state === 'in_review')) {
    await admin.from('intake_reviews').update({
      state: 'approved',
      final_type: 'informational',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', review.id)
    await logIntakeAudit({
      orgId: msg.org_id, actorId: profile.id, entityId: review.id,
      action: 'review_closed', metadata: { final_type: 'informational' },
    })
  }

  revalidatePath('/intake/inbox'); revalidatePath('/intake/queue')
  return {}
}

export async function sendFromMessage(
  messageId: string,
  payload: SendPayload,
): Promise<{ ok: boolean; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !canReview(profile.role)) return { ok: false, error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { ok: false, error: moduleError }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: msg } = await admin
    .from('intake_messages')
    .select('id')
    .eq('id', messageId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!msg) return { ok: false, error: 'Message not found.' }

  const rawUrl  = process.env.INTAKE_WORKER_URL
  const secret  = getSecret('intake_worker')
  if (!rawUrl || !secret) return { ok: false, error: 'Worker not configured.' }
  const workerUrl = (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/$/, '')

  try {
    const res = await fetchWithTimeout(`${workerUrl}/intake/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intake-worker-secret': secret },
      body: JSON.stringify({ messageId, senderId: profile.id, ...payload }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach worker.' }
  }
}
