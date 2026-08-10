import type { FormField, FormSection } from '@/types'

/**
 * Resolve a service's intake form into sections, migrating the legacy flat
 * `form_fields` array into a single synthetic "Request Details" section when
 * `form_sections` hasn't been populated yet. Mirrors the inline logic in
 * app/(app)/admin/services/[id]/page.tsx so every consumer (editor, duplicate,
 * SLA matrix) treats legacy and section-based services identically.
 */
export function resolveFormSections(service: {
  form_sections?: unknown
  form_fields?: unknown
}): FormSection[] {
  const existingSections =
    Array.isArray(service.form_sections) && service.form_sections.length > 0
      ? (service.form_sections as unknown as FormSection[])
      : null

  const legacyFields = Array.isArray(service.form_fields)
    ? (service.form_fields as unknown as FormField[])
    : []

  return (
    existingSections ??
    (legacyFields.length > 0
      ? [
          {
            id: 'section_migrated_0',
            title: 'Request Details',
            description: undefined,
            order: 0,
            fields: legacyFields.map((f, i) => ({ ...f, order: i })),
          },
        ]
      : [])
  )
}
