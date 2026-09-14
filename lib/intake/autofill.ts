// Pure, framework-free intake form-autofill helpers — deliberately NOT inside
// lib/actions/intake/work.ts (a 'use server' file, whose every export becomes
// a server-action reference) so the Email Intake Review UI can import and run
// this exact same logic client-side (for a live "what's still missing"
// preview) instead of re-deriving a parallel, divergent version of it. The
// server (approveAndCreate()/convertToWork() in work.ts) imports it too, so
// there is exactly one implementation either side can drift from.

export type IntakeAutofillField = { id: string; type: string; label?: string; order?: number }

export type IntakeAutofillEntities = {
  refs?: string[]
  amounts?: string[]
  dates?: string[]
  emails?: string[]
}

/**
 * Flattens a service's resolved form (Form Template if tagged, else the
 * service's own sections/legacy fields) into a single ordered field list —
 * mirrors resolveServiceFormSections()'s own template-wins precedence
 * (lib/forms/sections.ts) so intake auto-fill matches whatever the requester
 * actually sees on the web form.
 */
export function collectFields(svc: {
  form_fields?: unknown
  form_sections?: unknown
  template?: { form_sections?: unknown } | null
}): IntakeAutofillField[] {
  const source = svc.template ?? svc
  const sections = Array.isArray(source.form_sections) ? (source.form_sections as { order?: number; fields?: IntakeAutofillField[] }[]) : null
  if (sections?.length) {
    return [...sections]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .flatMap((s) => [...(s.fields ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
  }
  return Array.isArray(svc.form_fields) ? (svc.form_fields as IntakeAutofillField[]) : []
}

/**
 * F3: pre-fill a service's form fields from entities the classifier
 * extracted (intake_classifications.entities) plus the email subject/body.
 * Conservative — only fills text/textarea/date/number/email where the label
 * is a clear match; selects/radios/checkboxes/multiselects/phone/toggle are
 * left for the reviewer (can't infer reliably from free text).
 */
export function buildFormData(
  fields: IntakeAutofillField[],
  entities: IntakeAutofillEntities,
  subject: string,
  body: string
): Record<string, unknown> {
  const fd: Record<string, unknown> = {}
  const refs = entities.refs ?? []
  let refIdx = 0
  for (const f of fields) {
    const label = (f.label ?? '').toLowerCase()
    let v: string | undefined
    switch (f.type) {
      case 'textarea':
        if (/detail|descri|note|summary|message|reason|issue|comment/.test(label)) v = body
        break
      case 'text':
        if (/subject|title/.test(label)) v = subject
        else if (/invoice|order|\bref|account|ticket|number|\bid\b|\bpo\b/.test(label) && refs[refIdx]) v = refs[refIdx++]
        break
      case 'date':
        if (entities.dates?.[0]) v = entities.dates[0]
        break
      case 'number':
        if (/amount|cost|price|total|sum|value/.test(label) && entities.amounts?.[0]) v = entities.amounts[0].replace(/[^\d.]/g, '')
        break
      case 'email':
        if (entities.emails?.[0]) v = entities.emails[0]
        break
    }
    if (v !== undefined && v !== '') fd[f.id] = v
  }
  return fd
}
