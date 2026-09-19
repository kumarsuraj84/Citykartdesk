'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { toLibraryDef } from '@/lib/queries/field-library'
import {
  LIBRARY_FIELD_TYPES,
  applyLibraryDefinition,
  findDuplicateGroups,
  isOptionType,
  libraryUsage,
  normalizeLabel,
  syncSectionsWithLibrary,
  type LibraryFieldDef,
} from '@/lib/forms/library'
import { logAdminAudit } from './audit'
import type { FormFieldOption, FormFieldType, FormSection } from '@/types'

type ActionResult = { error?: string }

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
}

export type LibraryFieldInput = {
  label: string
  type: FormFieldType
  placeholder?: string
  help_text?: string
  options?: FormFieldOption[]
}

function validateInput(data: LibraryFieldInput): string | null {
  if (!data.label?.trim()) return 'Name is required.'
  if (!LIBRARY_FIELD_TYPES.includes(data.type)) return 'This field type cannot be added to the library.'
  if (isOptionType(data.type) && (!data.options || data.options.length === 0)) {
    return 'Dropdown and multi-select fields need at least one option.'
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = ReturnType<typeof createAdminClient> & { from: (t: string) => any }

type TemplateRow = { id: string; name: string; is_active: boolean; form_sections: FormSection[] }

async function loadTemplates(admin: Admin, orgId: string): Promise<TemplateRow[]> {
  const { data } = await admin.from('form_templates').select('id, name, is_active, form_sections').eq('org_id', orgId)
  return ((data ?? []) as { id: string; name: string; is_active: boolean; form_sections: unknown }[]).map((t) => ({
    ...t,
    form_sections: (Array.isArray(t.form_sections) ? t.form_sections : []) as FormSection[],
  }))
}

/** Re-copies a library entry's definition into every template that links to it. */
async function syncTemplates(admin: Admin, orgId: string, lib: LibraryFieldDef): Promise<number> {
  const templates = await loadTemplates(admin, orgId)
  const libById = new Map([[lib.id, lib]])
  let updated = 0
  for (const t of templates) {
    const { sections, changed } = syncSectionsWithLibrary(t.form_sections, libById)
    if (!changed) continue
    const { error } = await admin.from('form_templates').update({ form_sections: sections }).eq('id', t.id).eq('org_id', orgId)
    if (error) console.error('[field-library sync]', t.id, error.message)
    else updated++
  }
  return updated
}

function revalidateFormSurfaces() {
  revalidatePath('/admin/field-library')
  revalidatePath('/admin/form-templates')
  revalidatePath('/admin/services')
  revalidatePath('/services')
}

export async function createLibraryField(data: LibraryFieldInput): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard
  const invalid = validateInput(data)
  if (invalid) return { error: invalid }

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('form_field_library')
    .insert({
      org_id: guard.profile!.org_id!,
      label: data.label.trim(),
      type: data.type,
      placeholder: data.placeholder?.trim() || null,
      help_text: data.help_text?.trim() || null,
      options: isOptionType(data.type) ? (data.options as never) : null,
      created_by: guard.profile!.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: `A library field named "${data.label.trim()}" already exists.` }
    console.error('[createLibraryField]', error.message)
    return { error: 'Failed to create field.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_field_library', entityId: row.id, action: 'form_field_library_created',
    metadata: { label: data.label.trim(), type: data.type },
  })
  revalidateFormSurfaces()
  return { id: row.id }
}

export async function updateLibraryField(
  id: string,
  data: LibraryFieldInput
): Promise<ActionResult & { updatedTemplates?: number }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard
  const invalid = validateInput(data)
  if (invalid) return { error: invalid }

  const orgId = guard.profile!.org_id!
  const admin = createAdminClient() as Admin

  const { data: existing } = await admin
    .from('form_field_library').select('id, type').eq('id', id).eq('org_id', orgId).single()
  if (!existing) return { error: 'Library field not found.' }

  if (existing.type !== data.type) {
    const used = libraryUsage(await loadTemplates(admin, orgId)).get(id)
    if (used?.length) {
      return {
        error: `The type can't change while the field is used in ${used.length} template${used.length === 1 ? '' : 's'} (${used.join(', ')}) — existing answers would no longer fit. Create a new field instead.`,
      }
    }
  }

  const { data: row, error } = await admin
    .from('form_field_library')
    .update({
      label: data.label.trim(),
      type: data.type,
      placeholder: data.placeholder?.trim() || null,
      help_text: data.help_text?.trim() || null,
      options: isOptionType(data.type) ? data.options : null,
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id, label, type, placeholder, help_text, options, is_active')
    .single()

  if (error) {
    if (error.code === '23505') return { error: `A library field named "${data.label.trim()}" already exists.` }
    console.error('[updateLibraryField]', error.message)
    return { error: 'Failed to update field.' }
  }

  const updatedTemplates = await syncTemplates(admin, orgId, toLibraryDef(row))

  await logAdminAudit({
    orgId, actorId: guard.profile!.id,
    entityType: 'form_field_library', entityId: id, action: 'form_field_library_updated',
    metadata: { label: data.label.trim(), updated_templates: updatedTemplates },
  })
  revalidateFormSurfaces()
  return { updatedTemplates }
}

export async function setLibraryFieldActive(id: string, isActive: boolean): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard
  const supabase = await createClient()
  const { error } = await supabase.from('form_field_library').update({ is_active: isActive }).eq('id', id)
  if (error) return { error: 'Failed to update field.' }
  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_field_library', entityId: id,
    action: isActive ? 'form_field_library_restored' : 'form_field_library_archived',
  })
  revalidateFormSurfaces()
  return {}
}

export async function deleteLibraryField(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard
  const orgId = guard.profile!.org_id!
  const admin = createAdminClient() as Admin

  const used = libraryUsage(await loadTemplates(admin, orgId)).get(id)
  if (used?.length) {
    return { error: `Can't delete — it's used in ${used.join(', ')}. Remove it from those templates, or archive it instead.` }
  }
  const { error } = await admin.from('form_field_library').delete().eq('id', id).eq('org_id', orgId)
  if (error) {
    console.error('[deleteLibraryField]', error.message)
    return { error: 'Failed to delete field.' }
  }
  await logAdminAudit({
    orgId, actorId: guard.profile!.id,
    entityType: 'form_field_library', entityId: id, action: 'form_field_library_deleted',
  })
  revalidateFormSurfaces()
  return {}
}

/** Links a group of same-name/same-type fields (found by findDuplicateGroups) to
 *  one library entry — created from the first instance if none exists yet.
 *  Field ids never change, so already-submitted answers stay exactly where they are. */
export async function linkDuplicateFieldGroup(groupKey: string): Promise<ActionResult & { linked?: number }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard
  const orgId = guard.profile!.org_id!
  const admin = createAdminClient() as Admin

  const templates = (await loadTemplates(admin, orgId)).filter((t) => t.is_active)
  const { data: libRows } = await admin
    .from('form_field_library').select('id, label, type, placeholder, help_text, options, is_active').eq('org_id', orgId).eq('is_active', true)
  const libDefs = ((libRows ?? []) as Parameters<typeof toLibraryDef>[0][]).map(toLibraryDef)

  // Recomputed server-side — never trust the client's idea of what is safe to merge.
  const group = findDuplicateGroups(templates, libDefs).find((g) => g.key === groupKey)
  if (!group) return { error: 'This group has changed — refresh and try again.' }
  if (!group.linkable) return { error: group.reason ?? 'This group can’t be linked automatically.' }

  let lib = group.existingLibraryId ? libDefs.find((l) => l.id === group.existingLibraryId) ?? null : null
  if (!lib) {
    const first = templates
      .flatMap((t) => t.form_sections.flatMap((s) => s.fields))
      .find((f) => `${normalizeLabel(f.label)}|${f.type}` === groupKey && !f.library_field_id)!
    const { data: created, error } = await admin
      .from('form_field_library')
      .insert({
        org_id: orgId,
        label: group.label,
        type: group.type,
        placeholder: first.placeholder ?? null,
        help_text: first.help_text ?? null,
        options: isOptionType(group.type) ? first.options ?? [] : null,
        created_by: guard.profile!.id,
      })
      .select('id, label, type, placeholder, help_text, options, is_active')
      .single()
    if (error) {
      console.error('[linkDuplicateFieldGroup] create', error.message)
      return { error: 'Failed to create the library field.' }
    }
    lib = toLibraryDef(created)
  }

  const ids = new Set(group.instances.map((i) => i.fieldId))
  let linked = 0
  for (const t of templates) {
    let touched = false
    const sections = t.form_sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        if (!ids.has(f.id) || f.library_field_id) return f
        touched = true
        linked++
        return applyLibraryDefinition(f, lib!)
      }),
    }))
    if (!touched) continue
    const { error } = await admin.from('form_templates').update({ form_sections: sections }).eq('id', t.id).eq('org_id', orgId)
    if (error) {
      console.error('[linkDuplicateFieldGroup] template', t.id, error.message)
      return { error: `Linked some templates but failed on "${t.name}". Refresh and run it again.` }
    }
  }

  await logAdminAudit({
    orgId, actorId: guard.profile!.id,
    entityType: 'form_field_library', entityId: lib.id, action: 'form_field_library_linked_duplicates',
    metadata: { label: group.label, linked_fields: linked },
  })
  revalidateFormSurfaces()
  return { linked }
}
