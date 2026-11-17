/**
 * Turns the text of a Zoho field into the value a CK Desk form field accepts. Pure (no database).
 * A value that does not fit the field (for example a dropdown whose list does not have that word) is NOT guessed: it returns `ok: false` and the caller keeps
 * the original word in the ticket's Zoho note, so nothing is lost and nothing wrong is stored.
 */

export type CoerceField = { id: string; type: string; label?: string; options?: { value: string; label: string; is_active?: boolean; children?: unknown }[] }
export type Coerced = { ok: true; value: string | number | boolean } | { ok: false; reason: string }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function coerceFieldValue(field: CoerceField, raw: string): Coerced {
  const text = String(raw ?? '').trim()
  if (text === '') return { ok: false, reason: 'empty' }
  switch (field.type) {
    case 'number': {
      const n = Number(text.replace(/,/g, ''))
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: `"${text}" is not a number` }
    }
    case 'date': {
      const d = new Date(text)
      if (Number.isNaN(d.getTime())) return { ok: false, reason: `"${text}" is not a date` }
      return { ok: true, value: d.toISOString().slice(0, 10) }
    }
    case 'checkbox':
    case 'toggle': {
      const t = norm(text)
      if (['yes', 'true', '1', 'y'].includes(t)) return { ok: true, value: true }
      if (['no', 'false', '0', 'n'].includes(t)) return { ok: true, value: false }
      return { ok: false, reason: `"${text}" is not yes or no` }
    }
    case 'select':
    case 'radio':
    case 'multiselect': {
      const opts = (field.options ?? []).filter((o) => o.is_active !== false)
      const t = norm(text)
      const hit = opts.find((o) => norm(o.value) === t) ?? opts.find((o) => norm(o.label) === t)
      if (!hit) return { ok: false, reason: `"${text}" is not one of the choices of "${field.label ?? field.id}"` }
      return { ok: true, value: hit.value }
    }
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? { ok: true, value: text } : { ok: false, reason: `"${text}" is not an e-mail address` }
    case 'file':
    case 'store_address':
      return { ok: false, reason: 'this field cannot be filled from Zoho' }
    default:
      return { ok: true, value: text }
  }
}

/** A multi-select stores a list; every other field a single value. */
export function formDataEntry(field: CoerceField, value: string | number | boolean): unknown {
  return field.type === 'multiselect' ? [value] : value
}
