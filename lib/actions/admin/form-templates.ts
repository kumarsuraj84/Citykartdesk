'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { logAdminAudit } from './audit'
import type { FormSection } from '@/types'

type ActionResult = { error?: string }

// ── Guard: admin-only ─────────────────────────────────────────────────────────
// Same guard as lib/actions/admin/services.ts's requireAdmin() — deliberately
// duplicated rather than imported/exported across files (that file doesn't
// currently export it), kept byte-for-byte identical so the two never drift.

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
}

// ── Validate sections ─────────────────────────────────────────────────────────
// Identical rules to lib/actions/admin/services.ts's validateSections() — a
// template's sections are stored and rendered exactly like a service's.

function validateSections(sections: FormSection[]): string | null {
  if (!Array.isArray(sections)) return 'Sections must be an array.'

  const allFieldIds = new Set<string>()

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]

    if (!section.id?.trim()) return `Section ${si + 1}: id is required.`
    if (!section.title?.trim()) return `Section ${si + 1}: title is required.`

    if (!Array.isArray(section.fields)) {
      return `Section "${section.title}": fields must be an array.`
    }

    for (let fi = 0; fi < section.fields.length; fi++) {
      const field = section.fields[fi]

      if (!field.id?.trim()) {
        return `Section "${section.title}", field ${fi + 1}: id is required.`
      }
      if (!field.label?.trim()) {
        return `Section "${section.title}", field ${fi + 1}: label is required.`
      }

      if (allFieldIds.has(field.id)) {
        return `Duplicate field id "${field.id}" found across sections. Field IDs must be unique.`
      }
      allFieldIds.add(field.id)

      if (
        (field.type === 'select' || field.type === 'multiselect') &&
        (!field.options || field.options.length === 0)
      ) {
        return `Section "${section.title}", field "${field.label}": select/multiselect fields require at least one option.`
      }

      if (field.requester_can_set === true && field.requester_can_view === false) {
        return `Section "${section.title}", field "${field.label}": cannot be settable by requesters while hidden from them.`
      }
    }
  }

  return null
}

// ── Template metadata CRUD ───────────────────────────────────────────────────

export type FormTemplateInput = {
  name: string
  description?: string
}

export async function createFormTemplate(
  data: FormTemplateInput
): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  if (!data.name?.trim()) return { error: 'Name is required.' }

  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from('form_templates')
    .insert({
      org_id: guard.profile!.org_id!,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      created_by: guard.profile!.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createFormTemplate]', error.message)
    return { error: 'Failed to create template.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_template', entityId: row.id, action: 'form_template_created',
    metadata: { name: data.name.trim() },
  })

  revalidatePath('/admin/form-templates')
  return { id: row.id }
}

export async function updateFormTemplate(
  id: string,
  data: Partial<FormTemplateInput>
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const updatePayload = {
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
  }

  const { error } = await supabase
    .from('form_templates')
    .update(updatePayload)
    .eq('id', id)

  if (error) {
    console.error('[updateFormTemplate]', error.message)
    return { error: 'Failed to update template.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_template', entityId: id, action: 'form_template_updated',
    metadata: updatePayload,
  })

  revalidatePath('/admin/form-templates')
  return {}
}

// ── saveTemplateSections ──────────────────────────────────────────────────────
// Mirrors saveFormSections() in lib/actions/admin/services.ts exactly. A
// template is the live source of truth for every service tagged to it, so
// this also revalidates the public /services catalog broadly rather than
// trying to enumerate every tagged service's slug.

export async function saveTemplateSections(
  templateId: string,
  sections: FormSection[]
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const validationError = validateSections(sections)
  if (validationError) return { error: validationError }

  const normalised: FormSection[] = sections.map((section, si) => ({
    ...section,
    order: si,
    fields: section.fields.map((field, fi) => ({ ...field, order: fi })),
  }))

  // Admin client to bypass RLS — auth is already checked by requireAdmin() above,
  // same pattern as saveFormSections().
  const admin = createAdminClient()

  const { error } = await admin
    .from('form_templates')
    .update({ form_sections: normalised })
    .eq('id', templateId)
    .eq('org_id', guard.profile!.org_id!)

  if (error) {
    console.error('[saveTemplateSections]', error.code, error.message, error.details)
    return { error: `Save failed: ${error.message}` }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_template', entityId: templateId, action: 'form_template_form_updated',
    metadata: { section_count: normalised.length },
  })

  revalidatePath(`/admin/form-templates/${templateId}`)
  revalidatePath('/admin/services')
  revalidatePath('/services')

  return {}
}

export async function archiveFormTemplate(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('form_templates')
    .update({ is_active: false })
    .eq('id', id)

  if (error) {
    console.error('[archiveFormTemplate]', error.message)
    return { error: 'Failed to archive template.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_template', entityId: id, action: 'form_template_archived',
  })

  revalidatePath('/admin/form-templates')
  return {}
}

// ── deleteFormTemplate ────────────────────────────────────────────────────────
// A template with services still tagged to it can't be removed — mirrors
// deleteService()'s dependent-check-then-hard-delete pattern.

export async function deleteFormTemplate(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()

  const { data: template, error: fetchError } = await supabase
    .from('form_templates')
    .select('name')
    .eq('id', id)
    .single()

  if (fetchError || !template) return { error: 'Template not found.' }

  const { count: serviceCount } = await supabase
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id)

  if (serviceCount && serviceCount > 0) {
    return {
      error: `Cannot delete "${template.name}" — ${serviceCount} service${serviceCount === 1 ? '' : 's'} still ${serviceCount === 1 ? 'is' : 'are'} tagged to it. Retag or delete those services first.`,
    }
  }

  const { error } = await supabase.from('form_templates').delete().eq('id', id)

  if (error) {
    console.error('[deleteFormTemplate]', error.message)
    return { error: 'Failed to delete template.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_template', entityId: id, action: 'form_template_deleted',
    metadata: { name: template.name },
  })

  revalidatePath('/admin/form-templates')
  return {}
}

// ── tagServiceTemplate ────────────────────────────────────────────────────────
// Sets or clears a service's template tag on its own — used by the "Change
// template" control on a tagged service's Form Builder page, without needing
// to reopen the full Edit Service modal.

export async function tagServiceTemplate(
  serviceId: string,
  templateId: string | null
): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const supabase = await createClient()
  const { error } = await supabase
    .from('services')
    .update({ template_id: templateId })
    .eq('id', serviceId)

  if (error) {
    console.error('[tagServiceTemplate]', error.message)
    return { error: 'Failed to update template tag.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'service', entityId: serviceId, action: 'service_template_tagged',
    metadata: { template_id: templateId },
  })

  revalidatePath(`/admin/services/${serviceId}`)
  revalidatePath('/admin/services')
  revalidatePath('/services')
  return {}
}

// ── convertServiceFormToTemplate ─────────────────────────────────────────────
// Migration helper for an existing, untagged service: lifts its current
// resolved form (own form_sections, or the legacy form_fields migrated into a
// section) into a brand-new template, then tags the service to it. The
// service's own form_sections column is left untouched afterward — harmless
// once template_id is set (resolveServiceFormSections() ignores it in favor
// of the template), and it means removing the tag later doesn't lose data.

export async function convertServiceFormToTemplate(
  serviceId: string,
  templateName: string
): Promise<ActionResult & { templateId?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  if (!templateName?.trim()) return { error: 'Template name is required.' }

  const supabase = await createClient()

  const { data: service, error: fetchError } = await supabase
    .from('services')
    .select('form_sections, form_fields, template_id')
    .eq('id', serviceId)
    .single()

  if (fetchError || !service) return { error: 'Service not found.' }
  if (service.template_id) return { error: 'This service is already tagged to a template.' }

  const sections = resolveServiceFormSections(service)
  if (sections.length === 0) {
    return { error: 'This service has no submitted-form fields to convert.' }
  }

  const { data: templateRow, error: createError } = await supabase
    .from('form_templates')
    .insert({
      org_id: guard.profile!.org_id!,
      name: templateName.trim(),
      form_sections: sections,
      created_by: guard.profile!.id,
    })
    .select('id')
    .single()

  if (createError) {
    console.error('[convertServiceFormToTemplate] create', createError.message)
    return { error: 'Failed to create template.' }
  }

  const { error: tagError } = await supabase
    .from('services')
    .update({ template_id: templateRow.id })
    .eq('id', serviceId)

  if (tagError) {
    console.error('[convertServiceFormToTemplate] tag', tagError.message)
    return { error: 'Template created, but tagging the service failed. Tag it manually from Form Builder.' }
  }

  await logAdminAudit({
    orgId: guard.profile!.org_id!, actorId: guard.profile!.id,
    entityType: 'form_template', entityId: templateRow.id, action: 'form_template_created',
    metadata: { name: templateName.trim(), converted_from_service: serviceId },
  })

  revalidatePath('/admin/form-templates')
  revalidatePath(`/admin/services/${serviceId}`)
  revalidatePath('/admin/services')
  revalidatePath('/services')

  return { templateId: templateRow.id }
}
