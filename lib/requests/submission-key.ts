// Protection against double-submit (a double click, a retry after a slow answer, two tabs): the same person submitting the same service with the same answers
// within a short window gets the FIRST ticket back instead of a second one (VAPT Low "duplicate ticket submission").
// The key is atomic in the database (migration 170, webhook_seen_once), so eight submissions at the same instant still make one ticket.
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { firstDelivery } from '@/lib/security/shared-limits'

export const SUBMISSION_WINDOW_SECONDS = 15

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value ?? null)
}

export function submissionKey(p: { requesterId: string; serviceId: string; subCategoryId: string | null; projectId: string | null; formData: Record<string, unknown> }): string {
  return createHash('sha256').update(stable([p.requesterId, p.serviceId, p.subCategoryId, p.projectId, p.formData])).digest('hex')
}

/** true when this caller is the first to submit this key inside the window and should create the ticket. */
export async function claimSubmission(key: string): Promise<boolean> {
  return firstDelivery(`submit:${key}`, SUBMISSION_WINDOW_SECONDS)
}

/** Lets the key be used again (the creation failed, so a retry must be allowed to go through). */
export async function releaseSubmission(key: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createAdminClient() as any).rpc('webhook_seen_forget', { p_key: `submit:${key}` })
  } catch { /* the window simply runs out */ }
}

/** The ticket the first caller made for this key; waits briefly while that caller is still creating it. */
export async function findSubmittedTicket(requesterId: string, key: string, waitMs = 8000): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const until = Date.now() + waitMs
  for (;;) {
    const { data } = await admin.from('requests').select('id').eq('requester_id', requesterId).eq('source_metadata->>submission_key', key).order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (data?.id) return data.id as string
    if (Date.now() >= until) return null
    await new Promise((r) => setTimeout(r, 250))
  }
}
