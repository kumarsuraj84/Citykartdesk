'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canReview, logIntakeAudit } from './_shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// ── Read / Archive state ──────────────────────────────────────────────────────

export async function markMessageRead(
  messageId: string,
  isRead: boolean,
): Promise<{ error?: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase
    .from('intake_messages')
    .update({ is_read: isRead })
    .eq('id', messageId)
  return { error: error?.message }
}

export async function archiveMessage(
  messageId: string,
  archived: boolean,
): Promise<{ error?: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase
    .from('intake_messages')
    .update({ is_archived: archived })
    .eq('id', messageId)
  return { error: error?.message }
}

// ── Internal notes ────────────────────────────────────────────────────────────

export async function addNote(
  messageId: string,
  body: string,
): Promise<{ id?: string; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!body.trim()) return { error: 'Note body cannot be empty.' }

  const supabase = (await createClient()) as unknown as AnyClient
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

  return { id: data?.id, error: error?.message }
}

export async function deleteNote(noteId: string): Promise<{ error?: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase.from('intake_notes').delete().eq('id', noteId)
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
  if (!profile) return { ok: false, error: 'Unauthorized.' }

  const rawUrl  = process.env.INTAKE_WORKER_URL
  const secret  = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!rawUrl || !secret) return { ok: false, error: 'Worker not configured.' }
  const workerUrl = (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/$/, '')

  try {
    const res = await fetch(`${workerUrl}/intake/send`, {
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
