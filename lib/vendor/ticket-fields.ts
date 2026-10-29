import { createAdminClient } from '@/lib/supabase/admin'
import type { FormSection } from '@/types'
import { BG_OEM_DATE_KEY, BG_OEM_NUMBER_KEY, findProgramOemBoxes, findVendorFields } from './fields'

// Server-side helpers that read and write the vendor's three boxes on a ticket (OEM ticket number, OEM ticket date, AC resolution).
// They use the server's own key: the callers have already checked who the person is and that the ticket is theirs.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }
const db = (): Db => createAdminClient() as unknown as Db

/** True when the ticket is assigned to a vendor technician (the automatic OEM step then leaves the ticket Open for him to start). */
export async function isAssignedToVendor(requestId: string): Promise<boolean> {
  const d = db()
  const { data: r } = await d.from('requests').select('assigned_to').eq('id', requestId).maybeSingle()
  if (!r?.assigned_to) return false
  const { data: p } = await d.from('profiles').select('vendor_company_id, vendor_role').eq('id', r.assigned_to).maybeSingle()
  return !!p?.vendor_company_id && p.vendor_role === 'technician'
}

/** The ticket's form as it was when raised, with the ids of the vendor's three boxes (null when the ticket's form does not have them). */
export async function loadTicketForm(requestId: string) {
  const { data } = await db().from('requests').select('id, form_data, form_sections_snapshot, service_id').eq('id', requestId).maybeSingle()
  if (!data) return null
  const sections = (Array.isArray(data.form_sections_snapshot) ? data.form_sections_snapshot : []) as FormSection[]
  return { formData: (data.form_data ?? {}) as Record<string, unknown>, sections, fields: findVendorFields(sections), serviceId: data.service_id as string }
}

/** Writes some answers of the form (merged, never replacing the others). */
export async function mergeFormData(requestId: string, patch: Record<string, unknown>): Promise<{ error?: string }> {
  if (Object.keys(patch).length === 0) return {}
  const { error } = await db().rpc('merge_request_form_data', { p_request_id: requestId, p_patch: patch })
  return error ? { error: 'Could not save the details on the ticket.' } : {}
}

/**
 * A reopened ticket goes back to the same vendor technician, who must enter the OEM's NEW ticket number (it replaces the old one).
 * The two boxes are emptied here; the old number stays in the conversation and the history. Does nothing for a ticket that is not with a vendor. Never throws.
 */
export async function clearOemTicketOnReopen(requestId: string): Promise<void> {
  try {
    if (!(await isAssignedToVendor(requestId))) return
    const form = await loadTicketForm(requestId)
    if (!form) return
    const patch: Record<string, unknown> = {}
    if (form.fields.oemNumber) patch[form.fields.oemNumber.id] = ''
    if (form.fields.oemDate) patch[form.fields.oemDate.id] = ''
    // a program ticket: the OEM boxes of its form (if any) and the number kept in the background are emptied too
    const boxes = findProgramOemBoxes(form.sections)
    if (boxes.number) patch[boxes.number.id] = ''
    if (boxes.date) patch[boxes.date.id] = ''
    if (BG_OEM_NUMBER_KEY in form.formData) { patch[BG_OEM_NUMBER_KEY] = ''; patch[BG_OEM_DATE_KEY] = '' }
    await mergeFormData(requestId, patch)
  } catch (e) {
    console.error('[clearOemTicketOnReopen] failed', e)
  }
}

/** A public message in the conversation by the given person (the quote lines, a revision request ...). Returns the message id so files can be tied to it. Never throws. */
export async function postPublicComment(requestId: string, authorId: string, body: string): Promise<string | undefined> {
  try {
    const { data } = await db().from('request_comments').insert({ request_id: requestId, author_id: authorId, body, is_internal: false }).select('id').single()
    return data?.id as string | undefined
  } catch (e) {
    console.error('[postPublicComment] failed', e)
    return undefined
  }
}
