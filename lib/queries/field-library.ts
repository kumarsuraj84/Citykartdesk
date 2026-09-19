import { createClient } from '@/lib/supabase/server'
import { findDuplicateGroups, libraryUsage, type DuplicateGroup, type LibraryFieldDef } from '@/lib/forms/library'
import type { FormFieldOption, FormFieldType, FormSection } from '@/types'

export type LibraryFieldRow = LibraryFieldDef & {
  is_active: boolean
  used_in: string[]
}

type RawLibraryRow = {
  id: string; label: string; type: string; placeholder: string | null; help_text: string | null
  options: unknown; is_active: boolean
}

export function toLibraryDef(r: RawLibraryRow): LibraryFieldDef {
  return {
    id: r.id,
    label: r.label,
    type: r.type as FormFieldType,
    placeholder: r.placeholder,
    help_text: r.help_text,
    options: Array.isArray(r.options) ? (r.options as FormFieldOption[]) : null,
  }
}

/** Active library entries — what the template builder offers under "From library". */
export async function getActiveLibraryFields(): Promise<LibraryFieldDef[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('form_field_library')
    .select('id, label, type, placeholder, help_text, options, is_active')
    .eq('is_active', true)
    .order('label')
  return ((data ?? []) as RawLibraryRow[]).map(toLibraryDef)
}

export async function getFieldLibraryOverview(): Promise<{
  fields: LibraryFieldRow[]
  duplicates: DuplicateGroup[]
}> {
  const supabase = await createClient()
  const [{ data: lib }, { data: templates }] = await Promise.all([
    supabase.from('form_field_library').select('id, label, type, placeholder, help_text, options, is_active').order('label'),
    supabase.from('form_templates').select('id, name, form_sections').eq('is_active', true),
  ])

  const scan = ((templates ?? []) as { id: string; name: string; form_sections: unknown }[]).map((t) => ({
    id: t.id,
    name: t.name,
    form_sections: (Array.isArray(t.form_sections) ? t.form_sections : []) as FormSection[],
  }))
  const rows = (lib ?? []) as RawLibraryRow[]
  const defs = rows.map(toLibraryDef)
  const usage = libraryUsage(scan)

  return {
    fields: rows.map((r) => ({ ...toLibraryDef(r), is_active: r.is_active, used_in: usage.get(r.id) ?? [] })),
    duplicates: findDuplicateGroups(scan, defs.filter((d) => rows.find((r) => r.id === d.id)?.is_active)),
  }
}
