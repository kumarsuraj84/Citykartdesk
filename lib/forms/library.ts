import type { FormField, FormFieldOption, FormFieldType, FormSection } from '@/types'

// Pure helpers for the Field Library — no I/O, so the same logic backs the
// server actions, the template builder and the unit tests.

export type LibraryFieldDef = {
  id: string
  label: string
  type: FormFieldType
  placeholder: string | null
  help_text: string | null
  options: FormFieldOption[] | null
}

// store_address is system-filled per requester and toggle never renders — neither
// collects a reusable value, so neither belongs in a shared library.
export const LIBRARY_FIELD_TYPES: FormFieldType[] = [
  'text', 'textarea', 'select', 'multiselect', 'number', 'date', 'email', 'phone', 'file',
]

export const isOptionType = (t: FormFieldType) => t === 'select' || t === 'multiselect'

export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Copies the library-owned definition onto a template field, keeping everything
 *  that is per-template (id, required, order, requester visibility, semantic_role). */
export function applyLibraryDefinition(field: FormField, lib: LibraryFieldDef): FormField {
  return {
    ...field,
    library_field_id: lib.id,
    label: lib.label,
    type: lib.type,
    placeholder: lib.placeholder ?? undefined,
    help_text: lib.help_text ?? undefined,
    options: isOptionType(lib.type) ? lib.options ?? [] : undefined,
  }
}

export function fieldFromLibrary(lib: LibraryFieldDef, id: string): FormField {
  return applyLibraryDefinition(
    { id, type: lib.type, label: lib.label, required: false, order: 0, requester_can_view: true, requester_can_set: true },
    lib
  )
}

/** Re-applies library definitions to every linked field. A field whose library
 *  entry no longer exists is unlinked (kept as a standalone copy) rather than lost. */
export function syncSectionsWithLibrary(
  sections: FormSection[],
  libById: Map<string, LibraryFieldDef>
): { sections: FormSection[]; changed: boolean } {
  let changed = false
  const next = sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      if (!field.library_field_id) return field
      const lib = libById.get(field.library_field_id)
      let updated: FormField
      if (lib) {
        updated = applyLibraryDefinition(field, lib)
      } else {
        const { library_field_id: _dropped, ...rest } = field
        void _dropped
        updated = rest
      }
      if (JSON.stringify(updated) !== JSON.stringify(field)) changed = true
      return updated
    }),
  }))
  return { sections: next, changed }
}

function stableOptions(options: FormFieldOption[] | null | undefined): unknown {
  return (options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
    active: o.is_active !== false,
    children: o.children?.length ? stableOptions(o.children) : undefined,
  }))
}

export function optionSignature(options: FormFieldOption[] | null | undefined): string {
  return JSON.stringify(stableOptions(options))
}

// ── Duplicate detection ──────────────────────────────────────────────────────

export type DuplicateInstance = { templateId: string; templateName: string; fieldId: string }

export type DuplicateGroup = {
  key: string
  label: string
  type: FormFieldType
  instances: DuplicateInstance[]
  /** Set when a library entry with this name already exists — instances link to it. */
  existingLibraryId: string | null
  linkable: boolean
  reason?: string
}

type TemplateForScan = { id: string; name: string; form_sections: FormSection[] }

/** Groups unlinked template fields that share a name and type. A group is only
 *  linkable when it is safe to merge: option fields must have identical option
 *  ids and labels everywhere (answers are stored as option ids, so merging
 *  different option sets would orphan old answers in reports). */
export function findDuplicateGroups(
  templates: TemplateForScan[],
  library: LibraryFieldDef[],
  opts: { includeSingles?: boolean } = {}
): DuplicateGroup[] {
  const libByLabel = new Map(library.map((l) => [normalizeLabel(l.label), l]))
  const buckets = new Map<string, { label: string; type: FormFieldType; instances: DuplicateInstance[]; sigs: Set<string> }>()

  for (const t of templates) {
    for (const s of t.form_sections ?? []) {
      for (const f of s.fields ?? []) {
        if (f.library_field_id || !LIBRARY_FIELD_TYPES.includes(f.type)) continue
        const key = `${normalizeLabel(f.label)}|${f.type}`
        const b = buckets.get(key) ?? { label: f.label.trim(), type: f.type, instances: [], sigs: new Set<string>() }
        b.instances.push({ templateId: t.id, templateName: t.name, fieldId: f.id })
        if (isOptionType(f.type)) b.sigs.add(optionSignature(f.options))
        buckets.set(key, b)
      }
    }
  }

  // Library names are unique per org, so two different-typed fields that share a
  // name can't both be added under it.
  const typesByLabel = new Map<string, Set<FormFieldType>>()
  for (const b of buckets.values()) {
    const k = normalizeLabel(b.label)
    typesByLabel.set(k, (typesByLabel.get(k) ?? new Set()).add(b.type))
  }

  const groups: DuplicateGroup[] = []
  for (const [key, b] of buckets) {
    const existing = libByLabel.get(normalizeLabel(b.label)) ?? null
    if (b.instances.length < 2 && !existing && !opts.includeSingles) continue

    let linkable = true
    let reason: string | undefined
    if (existing && existing.type !== b.type) {
      linkable = false
      reason = `A library field named "${existing.label}" already exists with a different type.`
    } else if (isOptionType(b.type)) {
      if (b.sigs.size > 1) {
        linkable = false
        reason = 'The choices differ between templates — align them first, or link manually.'
      } else if (existing && optionSignature(existing.options) !== [...b.sigs][0]) {
        linkable = false
        reason = 'The choices differ from the library field of the same name.'
      }
    }
    if (linkable && !existing && (typesByLabel.get(normalizeLabel(b.label))?.size ?? 0) > 1) {
      linkable = false
      reason = `Other fields named "${b.label}" have a different type — rename one of them first so each library name is unique.`
    }
    groups.push({ key, label: b.label, type: b.type, instances: b.instances, existingLibraryId: existing?.id ?? null, linkable, reason })
  }
  return groups.sort((a, b) => b.instances.length - a.instances.length || a.label.localeCompare(b.label))
}

/** A request's answers keyed by library field id — whichever template field
 *  instance its own form has for each library field. Fields not linked to the
 *  library are omitted; a library field the form lacks is simply absent. */
export function libraryFieldValues(
  sections: FormSection[],
  formData: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!formData) return out
  for (const s of sections) {
    for (const f of s.fields ?? []) {
      if (f.library_field_id && f.id in formData) out[f.library_field_id] = formData[f.id]
    }
  }
  return out
}

/** Which templates use each library field (by template name). */
export function libraryUsage(templates: TemplateForScan[]): Map<string, string[]> {
  const usage = new Map<string, Set<string>>()
  for (const t of templates) {
    for (const s of t.form_sections ?? []) {
      for (const f of s.fields ?? []) {
        if (!f.library_field_id) continue
        const set = usage.get(f.library_field_id) ?? new Set<string>()
        set.add(t.name)
        usage.set(f.library_field_id, set)
      }
    }
  }
  return new Map([...usage].map(([id, names]) => [id, [...names].sort()]))
}
