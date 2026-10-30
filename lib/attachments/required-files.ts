// B-16: a REQUIRED file field cannot be enforced when a ticket is created, because a file can only be stored after the ticket exists (request_attachments.request_id is
// a NOT NULL foreign key) and the web form sends its files in a second step. This is the safety net for that gap: once the files have been sent, the ticket is checked,
// and when the form asked for a file but the ticket has no attachment at all, an internal note tells the technician and the requester is told on the "Request created"
// screen. The ticket itself is kept (it is a real request); only the missing file is flagged.

import { resolveFormSections, isRequesterMandatory, fieldAppliesToCategory } from '@/lib/forms/sections'
import type { FormField } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** The first words of the internal note; also how an earlier note is recognised so the same note is never written twice. */
export const REQUIRED_FILE_NOTE = 'A required file was not attached'

/** Labels of the file fields the requester had to fill in on this ticket's form (the form as it was when the ticket was made). */
export function requiredFileLabels(
  ticket: { form_sections_snapshot?: unknown; form_schema_snapshot?: unknown; category_id?: string | null },
): string[] {
  const sections = resolveFormSections({ form_sections: ticket.form_sections_snapshot, form_fields: ticket.form_schema_snapshot })
  const fields: FormField[] = sections.flatMap((s) => s.fields)
  return fields
    .filter((f) => f.type === 'file' && isRequesterMandatory(f) && fieldAppliesToCategory(f, ticket.category_id))
    .map((f) => f.label)
}

/**
 * Checks one ticket after its files were sent. Returns the labels of the required file fields that are still without any file (empty = nothing wrong), and leaves the
 * internal note once. Any attachment on the ticket counts: a file is not tied to a particular field, so this is deliberately the lenient reading. Never throws.
 */
export async function flagMissingRequiredFiles(admin: AnyClient, requestId: string, noteAuthorId: string): Promise<{ missing: string[] }> {
  try {
    const { data: ticket } = await admin.from('requests').select('form_sections_snapshot, form_schema_snapshot, category_id').eq('id', requestId).maybeSingle()
    if (!ticket) return { missing: [] }
    const labels = requiredFileLabels(ticket)
    if (labels.length === 0) return { missing: [] }

    const { count, error: countError } = await admin.from('request_attachments').select('id', { count: 'exact', head: true }).eq('request_id', requestId).is('deleted_at', null)
    if (countError) return { missing: [] }   // cannot tell: say nothing rather than wrongly accuse the requester
    if ((count ?? 0) > 0) return { missing: [] }

    const { data: earlier } = await admin.from('request_comments').select('id').eq('request_id', requestId).eq('is_internal', true).ilike('body', `${REQUIRED_FILE_NOTE}%`).limit(1)
    if (!earlier || earlier.length === 0) {
      await admin.from('request_comments').insert({
        request_id: requestId, author_id: noteAuthorId, is_internal: true,
        body: `${REQUIRED_FILE_NOTE}: ${labels.join(', ')}. The request was created without it. Please ask the requester to add the file.`,
      })
    }
    return { missing: labels }
  } catch {
    return { missing: [] }   // a safety net must never break the request that was just created
  }
}
