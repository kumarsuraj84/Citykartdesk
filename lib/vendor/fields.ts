import type { FormField, FormSection } from '@/types'

// The three boxes of the AC ticket form that a vendor fills, found by their label (the same way the rest of the application finds the Subject box).
// Matching ignores case, extra spaces and punctuation, so "AC OEM Ticket Number" and "ac oem ticket number" are the same box.

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const OEM_NUMBER_LABEL = 'AC OEM Ticket Number'
export const OEM_DATE_LABEL = 'AC OEM Ticket Creation Date'
export const AC_RESOLUTION_LABEL = 'AC resolution'

/** Where a program ticket keeps the OEM ticket number when its form has no box for it: in the ticket's own data, not shown as a form box. */
export const BG_OEM_NUMBER_KEY = '_oem_ticket_no'
export const BG_OEM_DATE_KEY = '_oem_ticket_date'

/**
 * The OEM boxes of a PROGRAM ticket's form: a box whose label ends with "OEM Ticket Number" or "Vendor Ticket Number" (for example "RO OEM Ticket Number", "VENDOR TICKET NUMBER"),
 * and one that ends with "OEM Ticket Creation Date" or "Vendor Ticket Creation Date". Vendor and OEM mean the same for Citykart.
 */
export function findProgramOemBoxes(sections: FormSection[] | null | undefined): { number: FormField | null; date: FormField | null } {
  const fields = flattenSections(sections)
  const endsWith = (f: FormField, tail: string) => { const l = norm(f.label); return l === tail || l.endsWith(` ${tail}`) }
  const any = (f: FormField, tails: string[]) => tails.some((t) => endsWith(f, t))
  return {
    number: fields.find((f) => any(f, ['oem ticket number', 'vendor ticket number'])) ?? null,
    date: fields.find((f) => any(f, ['oem ticket creation date', 'vendor ticket creation date'])) ?? null,
  }
}

export type VendorTicketFields = {
  oemNumber: FormField | null
  oemDate: FormField | null
  resolution: FormField | null
}

export function findFieldByLabel(fields: FormField[], label: string): FormField | null {
  const want = norm(label)
  return fields.find((f) => norm(f.label) === want) ?? null
}

export function flattenSections(sections: FormSection[] | null | undefined): FormField[] {
  return (sections ?? []).flatMap((s) => s.fields ?? [])
}

export function findVendorFields(sections: FormSection[] | null | undefined): VendorTicketFields {
  const fields = flattenSections(sections)
  return {
    oemNumber: findFieldByLabel(fields, OEM_NUMBER_LABEL),
    oemDate: findFieldByLabel(fields, OEM_DATE_LABEL),
    resolution: findFieldByLabel(fields, AC_RESOLUTION_LABEL),
  }
}

/** The choice that lets the vendor type his own words. It is always offered, even when the administrator's list does not hold it yet. */
export const RESOLUTION_OTHER = 'Other'

export type ResolutionChoice = { value: string; label: string }

/** The resolution choices a vendor sees: the administrator's list (live), with "Other" at the end. */
export function resolutionChoices(field: FormField | null): ResolutionChoice[] {
  const base = (field?.options ?? []).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }))
  const hasOther = base.some((o) => norm(o.value) === norm(RESOLUTION_OTHER) || norm(o.label) === norm(RESOLUTION_OTHER))
  return hasOther ? base : [...base, { value: RESOLUTION_OTHER, label: RESOLUTION_OTHER }]
}

/** The resolutions of a Vendor Program: the program's own fixed list, with "Other" at the end. */
export function programResolutionChoices(options: string[]): ResolutionChoice[] {
  const base = options.map((o) => ({ value: o, label: o }))
  const hasOther = base.some((o) => norm(o.value) === norm(RESOLUTION_OTHER))
  return hasOther ? base : [...base, { value: RESOLUTION_OTHER, label: RESOLUTION_OTHER }]
}

export const isOtherChoice = (value: string | null | undefined): boolean => norm(value) === norm(RESOLUTION_OTHER)

/** Today's date in the form the date box stores it (YYYY-MM-DD, Indian time). */
export function todayIstDate(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000)
  return ist.toISOString().slice(0, 10)
}

/** The text posted to the conversation and kept as the final resolution. For "Other" the vendor's own words are the resolution. */
export function buildResolutionText(choice: string, remarks: string): string {
  const r = remarks.trim()
  if (isOtherChoice(choice)) return r
  return r ? `Resolution: ${choice}. ${r}` : `Resolution: ${choice}`
}

export type ResolveCheck = { ok: true } | { ok: false; error: string }

/** The rules for resolving as a vendor: a reason from the list, remarks when the reason is Other, and at least one FSR attachment. */
export function checkVendorResolve(input: { choice: string; remarks: string; fsrCount: number }): ResolveCheck {
  if (!input.choice.trim()) return { ok: false, error: 'Please choose the resolution.' }
  if (isOtherChoice(input.choice) && input.remarks.trim().length < 10) return { ok: false, error: 'Please describe what you did (at least 10 characters), because you chose "Other".' }
  if (input.fsrCount < 1) return { ok: false, error: 'Please attach the FSR (field service report) before resolving.' }
  return { ok: true }
}

/** AC PMS tickets: there is no OEM resolution list; the PMS report (at least one attachment) is what proves the visit was done. Remarks are optional. */
export function checkVendorResolvePms(input: { fsrCount: number }): ResolveCheck {
  if (input.fsrCount < 1) return { ok: false, error: 'Please attach the PMS report before resolving.' }
  return { ok: true }
}

export function buildPmsResolutionText(remarks: string): string {
  const r = remarks.trim()
  return r ? `AC PMS done. ${r}` : 'AC PMS done.'
}

export type StartCheck = { ok: true; oemNumber: string } | { ok: false; error: string }

/** The OEM ticket number is compulsory to start work. */
export function checkVendorStart(oemNumberRaw: string | null | undefined): StartCheck {
  const n = (oemNumberRaw ?? '').trim()
  if (!n) return { ok: false, error: 'Please enter the OEM ticket number to start working.' }
  if (n.length > 60) return { ok: false, error: 'The OEM ticket number is too long.' }
  if (/[<>\u0000-\u001f]/.test(n)) return { ok: false, error: 'The OEM ticket number has characters that are not allowed.' }
  return { ok: true, oemNumber: n }
}

/** An answer of the form as text for a read-only display (a choice shows its label, a tick box Yes / No, nothing shows a dash). */
export function displayAnswer(field: FormField, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '—'
  if (field.type === 'checkbox') return raw ? 'Yes' : 'No'
  if (field.type === 'multiselect' && Array.isArray(raw)) {
    const labels = (raw as string[]).map((v) => field.options?.find((o) => o.value === v)?.label ?? v)
    return labels.length > 0 ? labels.join(', ') : '—'
  }
  if (field.type === 'select' || field.type === 'radio') return field.options?.find((o) => o.value === String(raw))?.label ?? String(raw)
  return String(raw)
}
