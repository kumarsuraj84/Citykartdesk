// Pure helpers (no database, no server-only import) for reading the records Zoho kept: used by the move and covered by unit tests.
export const PICK_NAMES = ['name', 'display_value', 'value']
export const nameOf = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim()
  if (Array.isArray(v)) return v.map(nameOf).filter(Boolean).join(', ')
  if (typeof v === 'object') { const o = v as Record<string, unknown>; for (const k of PICK_NAMES) if (o[k] !== undefined) return nameOf(o[k]); return '' }
  return ''
}
export const SKIP_KEYS = new Set(['id', 'ticket_id', 'request', 'attachments', 'links', 'href'])

export const msToIso = (v: unknown): string | null => {
  const raw = v && typeof v === 'object' && 'value' in (v as Record<string, unknown>) ? (v as { value: unknown }).value : v
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null
}

/**
 * One line per field of a Zoho record we have no fixed layout for (a task, a work log, a conversation item): its readable fields, long text stripped of HTML.
 * Nothing is dropped: whatever Zoho held that has a readable value is shown, so nobody has to open Zoho to see it.
 */
export function describeRaw(raw: unknown, htmlToText: (s: string) => string, max = 24): string {
  if (!raw || typeof raw !== 'object') return ''
  const out: string[] = []
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (SKIP_KEYS.has(k)) continue
    let t = nameOf(v)
    if (!t) continue
    if (/<[a-z!/]/i.test(t)) t = htmlToText(t)
    if (t === 'null' || t === '') continue
    out.push(`${k.replace(/_/g, ' ')}: ${t.length > 600 ? t.slice(0, 599) + '…' : t}`)
    if (out.length >= max) break
  }
  return out.join('\n')
}

/** Who did it, from the record Zoho kept (its creator, owner, technician or the person who made the change). */
export function whoOfRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  for (const k of ['created_by', 'owner', 'approver', 'approved_by', 'rejected_by', 'performed_by', 'technician', 'by', 'added_by', 'from', 'sender', 'user']) { const n = nameOf(o[k]); if (n) return n }
  return null
}
/** When it happened, from the record Zoho kept (Zoho sends times as {value: milliseconds} or as text). */
export function atOfRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  for (const k of ['created_time', 'created_at', 'start_time', 'scheduled_start_time', 'happened_at', 'time', 'date']) {
    const v = o[k]
    if (v === undefined || v === null) continue
    const viaMs = msToIso(v)
    if (viaMs) return viaMs
    const t = nameOf(v)
    const d = t ? new Date(t) : null
    if (d && !Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

