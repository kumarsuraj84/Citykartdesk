// Work-item source options ("Source" column on Tasks/Requests).
// Predefined in code — add new entries here and they appear in the editable
// Source dropdown everywhere. `intake` is set automatically by the intake
// conversion pipeline; the rest are picked manually by a user.
export type WorkSource = 'intake' | 'manual' | 'email' | 'phone' | 'portal'

export const WORK_SOURCES: { key: WorkSource; label: string }[] = [
  { key: 'intake', label: 'Intake' },
  { key: 'manual', label: 'Manual' },
  { key: 'email',  label: 'Email' },
  { key: 'phone',  label: 'Phone' },
  { key: 'portal', label: 'Portal' },
]

export function sourceLabel(key: string | null | undefined): string | null {
  if (!key) return null
  return WORK_SOURCES.find((s) => s.key === key)?.label ?? null
}

// ── Ticket origin ("where did this ticket come from") ────────────────────────
// Stored on requests as source_metadata.created_via, written by
// createRequestCore() at creation. Tickets created before that was recorded have
// no value — they were all raised on the web portal, so absent reads as Web.

export type TicketSourceKey = 'portal' | 'whatsapp' | 'intake' | 'email' | 'phone' | 'manual' | 'api'

export const TICKET_SOURCE_LABELS: Record<TicketSourceKey, string> = {
  portal: 'Web',
  whatsapp: 'WhatsApp',
  intake: 'Intake',
  email: 'Email',
  phone: 'Phone',
  manual: 'Manual',
  api: 'API',
}

const CREATED_VIA_TO_SOURCE: Record<string, TicketSourceKey> = {
  web: 'portal',
  portal: 'portal',
  whatsapp: 'whatsapp',
  intake: 'intake',
  email_intake: 'email',
  email: 'email',
  phone: 'phone',
  manual: 'manual',
  api: 'api',
}

export function ticketSourceKey(sourceMetadata: unknown): TicketSourceKey {
  const createdVia = (sourceMetadata as { created_via?: string } | null)?.created_via
  return (createdVia && CREATED_VIA_TO_SOURCE[createdVia]) || 'portal'
}

/** Coarse channel used by Business Rules ("Source" condition) and reports. */
export function sourceChannelOf(sourceMetadata: unknown): string {
  const key = ticketSourceKey(sourceMetadata)
  if (key === 'whatsapp') return 'whatsapp'
  return key === 'intake' || key === 'email' ? 'intake' : 'portal'
}
