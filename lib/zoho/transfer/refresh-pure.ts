// Pure helpers (no database) for "fill in the missing fields of tickets that were already moved". Covered by unit tests.
import type { FormField, FormSection } from '@/types'

const hasValue = (v: unknown): boolean => {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** True when the ticket's form data already holds a real value for this field (such a value is never overwritten). */
export const formDataHas = (formData: Record<string, unknown> | null | undefined, fieldId: string): boolean => hasValue(formData?.[fieldId])

/**
 * The form the moved ticket was made with (its snapshot) may not have a field that was added to the CK Desk form template later.
 * This adds ONLY the definitions of the given fields (copied from the current form) to a copy of the snapshot, so the ticket can show them.
 * Fields and sections already in the snapshot are left exactly as they are.
 */
export function addMissingFieldDefinitions(snapshot: unknown, current: FormSection[], fieldIds: string[]): FormSection[] {
  const out: FormSection[] = Array.isArray(snapshot) ? (JSON.parse(JSON.stringify(snapshot)) as FormSection[]) : []
  for (const id of fieldIds) {
    if (out.some((s) => (s.fields ?? []).some((f) => f.id === id))) continue
    const from = current.find((s) => (s.fields ?? []).some((f) => f.id === id))
    if (!from) continue
    const field = (from.fields as FormField[]).find((f) => f.id === id)!
    const into = out.find((s) => s.id === from.id)
    if (into) into.fields = [...(into.fields ?? []), field]
    else out.push({ ...from, fields: [field] } as FormSection)
  }
  return out
}
