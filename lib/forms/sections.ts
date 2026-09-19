import type { FormField, FormFieldOption, FormFieldType, FormSection } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

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

/**
 * Resolve a service's intake form the *current* way: if the service is
 * tagged to a Form Template (`template_id` set), the template's fields are
 * the live, single source of truth — the service's own `form_sections`/
 * `form_fields` are never consulted once a template is tagged, and editing
 * the template immediately changes what every tagged service renders next.
 * Untagged (legacy) services fall through to `resolveFormSections()`
 * unchanged, so nothing built before Form Templates existed has to migrate.
 *
 * Callers must select `template:form_templates(form_sections)` alongside the
 * service row (see lib/queries/services.ts) — this function does no I/O of
 * its own. Note: form_templates has no form_fields column (only services'
 * own legacy flat field list does) — requesting it on the embedded template
 * makes PostgREST reject the whole query.
 */
export function resolveServiceFormSections(service: {
  form_sections?: unknown
  form_fields?: unknown
  template?: { form_sections?: unknown; form_fields?: unknown } | null
}): FormSection[] {
  if (service.template) return resolveFormSections(service.template)
  return resolveFormSections(service)
}

// ── Requester/Technician audience helpers ─────────────────────────────────────
// A field's requester_can_view/requester_can_set are optional booleans, absent
// on every field saved before this concept existed — treat absence as `true`
// everywhere so old templates/services/historical snapshots keep behaving
// exactly as before (fully requester-visible-and-settable).

export function requesterCanView(field: FormField): boolean {
  return field.requester_can_view !== false
}

export function requesterCanSet(field: FormField): boolean {
  return field.requester_can_set !== false
}

/** required && the requester can actually see and fill it in themselves. */
export function isRequesterMandatory(field: FormField): boolean {
  return field.required && requesterCanView(field) && requesterCanSet(field)
}

/** required, but hidden from or read-only to the requester — so it's the
 *  technician's responsibility instead, enforced at status-change time
 *  (see updateRequestStatus() in lib/actions/requests.ts). */
export function isTechnicianMandatory(field: FormField): boolean {
  return field.required && !(requesterCanView(field) && requesterCanSet(field))
}

/** Drops requester_can_view===false fields from every section — the shared
 *  filter for every requester-facing view of a form: DynamicForm's create-
 *  request rendering, createRequest()'s server-side revalidation, and a
 *  requester's own read-only view of an already-submitted request. */
export function filterFieldsForRequester(sections: FormSection[]): FormSection[] {
  return sections.map((s) => ({ ...s, fields: s.fields.filter(requesterCanView) }))
}

/** Same filter, for the legacy flat form_schema_snapshot shape. */
export function filterFlatFieldsForRequester(fields: FormField[]): FormField[] {
  return fields.filter(requesterCanView)
}

export type ServiceFormFieldRef = {
  id: string
  label: string
  type: FormFieldType
  options?: FormFieldOption[]
  serviceId: string
  serviceName: string
  /** Set when the field was added from the Field Library — every instance of the
   *  same library field across templates/services shares this id. */
  libraryFieldId?: string
}

/**
 * Every custom intake-form field defined across an org's active services,
 * flattened into one lookup list — the shared source for "what custom fields
 * exist on this service desk" consumed by both the Business Rules condition
 * picker and the Report Builder's per-service custom-field columns, so a field
 * added to (or removed from) a service's form shows up in both automatically,
 * with no code change. Uses resolveServiceFormSections() (not the legacy-only
 * resolveFormSections()) so a service tagged to a Form Template correctly
 * reflects the template's current fields, not a stale service-level snapshot.
 */
export async function getServiceFormFieldsForOrg(admin: AnyClient, orgId: string): Promise<ServiceFormFieldRef[]> {
  const { data } = await admin
    .from('services')
    .select('id, name, form_sections, form_fields, template:form_templates(form_sections)')
    .eq('org_id', orgId)
    .eq('is_active', true)

  type ServiceRow = {
    id: string; name: string
    form_sections: unknown; form_fields: unknown
    template: { form_sections: unknown; form_fields: unknown } | null
  }

  return ((data ?? []) as ServiceRow[]).flatMap((service) =>
    resolveServiceFormSections(service).flatMap((section) =>
      section.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        options: field.options,
        serviceId: service.id,
        serviceName: service.name,
        libraryFieldId: field.library_field_id,
      }))
    )
  )
}
