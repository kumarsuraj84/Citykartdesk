import { createAdminClient } from '@/lib/supabase/admin'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import type { FormField, FormSection } from '@/types'
import { AC_RESOLUTION_LABEL, findFieldByLabel, flattenSections } from './fields'

// The AC RESOLUTION list a vendor picks from is the administrator's CURRENT list (so an option added today is offered today, and one removed is no longer offered),
// read from the ticket's service form. Tickets already resolved keep the words they were resolved with: nothing here rewrites an old ticket.
// When the live form cannot be read, the list the ticket was raised with is used instead.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export async function loadLiveResolutionField(serviceId: string, snapshotSections: FormSection[]): Promise<FormField | null> {
  try {
    const { data } = await (createAdminClient() as unknown as Db)
      .from('services')
      .select('form_sections, form_fields, template:form_templates(form_sections)')
      .eq('id', serviceId)
      .maybeSingle()
    if (data) {
      const live = findFieldByLabel(flattenSections(resolveServiceFormSections(data)), AC_RESOLUTION_LABEL)
      if (live) return live
    }
  } catch (e) {
    console.error('[loadLiveResolutionField] failed', e)
  }
  return findFieldByLabel(flattenSections(snapshotSections), AC_RESOLUTION_LABEL)
}
