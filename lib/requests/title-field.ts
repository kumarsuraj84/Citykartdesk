export interface TitleFieldLike {
  id: string
  type: string
  label?: string
  options?: { value: string; label: string }[]
}

/** Labels that mean "this is the ticket's subject" (matched whole, ignoring case and a trailing colon/star). */
const SUBJECT_LABEL = /^\s*(subject|ticket subject|request subject|issue subject|title|ticket title|summary|issue summary)\s*[:*]?\s*$/i

export const MAX_SUBJECT_TITLE_LENGTH = 200

function textValue(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * The form field whose answer becomes the ticket's title, and whether it is the ticket's Subject.
 *
 * A field labelled "Subject" always wins — it is what the requester means as the ticket's
 * heading. Previously the FIRST text field was used, so a template that asks for a Serial Number,
 * Invoice Number or Employee Code before the Subject ended up with that as the ticket title.
 * When a template has no Subject field the old order applies (text, textarea, select/radio,
 * multiselect).
 */
export function pickTitleField<F extends TitleFieldLike>(
  fields: F[],
  formData: Record<string, unknown>,
): { field: F | undefined; isSubject: boolean } {
  const subject = fields.find(
    (f) => (f.type === 'text' || f.type === 'textarea') && !!f.label && SUBJECT_LABEL.test(f.label) && textValue(formData[f.id]) !== '',
  )
  if (subject) return { field: subject, isSubject: true }

  const field =
    fields.find((f) => f.type === 'text') ??
    fields.find((f) => f.type === 'textarea') ??
    fields.find((f) => (f.type === 'select' || f.type === 'radio') && formData[f.id]) ??
    fields.find((f) => f.type === 'multiselect' && Array.isArray(formData[f.id]) && (formData[f.id] as string[]).length > 0)
  return { field, isSubject: false }
}

/** A Subject used as the title: single line, trimmed, capped. */
export function subjectToTitle(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_SUBJECT_TITLE_LENGTH ? oneLine.slice(0, MAX_SUBJECT_TITLE_LENGTH - 1).trimEnd() + '…' : oneLine
}
