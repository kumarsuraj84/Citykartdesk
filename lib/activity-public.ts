// What a requester (role "user") may see of a ticket's activity log (VAPT-063 / VA-TKT-20).
// The full log holds rule names, copied e-mail addresses, OEM and delegation details. The History tab only needs the few fields below, so that is all
// a requester is given; staff still read the whole row through row security.
import type { Json } from '@/types/database'

const PLAIN_KEYS = ['from', 'to', 'priority_from', 'priority_to', 'file_name', 'approver_names', 'comment', 'collaborator_name', 'sub_category_to', 'step'] as const

export function publicActivityMetadata(metadata: Json | null | undefined): Json | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const m = metadata as Record<string, Json | undefined>
  const out: Record<string, Json> = {}
  for (const k of PLAIN_KEYS) if (m[k] !== undefined && m[k] !== null) out[k] = m[k] as Json
  // copied recipients: names only, never addresses
  if (Array.isArray(m.cc)) {
    out.cc = (m.cc as Json[]).map((c) => ({ name: c && typeof c === 'object' && !Array.isArray(c) ? ((c as Record<string, Json>).name ?? null) : null }))
  }
  return Object.keys(out).length > 0 ? out : null
}
